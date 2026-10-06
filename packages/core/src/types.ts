/**
 * The shapes every surface shares. They follow docs/API.md line by line: the
 * server returns them, the UI, the CLI, the MCP server and the chat read them.
 */

export type CrossmintEnvironment = "staging" | "production";

/** Decimal string amount in major units, e.g. "12.50", with a currency. Credits use "CRED". */
export interface Amount {
  value: string;
  currency: string;
}

export interface TokenInfo {
  /** "CRED" */
  symbol: string;
  /** "Credits" */
  name: string;
  decimals: number;
  /** "base-sepolia" | "base" */
  chain: string;
  /** The on-chain asset behind the credits. Shown only in developer surfaces. */
  underlying: { symbol: string; address: string; locator: string };
}

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type AgentAccessStatus = "none" | "pending" | "active" | "revoked";

export interface AgentAccess {
  status: AgentAccessStatus;
  /** The agent's server signer, e.g. "server:0x...". Set once approved. */
  signerLocator?: string;
  /** The open access request, while pending. */
  requestId?: string;
  approvalUrl?: string;
  grantedAt?: string;
  revokedAt?: string;
}

export interface WalletView {
  address: string;
  chain: string;
  token: TokenInfo;
  /** Credits. */
  balance: Amount;
  agentAccess: AgentAccess;
  explorerUrl: string;
}

export interface WalletBalance {
  balance: Amount;
  token: TokenInfo;
  address: string;
}

export interface ActivityItem {
  id: string;
  direction: "in" | "out";
  amount: Amount;
  counterparty?: string;
  hash?: string;
  explorerUrl?: string;
  completedAt: string;
}

// ---------------------------------------------------------------------------
// Access requests: the agent asking to use the wallet
// ---------------------------------------------------------------------------

export type AccessRequestStatus =
  "pending" | "approved" | "active" | "denied" | "expired" | "failed";

