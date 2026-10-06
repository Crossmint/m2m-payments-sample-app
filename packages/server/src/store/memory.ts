import type { AccessRequest, Payment, TopUpRequest } from "@m2m-payments/core";
import { paymentId } from "../ids.js";
import type {
  AccessRequestPatch,
  AccessRequestStore,
  AgentSession,
  ListPaymentsOptions,
  NewAccessRequest,
  NewPayment,
  NewTopUpRequest,
  PaymentStore,
  SessionStore,
  Store,
  TopUpOrder,
  TopUpOrderStore,
  TopUpRequestPatch,
  TopUpRequestStore,
  WalletAccess,
  WalletAccessStore,
} from "../types.js";

/** In-memory store. For tests and a first `pnpm dev` without a database. */
export function memoryStore(): Store {
  const accessRequests = memoryAccessRequestStore();
  const walletAccess = memoryWalletAccessStore();
  const topUpRequests = memoryTopUpRequestStore();
  const topUpOrders = memoryTopUpOrderStore();
  const payments = memoryPaymentStore();
  const sessions = memorySessionStore();
  return {
    ...accessRequests,
    ...walletAccess,
    ...topUpRequests,
    ...topUpOrders,
    ...payments,
    ...sessions,
  } as Store;
}

/** The name the reference app imports. Same as `memoryStore`. */
export const memoryRequestStore = memoryStore;

/** In-memory access requests. */
export function memoryAccessRequestStore(): Required<AccessRequestStore> {
  const rows = new Map<string, AccessRequest>();
  return {
    async createAccessRequest(req: NewAccessRequest) {
      const now = new Date().toISOString();
      const row: AccessRequest = { ...req, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return { ...row };
    },
    async getAccessRequest(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async updateAccessRequest(id: string, patch: AccessRequestPatch) {
      const row = rows.get(id);
      if (!row) throw new Error(`Unknown access request ${id}`);
      const next: AccessRequest = { ...row, ...patch, updatedAt: new Date().toISOString() };
      rows.set(id, next);
      return { ...next };
    },
    async findOpenAccessRequest(userId: string) {
      const open = [...rows.values()]
        .filter((r) => r.userId === userId && (r.status === "pending" || r.status === "approved"))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return open[0] ? { ...open[0] } : null;
    },
    async listAccessRequests(userId: string) {
      return [...rows.values()]
        .filter((r) => r.userId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((r) => ({ ...r }));
    },
  };
}

/** In-memory wallet access rows. Lost on restart: the agent asks again. */
export function memoryWalletAccessStore(): WalletAccessStore {
  const rows = new Map<string, WalletAccess>();
  return {
    async getWalletAccess(userId: string) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async putWalletAccess(row: WalletAccess) {
      rows.set(row.userId, { ...row });
    },
  };
}

/** In-memory top-up requests. */
export function memoryTopUpRequestStore(): TopUpRequestStore {
  const rows = new Map<string, TopUpRequest>();
  return {
    async createTopUpRequest(req: NewTopUpRequest) {
      const now = new Date().toISOString();
      const row: TopUpRequest = { ...req, createdAt: now, updatedAt: now };
      rows.set(row.id, row);
      return { ...row };
    },
    async getTopUpRequest(id: string) {
      const row = rows.get(id);
      return row ? { ...row } : null;
    },
    async updateTopUpRequest(id: string, patch: TopUpRequestPatch) {
      const row = rows.get(id);
      if (!row) throw new Error(`Unknown top-up request ${id}`);
      const next: TopUpRequest = { ...row, ...patch, updatedAt: new Date().toISOString() };
      rows.set(id, next);
      return { ...next };
    },
  };
}

/** In-memory order links. Lost on restart, which orphans a poll in flight. */
export function memoryTopUpOrderStore(): TopUpOrderStore {
  const rows = new Map<string, TopUpOrder>();
  return {
    async linkTopUpOrder(row: TopUpOrder) {
      const existing = rows.get(row.orderId);
      // Only overwrite what the caller named, so a later link keeps the rest.
      rows.set(row.orderId, {
        ...(existing ?? row),
        userId: row.userId,
        amount: row.amount,
        ...(row.requestId ? { requestId: row.requestId } : {}),
        ...(row.paymentMethodId ? { paymentMethodId: row.paymentMethodId } : {}),
        ...(row.completedPaymentId ? { completedPaymentId: row.completedPaymentId } : {}),
      });
    },
    async getTopUpOrder(orderId: string) {
      const row = rows.get(orderId);
      return row ? { ...row } : null;
    },
  };
}

/** In-memory payments ledger. Lost on restart, which empties the activity list. */
export function memoryPaymentStore(): PaymentStore {
  const rows: Payment[] = [];
  return {
    async recordPayment(payment: NewPayment) {
      const row: Payment = { ...payment, id: paymentId(), createdAt: new Date().toISOString() };
      // Newest first, so `listPayments` can slice from the front.
      rows.unshift(row);
      return { ...row };
    },
    async listPayments(userId: string, { limit = 100, kind }: ListPaymentsOptions = {}) {
      return rows
        .filter((r) => r.userId === userId && (!kind || r.kind === kind))
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
}

/** In-memory exchanged agent sessions. Lost on restart, which forces a new agent login. */
export function memorySessionStore(): SessionStore {
  const sessions = new Map<string, AgentSession>();
  return {
    async getSession(hash) {
      const row = sessions.get(hash);
      return row ? { ...row } : null;
    },
    async putSession(session) {
      sessions.set(session.accessTokenHash, { ...session });
    },
  };
}
