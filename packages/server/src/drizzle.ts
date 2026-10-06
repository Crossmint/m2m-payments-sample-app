/**
 * Postgres schema and Drizzle store for `@m2m-payments/server`.
 * Import from "@m2m-payments/server/drizzle". Needs `drizzle-orm` installed.
 */
import type {
  AccessRequest,
  AccessRequestStatus,
  Amount,
  Payment,
  PaymentKind,
  PaymentStatus,
  TopUpRequest,
  TopUpRequestStatus,
} from "@m2m-payments/core";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  type PgDatabase,
  type PgQueryResultHKT,
} from "drizzle-orm/pg-core";
import { paymentId } from "./ids.js";
import type {
  AccessRequestPatch,
  AgentSession,
  ListPaymentsOptions,
  NewAccessRequest,
  NewPayment,
  NewTopUpRequest,
  Store,
  TopUpOrder,
  TopUpRequestPatch,
  WalletAccess,
} from "./types.js";

const tz = { withTimezone: true, mode: "date" } as const;

/** The agent's ask to use the wallet, until the user answers. */
export const accessRequests = pgTable("access_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requester: text("requester").notNull(),
  reason: text("reason"),
  requestExpiresAt: timestamp("request_expires_at", tz).notNull(),
  status: text("status").$type<AccessRequestStatus>().notNull(),
  signerLocator: text("signer_locator"),
  failureReason: text("failure_reason"),
  approvalUrl: text("approval_url").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** One row per user: which server signer is ours, and when it was granted or revoked. */
export const walletAccess = pgTable("wallet_access", {
  userId: text("user_id").primaryKey(),
  signerLocator: text("signer_locator").notNull(),
  grantedAt: timestamp("granted_at", tz).notNull(),
  revokedAt: timestamp("revoked_at", tz),
});

/** The agent's ask for credits, until the user pays or declines. */
export const topUpRequests = pgTable("top_up_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  requester: text("requester").notNull(),
  amount: jsonb("amount").$type<Amount>().notNull(),
  reason: text("reason"),
  requestExpiresAt: timestamp("request_expires_at", tz).notNull(),
  status: text("status").$type<TopUpRequestStatus>().notNull(),
  orderId: text("order_id"),
  received: jsonb("received").$type<Amount>(),
  failureReason: text("failure_reason"),
  approvalUrl: text("approval_url").notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

/** Order id to user and request, so a poll can find its request. */
export const topUpOrders = pgTable("top_up_orders", {
  orderId: text("order_id").primaryKey(),
  userId: text("user_id").notNull(),
  requestId: text("request_id"),
  amount: jsonb("amount").$type<Amount>().notNull(),
  paymentMethodId: text("payment_method_id"),
  completedPaymentId: text("completed_payment_id"),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
});

/** The ledger: every x402 call, MPP call, transfer, transaction and completed top-up. Never a key. */
export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<PaymentKind>().notNull(),
    status: text("status").$type<PaymentStatus>().notNull(),
    amount: jsonb("amount").$type<Amount>(),
    counterparty: text("counterparty"),
    description: text("description"),
    hash: text("hash"),
    explorerUrl: text("explorer_url"),
    requester: text("requester"),
    failureReason: text("failure_reason"),
    createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  },
  (t) => [index("payments_user_id_created_at_idx").on(t.userId, t.createdAt)],
);

/** Stytch sessions exchanged from agent access tokens. Keyed by token hash. */
export const agentSessions = pgTable("agent_sessions", {
  accessTokenHash: text("access_token_hash").primaryKey(),
  userId: text("user_id").notNull(),
  sessionToken: text("session_token").notNull(),
  jwt: text("jwt").notNull(),
  jwtExpiresAt: timestamp("jwt_expires_at", tz).notNull(),
  createdAt: timestamp("created_at", tz).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", tz).notNull().defaultNow(),
});

export const m2mPaymentsSchema = {
  accessRequests,
  walletAccess,
  topUpRequests,
  topUpOrders,
  payments,
  agentSessions,
};

/** Any Drizzle Postgres database: node-postgres, postgres.js, Neon, Vercel Postgres. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPgDatabase = PgDatabase<PgQueryResultHKT, any, any>;

/**
 * The whole store on Postgres.
 * Create the tables with drizzle-kit from `m2mPaymentsSchema`, or run the SQL in the README.
 */
