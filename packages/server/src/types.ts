import type { UserAuth } from "@m2m-payments/auth";
import type {
  AccessRequest,
  Amount,
  CrossmintEnvironment,
  Payment,
  PaymentKind,
  TopUpRequest,
} from "@m2m-payments/core";
import type { WalletsClient } from "@m2m-payments/core/server";

export type {
  AccessRequest,
  AccessRequestStatus,
  Amount,
  ErrorBody,
  Payment,
  PaymentKind,
  PaymentStatus,
  PublicConfig,
  TopUpRequest,
  TopUpRequestStatus,
} from "@m2m-payments/core";

// ---------------------------------------------------------------------------
// Access requests: the agent asking to use the wallet
// ---------------------------------------------------------------------------

/** What the handler gives the store. The store sets `createdAt` and `updatedAt`. */
export type NewAccessRequest = Omit<AccessRequest, "createdAt" | "updatedAt">;

/** Fields a handler may change after creation. */
export type AccessRequestPatch = Partial<
  Pick<AccessRequest, "status" | "signerLocator" | "failureReason">
>;

export interface AccessRequestStore {
  createAccessRequest(req: NewAccessRequest): Promise<AccessRequest>;
  getAccessRequest(id: string): Promise<AccessRequest | null>;
  /** Apply the patch and set `updatedAt`. Throws when the id is unknown. */
  updateAccessRequest(id: string, patch: AccessRequestPatch): Promise<AccessRequest>;
  /** The latest `pending` or `approved` request for the user, if any. */
  findOpenAccessRequest(userId: string): Promise<AccessRequest | null>;
  /** Optional. Newest first. */
  listAccessRequests?(userId: string): Promise<AccessRequest[]>;
}

// ---------------------------------------------------------------------------
// Wallet access: which signer is ours on the user's wallet
// ---------------------------------------------------------------------------

/**
 * One row per user. Crossmint is the truth about whether the signer is
 * approved; this row says which signer locator belongs to this deployment
 * and when the user granted or revoked it.
 */
export interface WalletAccess {
  userId: string;
  /** "server:0x..." */
  signerLocator: string;
  grantedAt: string;
  revokedAt?: string;
}

export interface WalletAccessStore {
  getWalletAccess(userId: string): Promise<WalletAccess | null>;
  /** Insert or replace the user's row. */
  putWalletAccess(row: WalletAccess): Promise<void>;
}

// ---------------------------------------------------------------------------
// Top-up requests: the agent asking for credits
// ---------------------------------------------------------------------------

export type NewTopUpRequest = Omit<TopUpRequest, "createdAt" | "updatedAt">;

export type TopUpRequestPatch = Partial<
  Pick<TopUpRequest, "status" | "orderId" | "received" | "failureReason">
>;

export interface TopUpRequestStore {
  createTopUpRequest(req: NewTopUpRequest): Promise<TopUpRequest>;
  getTopUpRequest(id: string): Promise<TopUpRequest | null>;
  /** Apply the patch and set `updatedAt`. Throws when the id is unknown. */
  updateTopUpRequest(id: string, patch: TopUpRequestPatch): Promise<TopUpRequest>;
}

// ---------------------------------------------------------------------------
// Top-up orders: order id to user and request, so a poll finds its request
// ---------------------------------------------------------------------------

export interface TopUpOrder {
  orderId: string;
  userId: string;
  /** The top-up request the order pays, when there is one. */
  requestId?: string;
  /** Credits the order buys. */
  amount: Amount;
  /** The saved card that paid, once `pay` ran. */
  paymentMethodId?: string;
  /** The `payments` row written on completion. Set once, so a poll never writes two. */
  completedPaymentId?: string;
  createdAt: string;
}

export interface TopUpOrderStore {
  /** Insert the row, or update the optional fields the caller named. */
  linkTopUpOrder(row: TopUpOrder): Promise<void>;
  getTopUpOrder(orderId: string): Promise<TopUpOrder | null>;
}

// ---------------------------------------------------------------------------
// Payments: the ledger
// ---------------------------------------------------------------------------

export type NewPayment = Omit<Payment, "id" | "createdAt">;

export interface ListPaymentsOptions {
  /** Default 100. */
  limit?: number;
  kind?: PaymentKind;
}

