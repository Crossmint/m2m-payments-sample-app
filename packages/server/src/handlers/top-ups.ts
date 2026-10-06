import type { AuthenticatedUser } from "@m2m-payments/auth";
import type { TopUpPhase, TopUpView } from "@m2m-payments/core";
import { topUpPhase, type OnrampOrder } from "@m2m-payments/core/server";
import { parseBody, requireUser, resolveEmail, type Ctx } from "../context.js";
import { forbidden, HttpError, json, notFound } from "../errors.js";
import type { Params } from "../router.js";
import { createTopUpSchema, payTopUpSchema } from "../schemas.js";
import type { TopUpOrder } from "../types.js";
import { loadOwnedTopUpRequest } from "./top-up-requests.js";

/*
 * The onramp: card to credits, by a Crossmint order. The browser drives it.
 * The order is created and read with the server key; it is paid with the
 * client key and the user's JWT, because the saved card is bound to the user.
 */

/**
 * Users whose staging identity record was seeded in this process. Staging
 * wants one before it accepts an order; production never asks.
 */
const seededIdentities = new Map<string, Promise<void>>();

/** POST /v1/top-ups */
export async function createTopUp(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, createTopUpSchema);

  const request = body.requestId ? await loadOwnedTopUpRequest(ctx, user, body.requestId) : null;
  if (request && request.status !== "pending" && request.status !== "paying") {
    throw new HttpError(409, "invalid_request", `This top-up request is already ${request.status}`);
  }

  const wallet = await ctx.wallets.getUserWallet(user.userId);
  const email = await resolveEmail(user, ctx);
  if (ctx.stagingIdentityFixture) await seedIdentityOnce(ctx, user.userId, email);

  const order = await ctx.crossmint.orders.create({
    amount: body.amount,
    walletAddress: wallet.address,
    receiptEmail: email,
  });

  const link: TopUpOrder = {
    orderId: order.orderId,
    userId: user.userId,
    amount: order.quote.receive,
    createdAt: ctx.now().toISOString(),
  };
  if (request) link.requestId = request.id;
  await ctx.store.linkTopUpOrder(link);
  if (request) {
    await ctx.store.updateTopUpRequest(request.id, { status: "paying", orderId: order.orderId });
  }
  return json(toTopUpView(order, link), 201);
}

/** POST /v1/top-ups/:orderId/pay */
export async function payTopUp(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  const body = await parseBody(req, payTopUpSchema);
  const link = await loadOwnedOrder(ctx, user, params.orderId!);

  // Client key + the user's JWT, never the server key: the card is the user's.
  await ctx.crossmint.orders.pay({ jwt: user.jwt }, link.orderId, body.paymentMethodId);
  await ctx.store.linkTopUpOrder({ ...link, paymentMethodId: body.paymentMethodId });

  const order = await ctx.crossmint.orders.get(link.orderId, link.amount.value);
  const view = toTopUpView(order, link);
  if (view.phase === "awaiting-payment") view.phase = "processing";
  return json(view);
}

/**
 * GET /v1/top-ups/:orderId
 *
 * The poll. On completion it writes one `payments` row of kind `top-up` and
 * completes the linked request. The row id is kept on the order link, so a
 * second poll after completion writes nothing.
 */
export async function getTopUp(req: Request, ctx: Ctx, params: Params): Promise<Response> {
  const user = await requireUser(req, ctx);
  let link = await loadOwnedOrder(ctx, user, params.orderId!);
  const order = await ctx.crossmint.orders.get(link.orderId, link.amount.value);
  const view = toTopUpView(order, link);

  if (view.phase === "completed" && !link.completedPaymentId) {
    link = await settleTopUp(ctx, link, order);
  } else if (view.phase === "failed" && link.requestId) {
    const request = await ctx.store.getTopUpRequest(link.requestId);
    if (request && (request.status === "pending" || request.status === "paying")) {
      await ctx.store.updateTopUpRequest(request.id, {
        status: "failed",
        failureReason: view.failureReason ?? "The card payment failed",
      });
    }
  }
  return json(view);
}

// ---------------------------------------------------------------------------

/** Record the completed top-up in the ledger and complete its request. Runs once per order. */
async function settleTopUp(ctx: Ctx, link: TopUpOrder, order: OnrampOrder): Promise<TopUpOrder> {
  const request = link.requestId ? await ctx.store.getTopUpRequest(link.requestId) : null;
  const payment = await ctx.store.recordPayment({
    userId: link.userId,
    kind: "top-up",
    status: "succeeded",
    amount: order.quote.receive,
    counterparty: link.paymentMethodId ?? "card",
    description: request?.reason ?? "Top-up by card",
    ...(request ? { requester: request.requester } : {}),
  });
  const next: TopUpOrder = { ...link, completedPaymentId: payment.id };
  await ctx.store.linkTopUpOrder(next);
  if (request && request.status !== "completed" && request.status !== "denied") {
    await ctx.store.updateTopUpRequest(request.id, {
      status: "completed",
      received: order.quote.receive,
    });
  }
  return next;
}

async function seedIdentityOnce(ctx: Ctx, userId: string, email: string): Promise<void> {
  let pending = seededIdentities.get(userId);
  if (!pending) {
    pending = ctx.crossmint
      .seedStagingIdentity(userId, email)
      .then((status) => {
        console.info(`[m2m-payments] staging identity for ${userId}: ${status}`);
      })
      .catch((e: unknown) => {
        // The order may still go through; when it does not, Crossmint says why.
        seededIdentities.delete(userId);
        console.warn(
          "[m2m-payments] staging identity fixture failed",
          e instanceof Error ? e.message : e,
        );
      });
    seededIdentities.set(userId, pending);
  }
  await pending;
}

/** Load the order link and check ownership. Orders the server did not create are unknown to it. */
async function loadOwnedOrder(
  ctx: Ctx,
  user: AuthenticatedUser,
  orderId: string,
): Promise<TopUpOrder> {
  const link = await ctx.store.getTopUpOrder(orderId);
  if (!link) throw notFound(`Top-up ${orderId} not found`);
  if (link.userId !== user.userId) throw forbidden();
  return link;
}

/** The order as the API shows it. */
export function toTopUpView(order: OnrampOrder, link: TopUpOrder): TopUpView {
  const phase: TopUpPhase = topUpPhase(order);
  const view: TopUpView = {
    orderId: order.orderId,
    phase,
    quote: order.quote,
    createdAt: link.createdAt,
  };
  if (link.requestId) view.requestId = link.requestId;
  if (order.paymentStatus) view.paymentStatus = order.paymentStatus;
  if (order.deliveryStatus) view.deliveryStatus = order.deliveryStatus;
  if (order.clientSecret) view.clientSecret = order.clientSecret;
  if (phase === "failed") {
    view.failureReason = `payment ${order.paymentStatus ?? "failed"}, delivery ${order.deliveryStatus ?? "not started"}`;
  }
  return view;
}
