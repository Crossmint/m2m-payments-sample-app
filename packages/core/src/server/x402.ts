import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { Hex } from "viem";
import { compareDecimal, credits, unitsToCredits } from "../amount.js";
import { PaymentFailedError, PaymentTooLargeError } from "../errors.js";
import { CREDITS } from "../token.js";
import type { ProtocolPaymentInput, ProtocolResponse, ProtocolSettlement } from "../types.js";
import type { AgentWallet } from "./wallets.js";
import { toProtocolResponse, toRequestInit } from "./http.js";

/*
 * Pay an x402 endpoint from the agent's wallet.
 *
 * `@x402/fetch` does the handshake: the first request comes back 402 with
 * payment requirements, the client signs an EIP-3009 transfer authorization
 * with the wallet's signer, the request is retried with the payment header,
 * and the endpoint answers with the settlement in a response header.
 *
 * The signer is the Crossmint smart wallet: `signTypedData` runs through the
 * server signer the user approved. BigInts in the typed data are turned into
 * strings first, because the wallet API takes JSON.
 */

export interface X402PayOptions {
  agent: AgentWallet;
  input: ProtocolPaymentInput;
  /** Most credits this call may pay. */
  maxAmount: string;
  /** Token decimals for turning the requirement's `amount` into credits. */
  decimals: number;
  fetch?: typeof fetch;
}

export interface X402PayResult {
  paid: boolean;
  amount?: { value: string; currency: string };
  settlement?: ProtocolSettlement;
  response: ProtocolResponse;
}

export async function payWithX402(opts: X402PayOptions): Promise<X402PayResult> {
  const { agent, input } = opts;
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  const signer = {
    address: agent.address,
    async signTypedData(typedData: Record<string, unknown>): Promise<Hex> {
      const data = stringifyBigInts(typedData) as Record<string, unknown>;
      const { signature } = await agent.evm.signTypedData({
        ...data,
        chain: agent.chain,
      } as never);
      return signature as Hex;
    },
  };

  let charged: string | undefined;
  const client = new x402Client();
  client.register("eip155:*", new ExactEvmScheme(signer as never));
  // Refuse before signing when the endpoint asks for more than allowed.
  client.onBeforePaymentCreation(async (ctx) => {
    const req = ctx.selectedRequirements as { amount?: string; maxAmountRequired?: string };
    const units = req.amount ?? req.maxAmountRequired;
    if (!units) return;
    charged = unitsToCredits(BigInt(units), opts.decimals);
    if (compareDecimal(charged, opts.maxAmount, opts.decimals) > 0) {
      throw new PaymentTooLargeError(charged, opts.maxAmount, CREDITS);
    }
  });

  const fetchWithPayment = wrapFetchWithPayment(baseFetch, client);
  let res: Response;
  try {
    res = await fetchWithPayment(input.url, toRequestInit(input));
  } catch (e) {
    if (e instanceof PaymentTooLargeError) throw e;
    throw new PaymentFailedError(
      `x402 payment to ${input.url} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const response = await toProtocolResponse(res);
  let settlement: ProtocolSettlement | undefined;
  try {
    const http = new x402HTTPClient(client);
    const settle = http.getPaymentSettleResponse((name) => res.headers.get(name)) as
      { transaction?: string; network?: string; payer?: string; success?: boolean } | undefined;
    if (settle && (settle.transaction || settle.payer)) {
      settlement = {
        transaction: settle.transaction,
        network: settle.network,
        payer: settle.payer,
      };
    }
  } catch {
    // No receipt header: the endpoint did not charge, or it does not send one.
  }

  const paid = Boolean(settlement) || charged !== undefined;
  if (res.status === 402) {
    throw new PaymentFailedError(`The endpoint at ${input.url} still answered 402 after payment`, {
      response,
    });
  }
  return {
    paid,
    amount: paid && charged ? credits(charged) : undefined,
    settlement,
    response,
  };
}

/** The wallet API takes JSON, so every bigint in the typed data becomes a string. */
export function stringifyBigInts<T>(value: T): T {
  if (typeof value === "bigint") return value.toString() as unknown as T;
  if (Array.isArray(value)) return value.map(stringifyBigInts) as unknown as T;
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, stringifyBigInts(v)]),
    ) as T;
  }
  return value;
}