export interface PaymentStore {
  recordPayment(payment: NewPayment): Promise<Payment>;
  /** Newest first. */
  listPayments(userId: string, options?: ListPaymentsOptions): Promise<Payment[]>;
}

// ---------------------------------------------------------------------------
// Agent sessions
// ---------------------------------------------------------------------------

/**
 * A Stytch session obtained by exchanging an agent's OAuth access token.
 * Keyed by a hash of the access token, never the token itself.
 */
export interface AgentSession {
  accessTokenHash: string;
  userId: string;
  /** Long-lived opaque Stytch session token. Treat as a secret. */
  sessionToken: string;
  /** Current short-lived session JWT, forwarded to Crossmint. */
  jwt: string;
  jwtExpiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionStore {
  getSession(accessTokenHash: string): Promise<AgentSession | null>;
  putSession(session: AgentSession): Promise<void>;
}

// ---------------------------------------------------------------------------
// The whole store
// ---------------------------------------------------------------------------

/**
 * Everything the server persists. Implement it for your database, or use
 * `memoryStore()` and `drizzleStore()` from `@m2m-payments/server/drizzle`.
 */
export type Store = AccessRequestStore &
  WalletAccessStore &
  TopUpRequestStore &
  TopUpOrderStore &
  PaymentStore &
  SessionStore;

/**
 * What `createM2mPaymentsHandlers` accepts. The two request stores are
 * required. The rest fall back to memory with a warning.
 */
export type ConfigStore = AccessRequestStore &
  TopUpRequestStore &
  Partial<WalletAccessStore> &
  Partial<TopUpOrderStore> &
  Partial<PaymentStore> &
  Partial<SessionStore>;

// ---------------------------------------------------------------------------
// Server config
// ---------------------------------------------------------------------------

export interface M2mPaymentsCrossmintConfig {
  /** Client-side key (`ck_...`). Used with the user JWT for saved cards and to pay an order. */
  clientApiKey: string;
  /** Server-side key (`sk_...`). Resolves the wallet, creates orders, runs the agent's payments. */
  serverApiKey: string;
  environment: CrossmintEnvironment;
  /** `M2M_PAYMENTS_SIGNER_SECRET`: the agent's server signer. 64 hex chars or `xmsk1_<64 hex>`. */
  signerSecret: string;
  /** Override the Crossmint REST base URL, e.g. for a proxy. */
  baseUrl?: string;
  /** Custom fetch for the REST client. Tests inject a fake here. */
  fetch?: typeof fetch;
  /** `Origin` header for client-key calls. Defaults to `webBaseUrl`. Whitelist it in the Crossmint console. */
  origin?: string;
  /** Replace the wallets SDK client. Tests inject a fake here. */
  walletsClient?: WalletsClient;
}

export interface M2mPaymentsAuthConfig {
  provider: "stytch";
  projectId: string;
  environment: "test" | "live";
  cliClientId?: string;
  mcpClientId?: string;
  /** Custom Stytch domain, if any. Defaults to Stytch's public project base. */
  projectDomain?: string;
  /** @deprecated Use `projectDomain`. */
  customDomain?: string;
  /** The hosted consent page. Default `${webBaseUrl}/oauth/authorize`. */
  authorizationUrl?: string;
}

export interface M2mPaymentsServerConfig {
  crossmint: M2mPaymentsCrossmintConfig;
  userAuth: UserAuth;
  store: ConfigStore;
  /** For `approvalUrl`. No trailing slash. */
  webBaseUrl: string;
  /** For `GET /v1/config`. No trailing slash. */
  apiBaseUrl: string;
  auth: M2mPaymentsAuthConfig;
  /** The demo paid endpoints, shown in `GET /v1/config`. */
  demo?: { x402Url?: string; mppUrl?: string };
  x402?: { facilitatorUrl?: string };
  /** Default 15. */
  requestTtlMinutes?: number;
  /** Default "Agent". */
  defaultRequester?: string;
  /** Most credits one x402 or MPP call may pay. Default "1.00". */
  maxPayment?: string;
  /** Seed the staging identity record before an order. Default true on staging, false on production. */
  stagingIdentityFixture?: boolean;
  /** Shown in `GET /v1/config`. Default "M2M Payments". */
  name?: string;
}
