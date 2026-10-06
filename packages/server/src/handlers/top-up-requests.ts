import type { AuthenticatedUser } from "@m2m-payments/auth";
import type { TopUpRequest } from "@m2m-payments/core";
import { topUpPhase } from "@m2m-payments/core/server";
import { parseBody, requireUser, type Ctx } from "../context.js";
import { forbidden, HttpError, json, notFound } from "../errors.js";
import { topUpRequestId } from "../ids.js";
import type { Params } from "../router.js";
import { createTopUpRequestSchema } from "../schemas.js";
import type { NewTopUpRequest } from "../types.js";
import { requestExpiry } from "./access.js";

/** `${webBaseUrl}/top-up/${id}` */
export function topUpUrlFor(ctx: Ctx, id: string): string {
  return `${ctx.config.webBaseUrl.replace(/\/$/, "")}/top-up/${id}`;
}

/** POST /v1/top-up-requests */
export async function createTopUpRequest(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, createTopUpRequestSchema);
  const id = topUpRequestId();
  const row: NewTopUpRequest = {
    id,
    userId: user.userId,
    requester: body.requester ?? ctx.defaultRequester,
    amount: body.amount,
    requestExpiresAt: requestExpiry(ctx),
    status: "pending",
    approvalUrl: topUpUrlFor(ctx, id),
  };
  if (body.reason) row.reason = body.reason;
  return json(await ctx.store.createTopUpRequest(row), 201);
}

/** GET /v1/top-up-requests/:id */
export async function getTopUpRequest(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedTopUpRequest(ctx, user, params.id!);
  return json(await reconcileTopUpRequest(ctx, request));
}

/**
 * Settle a `paying` request against its order on Crossmint. The browser's
 * poll normally does this through `GET /v1/top-ups/:orderId`; this is for
 * the agent polling the request while the browser is closed.
 */
export async function reconcileTopUpRequest(
  ctx: Ctx,
  request: TopUpRequest,
): Promise<TopUpRequest> {
  if (request.status !== "paying" || !request.orderId) return request;
  try {
    const order = await ctx.crossmint.orders.get(request.orderId, request.amount.value);
    const phase = topUpPhase(order);
    if (phase === "completed") {
      return ctx.store.updateTopUpRequest(request.id, {
        status: "completed",
        received: order.quote.receive,
      });
    }
    if (phase === "failed") {
      return ctx.store.updateTopUpRequest(request.id, {
        status: "failed",
        failureReason: `payment ${order.paymentStatus ?? "failed"}, delivery ${order.deliveryStatus ?? "not started"}`,
      });
    }
  } catch (e) {
    console.warn(
      "[m2m-payments] could not reconcile top-up request",
      request.id,
      e instanceof Error ? e.message : e,
    );
  }
  return request;
}

/** POST /v1/top-up-requests/:id/deny. Allowed while `pending` or `paying`. */
export async function denyTopUpRequest(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  const request = await loadOwnedTopUpRequest(ctx, user, params.id!);
  if (request.status !== "pending" && request.status !== "paying") {
    if (request.status === "expired") {
      throw new HttpError(409, "expired", "The user did not answer this request in time");
    }
    throw new HttpError(409, "invalid_request", `This request is already ${request.status}`);
  }
  return json(await ctx.store.updateTopUpRequest(request.id, { status: "denied" }));
}

/** Load a request, check ownership, and expire it when the answer window has passed. */
export async function loadOwnedTopUpRequest(
  ctx: Ctx,
  user: AuthenticatedUser,
  id: string,
): Promise<TopUpRequest> {
  const request = await ctx.store.getTopUpRequest(id);
  if (!request) throw notFound(`Top-up request ${id} not found`);
  if (request.userId !== user.userId) throw forbidden();
  if (request.status === "pending" && Date.parse(request.requestExpiresAt) <= ctx.now().getTime()) {
    return ctx.store.updateTopUpRequest(id, { status: "expired" });
  }
  return request;
}
