import type { AuthenticatedUser } from "@m2m-payments/auth";
import { tokenInfo, type WalletBalance, type WalletView } from "@m2m-payments/core";
import { requireUser, type Ctx } from "../context.js";
import { HttpError, json } from "../errors.js";
import { agentAccessFor } from "./access.js";

/** The user's wallet as `GET /v1/wallet` returns it. Throws `WalletNotFoundError` (404) when there is none. */
export async function loadWalletView(ctx: Ctx, user: AuthenticatedUser): Promise<WalletView> {
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const [balance, agentAccess] = await Promise.all([
    ctx.wallets.balance(wallet),
    agentAccessFor(ctx, user.userId, wallet),
  ]);
  return {
    address: wallet.address,
    chain: ctx.wallets.chain,
    token: tokenInfo(ctx.config.crossmint.environment),
    balance,
    agentAccess,
    explorerUrl: ctx.wallets.explorer("address", wallet.address),
  };
}

/** GET /v1/wallet */
export async function getWallet(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  return json(await loadWalletView(ctx, user));
}

/** GET /v1/wallet/balance. The cheap call agents poll. */
export async function getBalance(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const balance = await ctx.wallets.balance(wallet);
  const body: WalletBalance = {
    balance,
    token: tokenInfo(ctx.config.crossmint.environment),
    address: wallet.address,
  };
  return json(body);
}

/** GET /v1/wallet/activity?limit=50 */
export async function getActivity(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const limit = parseLimit(new URL(req.url).searchParams.get("limit"), 50, 200);
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const activity = await ctx.wallets.activity(wallet, limit);
  return json({ activity });
}

/**
 * POST /v1/wallet/access/revoke
 *
 * Prepares removing the agent's server signer. The browser approves it with
 * the email signer, then calls `/revoked`.
 */
export async function revokeAccess(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const row = await ctx.store.getWalletAccess(user.userId);
  const signerLocator = row?.signerLocator ?? (await ctx.wallets.findAgentSigner(wallet));
  if (!signerLocator) {
    throw new HttpError(409, "invalid_request", "No agent signer is registered on this wallet");
  }
  const prepared = await ctx.wallets.prepareRemoveAgentSigner(wallet);
  const body: { signerLocator: string; transactionId?: string; signatureId?: string } = {
    signerLocator,
  };
  if (prepared.transactionId) body.transactionId = prepared.transactionId;
  return json(body);
}

/**
 * POST /v1/wallet/access/revoked
 *
 * Records the revocation once Crossmint no longer has the signer approved.
 * Best effort: a wallet whose signer is still active, or that never had
 * one, gets the view unchanged.
 */
export async function revokedAccess(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const row = await ctx.store.getWalletAccess(user.userId);
  if (row && !row.revokedAt) {
    const stillApproved = await ctx.wallets.agentSignerApproved(wallet, row.signerLocator);
    if (!stillApproved) {
      await ctx.store.putWalletAccess({ ...row, revokedAt: ctx.now().toISOString() });
    }
  }
  return json(await loadWalletView(ctx, user));
}

/** A `limit` query value, clamped. */
export function parseLimit(raw: string | null, fallback: number, max: number): number {
  const n = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}