export interface AccessRequest {
  /** "acs_" + 21 url-safe chars. */
  id: string;
  userId: string;
  /** "Claude Code", "ChatGPT", app name. */
  requester: string;
  /** What the agent will do, in its words. */
  reason?: string;
  /** How long the user has to answer, ISO. */
  requestExpiresAt: string;
  status: AccessRequestStatus;
  /** The server signer, once prepared. */
  signerLocator?: string;
  failureReason?: string;
  /** `${webBaseUrl}/approve/${id}` */
  approvalUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccessRequestInput {
  reason?: string;
  requester?: string;
}

export interface ApproveAccessRequestResult {
  request: AccessRequest;
  signerLocator: string;
  /** The pending operation the user approves with the email signer. One of the two is set. */
  signatureId?: string;
  transactionId?: string;
}

export interface ConfirmAccessRequestResult {
  request: AccessRequest;
  wallet: WalletView;
}

export interface RevokeAccessResult {
  signerLocator: string;
  signatureId?: string;
  transactionId?: string;
}

// ---------------------------------------------------------------------------
// Top-up requests and top-ups: the onramp
// ---------------------------------------------------------------------------

export type TopUpRequestStatus =
  "pending" | "paying" | "completed" | "denied" | "expired" | "failed";

export interface TopUpRequest {
  /** "tup_" + 21 url-safe chars. */
  id: string;
  userId: string;
  requester: string;
  /** Credits asked for. */
  amount: Amount;
  reason?: string;
  requestExpiresAt: string;
  status: TopUpRequestStatus;
  /** The Crossmint order, once the user starts paying. */
  orderId?: string;
  /** Credits delivered, once completed. */
  received?: Amount;
  failureReason?: string;
  /** `${webBaseUrl}/top-up/${id}` */
  approvalUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTopUpRequestInput {
  /** Credits. A bare decimal string is accepted too. */
  amount: Amount | string;
  reason?: string;
  requester?: string;
}

export type TopUpPhase = "awaiting-payment" | "processing" | "completed" | "failed";

export interface TopUpQuote {
  /** Credits the wallet receives. */
  receive: Amount;
  /** USD per credit. */
  unitPrice?: string;
  /** USD. */
  fees: string;
  /** USD the card is charged. */
  total: string;
  /** "USD" */
  currency: string;
}

export interface TopUpView {
  orderId: string;
  requestId?: string;
  phase: TopUpPhase;
  quote: TopUpQuote;
  paymentStatus?: string;
  deliveryStatus?: string;
  /** For the embedded checkout, when a wallet pay button is used. */
  clientSecret?: string;
  failureReason?: string;
  createdAt: string;
}

export interface CreateTopUpInput {
  /** Credits, decimal string. */
  amount: string;
  requestId?: string;
}

export interface PayTopUpInput {
  paymentMethodId: string;
}

// ---------------------------------------------------------------------------
// Payment methods (saved cards). Kept from the Agent Commerce sample app.
// ---------------------------------------------------------------------------

export interface CardDetails {
  brand: string;
  last4: string;
  bin?: string;
  fundingType?: string;
  country?: string;
  expiration?: { month: string; year: string };
}

export interface PaymentMethodDisplay {
  /** Card network artwork, e.g. `https://www.crossmint.com/assets/cards/visa.svg`. */
  imageUrl?: string;
  label?: string;
}

export interface PaymentMethod {
  paymentMethodId: string;
  type: "card" | (string & {});
  displayName?: string;
  default?: boolean;
  createdAt?: string;
  updatedAt?: string;
  card?: CardDetails;
  display?: PaymentMethodDisplay;
}

export interface PaymentMethodList {
  paymentMethods: PaymentMethod[];
  nextCursor?: string;
}

// ---------------------------------------------------------------------------
// Payments: what the agent did with the wallet
// ---------------------------------------------------------------------------

export type PaymentKind = "x402" | "mpp" | "transfer" | "transaction" | "top-up";
export type PaymentStatus = "succeeded" | "failed";

export interface Payment {
  /** "pay_" + 21 url-safe chars. */
  id: string;
  userId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  /** Credits moved, when known. */
  amount?: Amount;
  /** The URL host for x402 and MPP, the address for transfers and transactions, the card for top-ups. */
  counterparty?: string;
  /** The agent's memo, or the endpoint's description. */
  description?: string;
  hash?: string;
  explorerUrl?: string;
  requester?: string;
  failureReason?: string;
  createdAt: string;
}

/** Body of POST /v1/payments/x402 and /v1/payments/mpp. */
export interface ProtocolPaymentInput {
  url: string;
  /** Default GET. */
  method?: string;
  headers?: Record<string, string>;
  /** Already serialized. JSON callers stringify first. */
  body?: string;
  /** Most credits this one call may pay. Default: the server's `maxPayment`. */
  maxAmount?: string;
  memo?: string;
  requester?: string;
}

export interface ProtocolSettlement {
  transaction?: string;
  network?: string;
  payer?: string;
  reference?: string;
}

export interface ProtocolResponse {
  status: number;
  /** content-type and the protocol's receipt headers only. */
  headers: Record<string, string>;
  /** Text, cut at 16 kB. */
  body: string;
  truncated: boolean;
}

export interface ProtocolPaymentResult {
  payment: Payment;
  /** False when the endpoint answered without asking for money. */
  paid: boolean;
  /** Credits the endpoint charged. */
  amount?: Amount;
  settlement?: ProtocolSettlement;
  response: ProtocolResponse;
}

export interface TransferInput {
  to: string;
  /** Credits, decimal string. */
  amount: string;
  memo?: string;
  requester?: string;
}

export interface TransactionInput {
  to: string;
  data?: `0x${string}` | string;
  /** Wei, decimal string. Default "0". */
  value?: string;
  memo?: string;
  requester?: string;
}

export interface OnchainResult {
  payment: Payment;
  hash: string;
  explorerUrl: string;
  transactionId: string;
}

// ---------------------------------------------------------------------------
// Public config
// ---------------------------------------------------------------------------

export interface PublicConfig {
  name: string;
  apiBaseUrl: string;
  webBaseUrl: string;
  crossmintEnvironment: CrossmintEnvironment;
  token: TokenInfo;
  demo?: { x402Url?: string; mppUrl?: string };
  auth: {
    provider: "stytch" | (string & {});
    projectId: string;
    environment: "test" | "live";
    /** The OAuth authorization server base. MCP hosts discover metadata under it. */
    authorizationServer: string;
    oauth: {
      authorizationEndpoint?: string;
      tokenEndpoint: string;
      cliClientId?: string;
      mcpClientId?: string;
      scopes: string[];
    };
  };
}

export interface Me {
  userId: string;
  email?: string;
}

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}
