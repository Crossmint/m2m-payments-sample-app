import type { AuthenticatedUser } from "@m2m-payments/auth";
import {
  compareDecimal,
  CREDITS,
  credits,
  InsufficientFundsError,
  PaymentFailedError,
  tokenInfo,
  type Amount,
  type OnchainResult,
  type PaymentKind,
  type ProtocolPaymentInput,
  type ProtocolPaymentResult,
} from "@m2m-payments/core";
import {
  hostOf,
  payWithMpp,
  payWithX402,
  type AgentWallet,
  type MppPayResult,
  type X402PayResult,
} from "@m2m-payments/core/server";
import { parseBody, requireUser, type Ctx } from "../context.js";
import { invalidRequest, json } from "../errors.js";
import { protocolPaymentSchema, transactionSchema, transferSchema } from "../schemas.js";
import type { NewPayment } from "../types.js";
import { requireAgentAccess } from "./access.js";
import { parseLimit } from "./wallet.js";

/*
 * Everything the agent does with the wallet. Every route runs with the
 * server key and the agent's server signer, behind the access gate, and
 * writes one `payments` row.
 */

const PAYMENT_KINDS: PaymentKind[] = ["x402", "mpp", "transfer", "transaction", "top-up"];

/** A balance under one base unit is as good as empty. */
const MIN_BALANCE = "0.000001";

/** GET /v1/payments?limit=100&kind= */
export async function listPayments(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const params = new URL(req.url).searchParams;
  const limit = parseLimit(params.get("limit"), 100, 500);
  const kindRaw = params.get("kind");
  let kind: PaymentKind | undefined;
  if (kindRaw) {
    if (!PAYMENT_KINDS.includes(kindRaw as PaymentKind)) {
      throw invalidRequest(`Unknown payment kind ${kindRaw}`, { kinds: PAYMENT_KINDS });
    }
    kind = kindRaw as PaymentKind;
  }
  const payments = await ctx.store.listPayments(user.userId, { limit, kind });
  return json({ payments });
}

/** POST /v1/payments/x402 */
export async function payX402(req: Request, ctx: Ctx): Promise<Response> {
  return protocolPayment(req, ctx, "x402", payWithX402);
}

/** POST /v1/payments/mpp */
export async function payMpp(req: Request, ctx: Ctx): Promise<Response> {
  return protocolPayment(req, ctx, "mpp", payWithMpp);
}

type Payer = (opts: {
  agent: AgentWallet;
  input: ProtocolPaymentInput;
  maxAmount: string;
  decimals: number;
}) => Promise<X402PayResult | MppPayResult>;

/**
 * The shared x402 and MPP flow: access gate, balance gate, pay, record.
 *
 * The price is not known until the endpoint answers 402, so the balance
 * gate only refuses an empty wallet here; the payer itself refuses a price
 * above `maxAmount` before signing.
 */
async function protocolPayment(
  req: Request,
  ctx: Ctx,
  kind: "x402" | "mpp",
  pay: Payer,
): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, protocolPaymentSchema);
  const { wallet } = await requireAgentAccess(ctx, user, body.requester);
  const maxAmount = body.maxAmount ?? ctx.maxPayment;

  const balance = await ctx.wallets.balance(wallet);
  if (compareDecimal(balance.value, MIN_BALANCE) < 0) {
    throw new InsufficientFundsError(balance.value, maxAmount, CREDITS);
  }

  const agent = await ctx.wallets.asAgent(wallet);
  const base: NewPayment = {
    userId: user.userId,
    kind,
    status: "succeeded",
    counterparty: hostOf(body.url),
    requester: body.requester ?? ctx.defaultRequester,
  };
  if (body.memo) base.description = body.memo;

  let result: X402PayResult | MppPayResult;
  try {
    result = await pay({
      agent,
      input: body,
      maxAmount,
      decimals: tokenInfo(ctx.config.crossmint.environment).decimals,
    });
  } catch (e) {
    if (e instanceof PaymentFailedError) {
      await ctx.store.recordPayment({ ...base, status: "failed", failureReason: e.message });
      throw e;
    }
    throw insufficientFundsFromSdk(e, balance, maxAmount) ?? e;
  }

  const row: NewPayment = { ...base };
  if (result.amount) row.amount = result.amount;
  if (result.settlement?.transaction) {
    row.hash = result.settlement.transaction;
    row.explorerUrl = ctx.wallets.explorer("tx", result.settlement.transaction);
  }
  const payment = await ctx.store.recordPayment(row);
  const out: ProtocolPaymentResult = { payment, paid: result.paid, response: result.response };
  if (result.amount) out.amount = result.amount;
  if (result.settlement) out.settlement = result.settlement;
  return json(out, 201);
}

