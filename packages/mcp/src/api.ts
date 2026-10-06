/**
 * Small fetch client for the M2M Payments HTTP API (docs/API.md).
 *
 * It holds one user bearer token and forwards it on every call. It never holds
 * Crossmint keys or a signer. Method names follow the API routes one to one.
 */
import type {
  AccessRequest,
  Amount,
  CreateAccessRequestInput,
  CreateTopUpRequestInput,
  Me,
  OnchainResult,
  Payment,
  PaymentKind,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  PublicConfig,
  TopUpRequest,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";

export type {
  AccessRequest,
  Amount,
  CreateAccessRequestInput,
  CreateTopUpRequestInput,
  Me,
  OnchainResult,
  Payment,
  PaymentKind,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  PublicConfig,
  TopUpRequest,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** `details` of an `access_required` or `access_pending` error. */
export interface AccessRequiredDetails {
  requestId?: string;
  approvalUrl?: string;
}

/** `details` of an `insufficient_funds` error. Both amounts are in credits. */
export interface InsufficientFundsDetails {
  balance?: Amount;
  required?: Amount;
}

export class M2mPaymentsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly url: string;

  constructor(opts: {
    status: number;
    url: string;
    code?: string;
    message?: string;
    details?: unknown;
  }) {
    super(opts.message ?? `M2M Payments request failed with ${opts.status}`);
    this.name = "M2mPaymentsApiError";
    this.status = opts.status;
    this.code = opts.code ?? statusToCode(opts.status);
    this.details = opts.details;
    this.url = opts.url;
  }

  /** The approval link, when the error is `access_required` or `access_pending`. */
  get accessDetails(): AccessRequiredDetails | undefined {
    if (this.code !== "access_required" && this.code !== "access_pending") return undefined;
    return isRecord(this.details) ? (this.details as AccessRequiredDetails) : {};
  }

  /** Balance and required amount, when the error is `insufficient_funds`. */
  get fundsDetails(): InsufficientFundsDetails | undefined {
    if (this.code !== "insufficient_funds") return undefined;
    return isRecord(this.details) ? (this.details as InsufficientFundsDetails) : {};
  }
}

function statusToCode(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 402) return "insufficient_funds";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "access_pending";
  if (status >= 400 && status < 500) return "invalid_request";
  return "internal";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface M2mPaymentsApiOptions {
  /** M2M Payments API base URL including the mount prefix, e.g. `https://wallet.example.com/api/m2m-payments`. */
  baseUrl: string;
  /** The user's JWT. Optional only for `config()`. */
  bearerToken?: string;
  fetch?: typeof fetch;
}

export interface ListPaymentsOptions {
  limit?: number;
  kind?: PaymentKind;
}

export class M2mPaymentsApi {
  readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: M2mPaymentsApiOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.bearerToken;
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  config(): Promise<PublicConfig> {
    return this.call("GET", "/v1/config", { auth: false });
  }

  me(): Promise<Me> {
    return this.call("GET", "/v1/me");
  }

  getWallet(): Promise<WalletView> {
    return this.call("GET", "/v1/wallet");
  }

  getBalance(): Promise<WalletBalance> {
    return this.call("GET", "/v1/wallet/balance");
  }

  createAccessRequest(input: CreateAccessRequestInput = {}): Promise<AccessRequest> {
    return this.call("POST", "/v1/access-requests", { body: input });
  }

  getAccessRequest(id: string): Promise<AccessRequest> {
    return this.call("GET", `/v1/access-requests/${enc(id)}`);
  }

  createTopUpRequest(input: CreateTopUpRequestInput): Promise<TopUpRequest> {
    return this.call("POST", "/v1/top-up-requests", { body: input });
  }

  getTopUpRequest(id: string): Promise<TopUpRequest> {
    return this.call("GET", `/v1/top-up-requests/${enc(id)}`);
  }

  payX402(input: ProtocolPaymentInput): Promise<ProtocolPaymentResult> {
    return this.call("POST", "/v1/payments/x402", { body: input });
  }

  payMpp(input: ProtocolPaymentInput): Promise<ProtocolPaymentResult> {
    return this.call("POST", "/v1/payments/mpp", { body: input });
  }

  transfer(input: TransferInput): Promise<OnchainResult> {
    return this.call("POST", "/v1/transfers", { body: input });
  }

  sendTransaction(input: TransactionInput): Promise<OnchainResult> {
    return this.call("POST", "/v1/transactions", { body: input });
  }

  async listPayments(opts: ListPaymentsOptions = {}): Promise<Payment[]> {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.kind) params.set("kind", opts.kind);
    const query = params.toString();
    const res = await this.call<{ payments: Payment[] }>(
      "GET",
      `/v1/payments${query ? `?${query}` : ""}`,
    );
    return res.payments;
  }

  private async call<T>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (opts.auth !== false) {
      if (!this.token)
        throw new M2mPaymentsApiError({
          status: 401,
          url,
          code: "unauthorized",
          message: "No bearer token.",
        });
      headers.Authorization = `Bearer ${this.token}`;
    }
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }
    if (!res.ok) {
      const err = (
        json as { error?: { code?: string; message?: string; details?: unknown } } | undefined
      )?.error;
      throw new M2mPaymentsApiError({
        status: res.status,
        url,
        code: err?.code,
        message: err?.message ?? (typeof json === "string" ? json : undefined),
        details: err?.details,
      });
    }
    return json as T;
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
