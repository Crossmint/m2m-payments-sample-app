import { createContext, type Ctx } from "./context.js";
import { toErrorResponse } from "./errors.js";
import {
  approveAccessRequest,
  confirmAccessRequest,
  createAccessRequest,
  denyAccessRequest,
  getAccessRequest,
} from "./handlers/access-requests.js";
import { getConfig } from "./handlers/config.js";
import { getMe } from "./handlers/me.js";
import { deletePaymentMethod, listPaymentMethods } from "./handlers/payment-methods.js";
import { listPayments, payMpp, payX402, sendTransaction, transfer } from "./handlers/payments.js";
import {
  createTopUpRequest,
  denyTopUpRequest,
  getTopUpRequest,
} from "./handlers/top-up-requests.js";
import { createTopUp, getTopUp, payTopUp } from "./handlers/top-ups.js";
import {
  getActivity,
  getBalance,
  getWallet,
  revokeAccess,
  revokedAccess,
} from "./handlers/wallet.js";
import { Router } from "./router.js";
import type { M2mPaymentsServerConfig } from "./types.js";

export { buildPublicConfig } from "./handlers/config.js";
export { loadWalletView } from "./handlers/wallet.js";
export { requireAgentAccess } from "./handlers/access.js";
export { HttpError, type ErrorCode } from "./errors.js";
export { routePath } from "./router.js";
export {
  memoryAccessRequestStore,
  memoryPaymentStore,
  memoryRequestStore,
  memorySessionStore,
  memoryStore,
  memoryTopUpOrderStore,
  memoryTopUpRequestStore,
  memoryWalletAccessStore,
} from "./store/memory.js";
export * from "./types.js";
export type {
  ActivityItem,
  AgentAccess,
  AgentAccessStatus,
  ApproveAccessRequestResult,
  ConfirmAccessRequestResult,
  OnchainResult,
  PaymentMethod,
  ProtocolPaymentResult,
  RevokeAccessResult,
  TopUpPhase,
  TopUpView,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";

export type M2mPaymentsHandler = (req: Request) => Promise<Response>;

export interface M2mPaymentsHandlers {
  GET: M2mPaymentsHandler;
  POST: M2mPaymentsHandler;
  PUT: M2mPaymentsHandler;
  DELETE: M2mPaymentsHandler;
  /** Dispatches on `req.method`. */
  handler: M2mPaymentsHandler;
}

/** Every route in docs/API.md, wired to its handler. */
export function buildRouter(): Router<Ctx> {
  return new Router<Ctx>()
    .get("/v1/config", getConfig)
    .get("/v1/me", getMe)
    .get("/v1/wallet", getWallet)
    .get("/v1/wallet/balance", getBalance)
    .get("/v1/wallet/activity", getActivity)
    .post("/v1/wallet/access/revoke", revokeAccess)
    .post("/v1/wallet/access/revoked", revokedAccess)
    .post("/v1/access-requests", createAccessRequest)
    .get("/v1/access-requests/:id", getAccessRequest)
    .post("/v1/access-requests/:id/approve", approveAccessRequest)
    .post("/v1/access-requests/:id/confirm", confirmAccessRequest)
    .post("/v1/access-requests/:id/deny", denyAccessRequest)
    .post("/v1/top-up-requests", createTopUpRequest)
    .get("/v1/top-up-requests/:id", getTopUpRequest)
    .post("/v1/top-up-requests/:id/deny", denyTopUpRequest)
    .post("/v1/top-ups", createTopUp)
    .post("/v1/top-ups/:orderId/pay", payTopUp)
    .get("/v1/top-ups/:orderId", getTopUp)
    .get("/v1/payment-methods", listPaymentMethods)
    .delete("/v1/payment-methods/:id", deletePaymentMethod)
    .get("/v1/payments", listPayments)
    .post("/v1/payments/x402", payX402)
    .post("/v1/payments/mpp", payMpp)
    .post("/v1/transfers", transfer)
    .post("/v1/transactions", sendTransaction);
}

/**
 * Build the M2M Payments HTTP API as Web-standard handlers.
 *
 * ```ts
 * // app/api/m2m-payments/[...path]/route.ts
 * export const { GET, POST, PUT, DELETE } = createM2mPaymentsHandlers({ ... });
 * ```
 */
export function createM2mPaymentsHandlers(config: M2mPaymentsServerConfig): M2mPaymentsHandlers {
  const ctx = createContext(config);
  const router = buildRouter();
  const handler: M2mPaymentsHandler = async (req) => {
    try {
      return await router.dispatch(req, ctx);
    } catch (err) {
      return toErrorResponse(err);
    }
  };
  return { GET: handler, POST: handler, PUT: handler, DELETE: handler, handler };
}