export function drizzleStore(db: AnyPgDatabase): Store {
  return {
    // -- access requests --------------------------------------------------

    async createAccessRequest(req: NewAccessRequest): Promise<AccessRequest> {
      const now = new Date();
      const [row] = await db
        .insert(accessRequests)
        .values({
          id: req.id,
          userId: req.userId,
          requester: req.requester,
          reason: req.reason ?? null,
          requestExpiresAt: new Date(req.requestExpiresAt),
          status: req.status,
          signerLocator: req.signerLocator ?? null,
          failureReason: req.failureReason ?? null,
          approvalUrl: req.approvalUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toAccessRequest(row!);
    },

    async getAccessRequest(id: string): Promise<AccessRequest | null> {
      const [row] = await db
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.id, id))
        .limit(1);
      return row ? toAccessRequest(row) : null;
    },

    async updateAccessRequest(id: string, patch: AccessRequestPatch): Promise<AccessRequest> {
      const set: Partial<typeof accessRequests.$inferInsert> = { updatedAt: new Date() };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.signerLocator !== undefined) set.signerLocator = patch.signerLocator;
      if (patch.failureReason !== undefined) set.failureReason = patch.failureReason;
      const [row] = await db
        .update(accessRequests)
        .set(set)
        .where(eq(accessRequests.id, id))
        .returning();
      if (!row) throw new Error(`Unknown access request ${id}`);
      return toAccessRequest(row);
    },

    async findOpenAccessRequest(userId: string): Promise<AccessRequest | null> {
      const [row] = await db
        .select()
        .from(accessRequests)
        .where(
          and(
            eq(accessRequests.userId, userId),
            inArray(accessRequests.status, ["pending", "approved"]),
          ),
        )
        .orderBy(desc(accessRequests.createdAt))
        .limit(1);
      return row ? toAccessRequest(row) : null;
    },

    async listAccessRequests(userId: string): Promise<AccessRequest[]> {
      const rows = await db
        .select()
        .from(accessRequests)
        .where(eq(accessRequests.userId, userId))
        .orderBy(desc(accessRequests.createdAt));
      return rows.map(toAccessRequest);
    },

    // -- wallet access ----------------------------------------------------

    async getWalletAccess(userId: string): Promise<WalletAccess | null> {
      const [row] = await db
        .select()
        .from(walletAccess)
        .where(eq(walletAccess.userId, userId))
        .limit(1);
      if (!row) return null;
      const out: WalletAccess = {
        userId: row.userId,
        signerLocator: row.signerLocator,
        grantedAt: row.grantedAt.toISOString(),
      };
      if (row.revokedAt) out.revokedAt = row.revokedAt.toISOString();
      return out;
    },

    async putWalletAccess(row: WalletAccess): Promise<void> {
      const values = {
        userId: row.userId,
        signerLocator: row.signerLocator,
        grantedAt: new Date(row.grantedAt),
        revokedAt: row.revokedAt ? new Date(row.revokedAt) : null,
      };
      await db
        .insert(walletAccess)
        .values(values)
        .onConflictDoUpdate({
          target: walletAccess.userId,
          set: {
            signerLocator: values.signerLocator,
            grantedAt: values.grantedAt,
            revokedAt: values.revokedAt,
          },
        });
    },

    // -- top-up requests --------------------------------------------------

    async createTopUpRequest(req: NewTopUpRequest): Promise<TopUpRequest> {
      const now = new Date();
      const [row] = await db
        .insert(topUpRequests)
        .values({
          id: req.id,
          userId: req.userId,
          requester: req.requester,
          amount: req.amount,
          reason: req.reason ?? null,
          requestExpiresAt: new Date(req.requestExpiresAt),
          status: req.status,
          orderId: req.orderId ?? null,
          received: req.received ?? null,
          failureReason: req.failureReason ?? null,
          approvalUrl: req.approvalUrl,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toTopUpRequest(row!);
    },

    async getTopUpRequest(id: string): Promise<TopUpRequest | null> {
      const [row] = await db.select().from(topUpRequests).where(eq(topUpRequests.id, id)).limit(1);
      return row ? toTopUpRequest(row) : null;
    },

    async updateTopUpRequest(id: string, patch: TopUpRequestPatch): Promise<TopUpRequest> {
      const set: Partial<typeof topUpRequests.$inferInsert> = { updatedAt: new Date() };
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.orderId !== undefined) set.orderId = patch.orderId;
      if (patch.received !== undefined) set.received = patch.received;
      if (patch.failureReason !== undefined) set.failureReason = patch.failureReason;
      const [row] = await db
        .update(topUpRequests)
        .set(set)
        .where(eq(topUpRequests.id, id))
        .returning();
      if (!row) throw new Error(`Unknown top-up request ${id}`);
      return toTopUpRequest(row);
    },

    // -- top-up orders ----------------------------------------------------

    async linkTopUpOrder(row: TopUpOrder): Promise<void> {
      // Only the named optional columns are written, so a later link keeps the rest.
      const set = {
        userId: row.userId,
        amount: row.amount,
        ...(row.requestId ? { requestId: row.requestId } : {}),
        ...(row.paymentMethodId ? { paymentMethodId: row.paymentMethodId } : {}),
        ...(row.completedPaymentId ? { completedPaymentId: row.completedPaymentId } : {}),
      };
      await db
        .insert(topUpOrders)
        .values({ orderId: row.orderId, createdAt: new Date(row.createdAt), ...set })
        .onConflictDoUpdate({ target: topUpOrders.orderId, set });
    },

    async getTopUpOrder(orderId: string): Promise<TopUpOrder | null> {
      const [row] = await db
        .select()
        .from(topUpOrders)
        .where(eq(topUpOrders.orderId, orderId))
        .limit(1);
      if (!row) return null;
      const out: TopUpOrder = {
        orderId: row.orderId,
        userId: row.userId,
        amount: row.amount,
        createdAt: row.createdAt.toISOString(),
      };
      if (row.requestId) out.requestId = row.requestId;
      if (row.paymentMethodId) out.paymentMethodId = row.paymentMethodId;
      if (row.completedPaymentId) out.completedPaymentId = row.completedPaymentId;
      return out;
    },

    // -- payments ---------------------------------------------------------

    async recordPayment(payment: NewPayment): Promise<Payment> {
      const [row] = await db
        .insert(payments)
        .values({
          id: paymentId(),
          userId: payment.userId,
          kind: payment.kind,
          status: payment.status,
          amount: payment.amount ?? null,
          counterparty: payment.counterparty ?? null,
          description: payment.description ?? null,
          hash: payment.hash ?? null,
          explorerUrl: payment.explorerUrl ?? null,
          requester: payment.requester ?? null,
          failureReason: payment.failureReason ?? null,
          createdAt: new Date(),
        })
        .returning();
      return toPayment(row!);
    },

    async listPayments(
      userId: string,
      { limit = 100, kind }: ListPaymentsOptions = {},
    ): Promise<Payment[]> {
      const rows = await db
        .select()
        .from(payments)
        .where(
          kind
            ? and(eq(payments.userId, userId), eq(payments.kind, kind))
            : eq(payments.userId, userId),
        )
        .orderBy(desc(payments.createdAt))
        .limit(limit);
      return rows.map(toPayment);
    },

    // -- agent sessions ---------------------------------------------------

    async getSession(accessTokenHash: string): Promise<AgentSession | null> {
      const [row] = await db
        .select()
        .from(agentSessions)
        .where(eq(agentSessions.accessTokenHash, accessTokenHash))
        .limit(1);
      if (!row) return null;
      return {
        accessTokenHash: row.accessTokenHash,
        userId: row.userId,
        sessionToken: row.sessionToken,
        jwt: row.jwt,
        jwtExpiresAt: row.jwtExpiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },

    async putSession(session: AgentSession): Promise<void> {
      const values = {
        accessTokenHash: session.accessTokenHash,
        userId: session.userId,
        sessionToken: session.sessionToken,
        jwt: session.jwt,
        jwtExpiresAt: new Date(session.jwtExpiresAt),
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
      };
      await db
        .insert(agentSessions)
        .values(values)
        .onConflictDoUpdate({
          target: agentSessions.accessTokenHash,
          set: {
            jwt: values.jwt,
            jwtExpiresAt: values.jwtExpiresAt,
            sessionToken: values.sessionToken,
            updatedAt: values.updatedAt,
          },
        });
    },
  };
}

/** The name the reference app imports. Same as `drizzleStore`. */
export const drizzleRequestStore = drizzleStore;

function toAccessRequest(row: typeof accessRequests.$inferSelect): AccessRequest {
  const out: AccessRequest = {
    id: row.id,
    userId: row.userId,
    requester: row.requester,
    requestExpiresAt: row.requestExpiresAt.toISOString(),
    status: row.status,
    approvalUrl: row.approvalUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.reason) out.reason = row.reason;
  if (row.signerLocator) out.signerLocator = row.signerLocator;
  if (row.failureReason) out.failureReason = row.failureReason;
  return out;
}

function toTopUpRequest(row: typeof topUpRequests.$inferSelect): TopUpRequest {
  const out: TopUpRequest = {
    id: row.id,
    userId: row.userId,
    requester: row.requester,
    amount: row.amount,
    requestExpiresAt: row.requestExpiresAt.toISOString(),
    status: row.status,
    approvalUrl: row.approvalUrl,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.reason) out.reason = row.reason;
  if (row.orderId) out.orderId = row.orderId;
  if (row.received) out.received = row.received;
  if (row.failureReason) out.failureReason = row.failureReason;
  return out;
}

function toPayment(row: typeof payments.$inferSelect): Payment {
  const out: Payment = {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
  if (row.amount) out.amount = row.amount;
  if (row.counterparty) out.counterparty = row.counterparty;
  if (row.description) out.description = row.description;
  if (row.hash) out.hash = row.hash;
  if (row.explorerUrl) out.explorerUrl = row.explorerUrl;
  if (row.requester) out.requester = row.requester;
  if (row.failureReason) out.failureReason = row.failureReason;
  return out;
}
