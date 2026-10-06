import type { AuthenticatedUser } from "@m2m-payments/auth";
import type {
  AccessRequest,
  ApproveAccessRequestResult,
  ConfirmAccessRequestResult,
} from "@m2m-payments/core";
import { parseBody, requireUser, type Ctx } from "../context.js";
import { forbidden, HttpError, json, notFound } from "../errors.js";
import { accessRequestId } from "../ids.js";
import type { Params } from "../router.js";
import { createAccessRequestSchema } from "../schemas.js";
import type { NewAccessRequest } from "../types.js";
import {
  activeAccess,
  approvalUrlFor,
  createPendingAccessRequest,
  requestExpiry,
} from "./access.js";
import { loadWalletView } from "./wallet.js";

/**
 * POST /v1/access-requests
 *
 * When the agent already has active access the answer is a 200 with an
 * `active` request carrying the existing signer, so a tool can call this
 * without checking first. The row is stored too, so a later GET resolves.
 */
export async function createAccessRequest(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, createAccessRequestSchema);

  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const access = await activeAccess(ctx, user.userId, wallet);
  if (access) {
    const id = accessRequestId();
    const row: NewAccessRequest = {
      id,
      userId: user.userId,
      requester: body.requester ?? ctx.defaultRequester,
      requestExpiresAt: requestExpiry(ctx),
      status: "active",
      signerLocator: access.signerLocator,
      approvalUrl: approvalUrlFor(ctx, id),
    };
    if (body.reason) row.reason = body.reason;
    return json(await ctx.store.createAccessRequest(row), 200);
  }

  const created = await createPendingAccessRequest(ctx, user.userId, body);
  return json(created, 201);
}

/** GET /v1/access-requests/:id */
export async function getAccessRequest(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedRequest(ctx, user, params.id!);
  return json(await reconcileRequest(ctx, user, request));
}

/**
 * Settle an `approved` request against Crossmint.
 *
 * The user approves the signer in the browser with the email code, and the
 * browser then calls `confirm`. When that call never lands, the request
 * would stay `approved` for ever. Checking here is what lets a polling
 * agent see it turn active. Anything else is returned untouched.
 */
export async function reconcileRequest(
  ctx: Ctx,
  user: AuthenticatedUser,
  request: AccessRequest,
): Promise<AccessRequest> {
  if (request.status !== "approved" || !request.signerLocator) return request;
  try {
    const wallet = await ctx.wallets.getUserWallet(user.userId);
    const approved = await ctx.wallets.agentSignerApproved(wallet, request.signerLocator);
    if (approved) return activate(ctx, request, request.signerLocator);
  } catch (e) {
    console.warn(
      "[m2m-payments] could not reconcile access request",
      request.id,
      e instanceof Error ? e.message : e,
    );
  }
  return request;
}

/**
 * POST /v1/access-requests/:id/approve
 *
 * Registers the agent's server signer on the wallet without approving it,
 * and hands the pending operation to the browser. Answering again while
 * `approved` prepares a fresh operation: the first email code may have
 * expired before the user typed it.
 */
export async function approveAccessRequest(
  req: Request,
  ctx: Ctx,
  params: Params,
): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedRequest(ctx, user, params.id!);
  assertAnswerable(request);

  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const prepared = await ctx.wallets.prepareAgentSigner(wallet);
  const updated = await ctx.store.updateAccessRequest(request.id, {
    status: "approved",
    signerLocator: prepared.locator,
  });
  const body: ApproveAccessRequestResult = { request: updated, signerLocator: prepared.locator };
  if (prepared.signatureId) body.signatureId = prepared.signatureId;
  if (prepared.transactionId) body.transactionId = prepared.transactionId;
  return json(body);
}

/**
 * POST /v1/access-requests/:id/confirm
 *
 * The browser calls this after the email code. The signer has to be
 * approved on Crossmint by now; when it is not, `409 access_pending`.
 */
export async function confirmAccessRequest(
  req: Request,
  ctx: Ctx,
  params: Params,
): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedRequest(ctx, user, params.id!);

  let confirmed: AccessRequest;
  if (request.status === "active") {
    confirmed = request;
  } else {
    if (request.status !== "approved" || !request.signerLocator) {
      assertAnswerable(request);
      throw accessPending(request);
    }
    const wallet = await ctx.wallets.getUserWallet(user.userId);
    const approved = await ctx.wallets.agentSignerApproved(wallet, request.signerLocator);
    if (!approved) throw accessPending(request);
    confirmed = await activate(ctx, request, request.signerLocator);
  }

  const body: ConfirmAccessRequestResult = {
    request: confirmed,
    wallet: await loadWalletView(ctx, user),
  };
  return json(body);
}

/** POST /v1/access-requests/:id/deny */
export async function denyAccessRequest(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedRequest(ctx, user, params.id!);
  assertAnswerable(request);
  return json(await ctx.store.updateAccessRequest(request.id, { status: "denied" }));
}

// ---------------------------------------------------------------------------

/** Mark the request active and write the wallet_access row that says this signer is ours. */
async function activate(
  ctx: Ctx,
  request: AccessRequest,
  signerLocator: string,
): Promise<AccessRequest> {
  const updated = await ctx.store.updateAccessRequest(request.id, { status: "active" });
  await ctx.store.putWalletAccess({
    userId: request.userId,
    signerLocator,
    grantedAt: ctx.now().toISOString(),
  });
  return updated;
}

function accessPending(request: AccessRequest): HttpError {
  return new HttpError(409, "access_pending", "The user has not approved the agent's signer yet", {
    requestId: request.id,
    approvalUrl: request.approvalUrl,
  });
}

/** Load a request, check ownership, and expire it when the answer window has passed. */
async function loadOwnedRequest(
  ctx: Ctx,
  user: AuthenticatedUser,
  id: string,
): Promise<AccessRequest> {
  const request = await ctx.store.getAccessRequest(id);
  if (!request) throw notFound(`Access request ${id} not found`);
  if (request.userId !== user.userId) throw forbidden();
  if (request.status === "pending" && Date.parse(request.requestExpiresAt) <= ctx.now().getTime()) {
    return ctx.store.updateAccessRequest(id, { status: "expired" });
  }
  return request;
}

/** The request can still be answered: `pending`, or `approved` with the email code not yet typed. */
function assertAnswerable(request: AccessRequest): void {
  if (request.status === "pending" || request.status === "approved") return;
  if (request.status === "expired") {
    throw new HttpError(409, "expired", "The user did not answer this request in time");
  }
  throw new HttpError(409, "invalid_request", `This request is already ${request.status}`);
}
