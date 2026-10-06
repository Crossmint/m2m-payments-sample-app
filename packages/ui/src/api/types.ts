/**
 * Shapes the M2M Payments HTTP API returns. They follow docs/API.md line by
 * line and live in @m2m-payments/core, so the server, the CLI, the MCP server
 * and this client read one definition. This file names the ones the browser
 * client uses and adds the error envelope.
 */
import type {
  AccessRequest,
  AccessRequestStatus,
  ActivityItem,
  AgentAccess,
  AgentAccessStatus,
  Amount,
  ApproveAccessRequestResult,
  ConfirmAccessRequestResult,
  CreateAccessRequestInput,
  CreateTopUpInput,
  CreateTopUpRequestInput,
  CrossmintEnvironment,
  Me,
  OnchainResult,
  PayTopUpInput,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentMethodList,
  PaymentStatus,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  PublicConfig,
  RevokeAccessResult,
  TokenInfo,
  TopUpPhase,
  TopUpQuote,
  TopUpRequest,
  TopUpRequestStatus,
  TopUpView,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";

export type {
  AccessRequest,
  AccessRequestStatus,
  ActivityItem,
  AgentAccess,
  AgentAccessStatus,
  Amount,
  ApproveAccessRequestResult,
  ConfirmAccessRequestResult,
  CreateAccessRequestInput,
  CreateTopUpInput,
  CreateTopUpRequestInput,
  CrossmintEnvironment,
  Me,
  OnchainResult,
  PayTopUpInput,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentMethodList,
  PaymentStatus,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  PublicConfig,
  RevokeAccessResult,
  TokenInfo,
  TopUpPhase,
  TopUpQuote,
  TopUpRequest,
  TopUpRequestStatus,
  TopUpView,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
};

/** `GET /v1/config`. The same object as `PublicConfig` in core. */
export type M2mPaymentsConfig = PublicConfig;

export interface M2mPaymentsErrorEnvelope {
  error: { code: string; message: string; details?: Record<string, unknown> };
}

/** The codes docs/API.md names. Unknown codes pass through as strings. */
export type M2mPaymentsErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "invalid_request"
  | "expired"
  | "wallet_not_found"
  | "access_required"
  | "access_pending"
  | "insufficient_funds"
  | "payment_failed"
  | "top_up_failed"
  | "crossmint_error"
  | "internal"
  | (string & {});

/** Query for `GET /v1/payments`. */
export interface ListPaymentsOptions {
  limit?: number;
  kind?: PaymentKind;
}