/** POST /v1/transfers. Credits only. */
export async function transfer(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, transferSchema);
  const { wallet } = await requireAgentAccess(ctx, user, body.requester);
  const agent = await ctx.wallets.asAgent(wallet);

  let sent: { hash: string; explorerLink: string; transactionId: string };
  try {
    sent = await ctx.wallets.send(agent, body.to, body.amount);
  } catch (e) {
    const balance = await ctx.wallets.balance(wallet).catch(() => credits("0"));
    throw insufficientFundsFromSdk(e, balance, body.amount) ?? e;
  }
  return json(
    await onchainResult(ctx, user, "transfer", sent, {
      amount: credits(body.amount),
      counterparty: body.to,
      memo: body.memo,
      requester: body.requester,
    }),
    201,
  );
}

/** POST /v1/transactions. A raw transaction; `value` is wei. */
export async function sendTransaction(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, transactionSchema);
  const { wallet } = await requireAgentAccess(ctx, user, body.requester);
  const agent = await ctx.wallets.asAgent(wallet);

  const sent = await agent.evm.sendTransaction({
    to: body.to,
    data: (body.data ?? "0x") as `0x${string}`,
    value: BigInt(body.value ?? "0"),
  });
  return json(
    await onchainResult(ctx, user, "transaction", sent, {
      counterparty: body.to,
      memo: body.memo,
      requester: body.requester,
    }),
    201,
  );
}

// ---------------------------------------------------------------------------

/** Record a transfer or transaction and shape the response. */
async function onchainResult(
  ctx: Ctx,
  user: AuthenticatedUser,
  kind: "transfer" | "transaction",
  sent: { hash: string; explorerLink: string; transactionId: string },
  meta: { amount?: Amount; counterparty: string; memo?: string; requester?: string },
): Promise<OnchainResult> {
  const explorerUrl = sent.explorerLink || ctx.wallets.explorer("tx", sent.hash);
  const row: NewPayment = {
    userId: user.userId,
    kind,
    status: "succeeded",
    counterparty: meta.counterparty,
    hash: sent.hash,
    explorerUrl,
    requester: meta.requester ?? ctx.defaultRequester,
  };
  if (meta.amount) row.amount = meta.amount;
  if (meta.memo) row.description = meta.memo;
  const payment = await ctx.store.recordPayment(row);
  return { payment, hash: sent.hash, explorerUrl, transactionId: sent.transactionId };
}

/**
 * The wallets SDK reports an empty wallet as a plain error whose message
 * names the balance. Map it to the API's `402 insufficient_funds`.
 */
function insufficientFundsFromSdk(
  e: unknown,
  balance: Amount,
  required: string,
): InsufficientFundsError | null {
  if (e instanceof InsufficientFundsError) return e;
  const message = e instanceof Error ? e.message : String(e);
  if (
    /insufficient (balance|funds)|not enough (balance|funds)|exceeds (the )?balance/i.test(message)
  ) {
    return new InsufficientFundsError(balance.value, required, CREDITS);
  }
  return null;
}
