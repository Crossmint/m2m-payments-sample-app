/**
 * Shapes the CLI reads from the M2M Payments HTTP API. They mirror docs/API.md
 * and come from @m2m-payments/core, so the server, the MCP server and the CLI
 * agree on every field. This file only re-exports them and adds the request
 * bodies the CLI builds.
 */
import type { PaymentKind } from "@m2m-payments/core";

export type {
  AccessRequest,
  AccessRequestStatus,
  AgentAccess,
  AgentAccessStatus,
  Amount,
  CreateAccessRequestInput,
  CreateTopUpRequestInput,
  ErrorBody,
  Me,
  OnchainResult,
  Payment,
  PaymentKind,
  PaymentStatus,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  ProtocolResponse,
  ProtocolSettlement,
  PublicConfig,
  TokenInfo,
  TopUpRequest,
  TopUpRequestStatus,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";

/** The error envelope every route answers with on failure. */
export interface ApiErrorEnvelope {
  error: { code: string; message: string; details?: unknown };
}

/** Query of `GET /v1/payments`. */
export interface ListPaymentsQuery {
  limit?: number;
  kind?: PaymentKind;
}

export const PAYMENT_KINDS: readonly PaymentKind[] = [
  "x402",
  "mpp",
  "transfer",
  "transaction",
  "top-up",
];
