import type { AuthenticatedUser } from "@m2m-payments/auth";
import type { AccessRequest, AgentAccess } from "@m2m-payments/core";
import type { UserWallet } from "@m2m-payments/core/server";
import type { Ctx } from "../context.js";
import { HttpError } from "../errors.js";
import { accessRequestId } from "../ids.js";
import type { NewAccessRequest, WalletAccess } from "../types.js";

/*
 * The access gate. Shared by the wallet view, the access request handlers
 * and every agent payment. Nothing here answers HTTP itself.
 */

/** `${webBaseUrl}/approve/${id}` */
export function approvalUrlFor(ctx: Ctx, id: string): string {
  return `${ctx.config.webBaseUrl.replace(/\/$/, "")}/approve/${id}`;
}

/** ISO timestamp when a new request stops being answerable. */
export function requestExpiry(ctx: Ctx, from = ctx.now()): string {
  return new Date(from.getTime() + ctx.requestTtlMinutes * 60_000).toISOString();
}

/**
 * The wallet_access row when it is live: not revoked here, and the signer
 * is approved on Crossmint right now. Null otherwise.
 */
export async function activeAccess(
  ctx: Ctx,
  userId: string,
  wallet: UserWallet,
): Promise<WalletAccess | null> {
  const row = await ctx.store.getWalletAccess(userId);
  if (!row || row.revokedAt) return null;
  const approved = await ctx.wallets.agentSignerApproved(wallet, row.signerLocator);
  return approved ? row : null;
}

/**
 * The user's open access request, if one is still answerable. A pending
 * request past its window is marked expired on the way and not returned.
 */
export async function openAccessRequest(ctx: Ctx, userId: string): Promise<AccessRequest | null> {
  const open = await ctx.store.findOpenAccessRequest(userId);
  if (!open) return null;
  if (open.status === "pending" && Date.parse(open.requestExpiresAt) <= ctx.now().getTime()) {
    await ctx.store.updateAccessRequest(open.id, { status: "expired" });
    return null;
  }
  return open;
}

/** A new pending access request for the user. */
export async function createPendingAccessRequest(
  ctx: Ctx,
  userId: string,
  input: { reason?: string; requester?: string },
): Promise<AccessRequest> {
  const id = accessRequestId();
  const row: NewAccessRequest = {
    id,
    userId,
    requester: input.requester ?? ctx.defaultRequester,
    requestExpiresAt: requestExpiry(ctx),
    status: "pending",
    approvalUrl: approvalUrlFor(ctx, id),
  };
  if (input.reason) row.reason = input.reason;
  return ctx.store.createAccessRequest(row);
}

/** The `agentAccess` block of `WalletView`. */
export async function agentAccessFor(
  ctx: Ctx,
  userId: string,
  wallet: UserWallet,
): Promise<AgentAccess> {
  const row = await ctx.store.getWalletAccess(userId);
  if (row && !row.revokedAt) {
    const approved = await ctx.wallets.agentSignerApproved(wallet, row.signerLocator);
    if (approved) {
      return { status: "active", signerLocator: row.signerLocator, grantedAt: row.grantedAt };
    }
  }
  const open = await openAccessRequest(ctx, userId);
  if (open) {
    return { status: "pending", requestId: open.id, approvalUrl: open.approvalUrl };
  }
  if (row) {
    const out: AgentAccess = { status: "revoked", signerLocator: row.signerLocator };
    if (row.revokedAt) out.revokedAt = row.revokedAt;
    return out;
  }
  return { status: "none" };
}

/**
 * Load the wallet and check the agent's access. When there is none, make
 * sure a pending access request exists and throw `403 access_required`
 * carrying its approval link, so the agent's first payment call already
 * returns what the user needs.
 */
export async function requireAgentAccess(
  ctx: Ctx,
  user: AuthenticatedUser,
  requester?: string,
): Promise<{ wallet: UserWallet; access: WalletAccess }> {
  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const access = await activeAccess(ctx, user.userId, wallet);
  if (access) return { wallet, access };

  const request =
    (await openAccessRequest(ctx, user.userId)) ??
    (await createPendingAccessRequest(ctx, user.userId, { requester }));
  throw new HttpError(
    403,
    "access_required",
    "This agent does not have access to the wallet yet. Ask the user to approve it at the link in details.approvalUrl.",
    { requestId: request.id, approvalUrl: request.approvalUrl },
  );
}
