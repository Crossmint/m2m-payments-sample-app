import type {
  AccessRequest,
  CreateAccessRequestInput,
  CreateTopUpRequestInput,
  OnchainResult,
  Payment,
  PaymentKind,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  TopUpRequest,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";
import { serverEnv } from "@/lib/env";
import { getM2mPaymentsHandlers } from "@/lib/api-server";

/**
 * Calls the M2M Payments API in process. The chat tools build a `Request` for
 * the same `/api/m2m-payments/v1/...` paths the browser, the CLI and the MCP
 * server use and hand it to the mounted handlers with the user's session
 * JWT. One code path, no HTTP round trip. Paths follow docs/API.md.
 */

export class M2mPaymentsToolError extends Error {
  readonly status: number;
  readonly code: string;
  /** `details` from the error body: requestId and approvalUrl, balance and required, and so on. */
  readonly details: Record<string, unknown> | undefined;
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "M2mPaymentsToolError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Method = "GET" | "POST" | "DELETE";

export function apiClient(jwt: string) {
  async function call<T>(method: Method, path: string, body?: unknown): Promise<T> {
    const handlers = await getM2mPaymentsHandlers();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${jwt}`,
      Accept: "application/json",
    };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    // The router matches on the path after "/v1/", so the origin only needs to parse.
    const res = await handlers.handler(
      new Request(`${serverEnv.apiBaseUrl()}/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      const err = (
        json as
          | { error?: { code?: string; message?: string; details?: Record<string, unknown> } }
          | undefined
      )?.error;
      throw new M2mPaymentsToolError(
        res.status,
        err?.code ?? "internal",
        err?.message ?? `M2M Payments API returned ${res.status}`,
        err?.details,
      );
    }
    return json as T;
  }

  const enc = encodeURIComponent;

  return {
    getWallet: () => call<WalletView>("GET", "/wallet"),
    getBalance: () => call<WalletBalance>("GET", "/wallet/balance"),
    createAccessRequest: (input: CreateAccessRequestInput) =>
      call<AccessRequest>("POST", "/access-requests", input),
    getAccessRequest: (id: string) => call<AccessRequest>("GET", `/access-requests/${enc(id)}`),
    createTopUpRequest: (input: CreateTopUpRequestInput) =>
      call<TopUpRequest>("POST", "/top-up-requests", input),
    getTopUpRequest: (id: string) => call<TopUpRequest>("GET", `/top-up-requests/${enc(id)}`),
    listPayments: async (opts: { limit?: number; kind?: PaymentKind } = {}) => {
      const params = new URLSearchParams();
      if (opts.limit) params.set("limit", String(opts.limit));
      if (opts.kind) params.set("kind", opts.kind);
      const qs = params.toString();
      return (await call<{ payments: Payment[] }>("GET", `/payments${qs ? `?${qs}` : ""}`))
        .payments;
    },
    payX402: (input: ProtocolPaymentInput) =>
      call<ProtocolPaymentResult>("POST", "/payments/x402", input),
    payMpp: (input: ProtocolPaymentInput) =>
      call<ProtocolPaymentResult>("POST", "/payments/mpp", input),
    transfer: (input: TransferInput) => call<OnchainResult>("POST", "/transfers", input),
    sendTransaction: (input: TransactionInput) =>
      call<OnchainResult>("POST", "/transactions", input),
  };
}

export type M2mPaymentsClient = ReturnType<typeof apiClient>;
