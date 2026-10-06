import type {
  AccessRequest,
  ActivityItem,
  ApproveAccessRequestResult,
  ConfirmAccessRequestResult,
  CreateAccessRequestInput,
  CreateTopUpInput,
  CreateTopUpRequestInput,
  ListPaymentsOptions,
  M2mPaymentsConfig,
  M2mPaymentsErrorCode,
  M2mPaymentsErrorEnvelope,
  Me,
  OnchainResult,
  Payment,
  PaymentMethod,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  RevokeAccessResult,
  TopUpRequest,
  TopUpView,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "./types.js";

export class M2mPaymentsApiError extends Error {
  readonly status: number;
  readonly code: M2mPaymentsErrorCode;
  readonly details: Record<string, unknown> | undefined;

  constructor(status: number, envelope: M2mPaymentsErrorEnvelope["error"]) {
    super(envelope.message);
    this.name = "M2mPaymentsApiError";
    this.status = status;
    this.code = envelope.code;
    this.details = envelope.details;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  /** The user has no wallet yet. The browser creates it on first sign-in. */
  get isWalletNotFound(): boolean {
    return this.code === "wallet_not_found";
  }
}

export type GetJwt = () => string | null | undefined | Promise<string | null | undefined>;

export interface M2mPaymentsApiOptions {
  /** Where the M2M Payments server is mounted. Default "/api/m2m-payments". */
  baseUrl?: string;
  /** Returns the user's JWT. Called on every request so it is always fresh. */
  getJwt: GetJwt;
  /** Override fetch, for tests or custom agents. */
  fetch?: typeof fetch;
}

export type M2mPaymentsApi = ReturnType<typeof createM2mPaymentsApi>;

/**
 * Typed functions for every route in docs/API.md.
 * Throws `M2mPaymentsApiError` with the server's error envelope on any non-2xx.
 */
export function createM2mPaymentsApi(opts: M2mPaymentsApiOptions) {
  const baseUrl = (opts.baseUrl ?? "/api/m2m-payments").replace(/\/+$/, "");
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));

  async function request<T>(
    method: "GET" | "POST" | "DELETE" | "PUT",
    path: string,
    body?: unknown,
    { auth = true }: { auth?: boolean } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const jwt = await opts.getJwt();
      if (!jwt)
        throw new M2mPaymentsApiError(401, { code: "unauthorized", message: "Not signed in." });
      headers.Authorization = `Bearer ${jwt}`;
    }
    const res = await doFetch(`${baseUrl}/v1${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) {
      const envelope = isEnvelope(json)
        ? json.error
        : {
            code: res.status === 401 ? "unauthorized" : "internal",
            message: text || `Request failed with ${res.status}`,
          };
      throw new M2mPaymentsApiError(res.status, envelope);
    }
    return json as T;
  }

  const enc = encodeURIComponent;

  return {
    baseUrl,

    // Public config and identity
    getConfig: () => request<M2mPaymentsConfig>("GET", "/config", undefined, { auth: false }),
    me: () => request<Me>("GET", "/me"),

    // Wallet
    getWallet: () => request<WalletView>("GET", "/wallet"),
    getBalance: () => request<WalletBalance>("GET", "/wallet/balance"),
    getActivity: async (limit?: number) =>
      (
        await request<{ activity: ActivityItem[] }>(
          "GET",
          `/wallet/activity${limit ? `?limit=${limit}` : ""}`,
        )
      ).activity,
    /** Prepares removing the agent's signer. The browser approves it with the email signer, then calls `revokedAccess`. */
    revokeAccess: () => request<RevokeAccessResult>("POST", "/wallet/access/revoke", {}),
    revokedAccess: () => request<WalletView>("POST", "/wallet/access/revoked", {}),

    // Access requests
    createAccessRequest: (input: CreateAccessRequestInput = {}) =>
      request<AccessRequest>("POST", "/access-requests", input),
    getAccessRequest: (id: string) => request<AccessRequest>("GET", `/access-requests/${enc(id)}`),
    approveAccessRequest: (id: string) =>
      request<ApproveAccessRequestResult>("POST", `/access-requests/${enc(id)}/approve`, {}),
    confirmAccessRequest: (id: string) =>
      request<ConfirmAccessRequestResult>("POST", `/access-requests/${enc(id)}/confirm`, {}),
    denyAccessRequest: (id: string) =>
      request<AccessRequest>("POST", `/access-requests/${enc(id)}/deny`, {}),

    // Top-up requests
    createTopUpRequest: (input: CreateTopUpRequestInput) =>
      request<TopUpRequest>("POST", "/top-up-requests", input),
    getTopUpRequest: (id: string) => request<TopUpRequest>("GET", `/top-up-requests/${enc(id)}`),
    denyTopUpRequest: (id: string) =>
      request<TopUpRequest>("POST", `/top-up-requests/${enc(id)}/deny`, {}),

    // Top-ups (the onramp order)
    createTopUp: (input: CreateTopUpInput) => request<TopUpView>("POST", "/top-ups", input),
    payTopUp: (orderId: string, paymentMethodId: string) =>
      request<TopUpView>("POST", `/top-ups/${enc(orderId)}/pay`, { paymentMethodId }),
    getTopUp: (orderId: string) => request<TopUpView>("GET", `/top-ups/${enc(orderId)}`),

    // Payment methods (saved cards)
    listPaymentMethods: async () =>
      (await request<{ paymentMethods: PaymentMethod[] }>("GET", "/payment-methods"))
        .paymentMethods,
    deletePaymentMethod: (id: string) => request<void>("DELETE", `/payment-methods/${enc(id)}`),

    // Payments: the ledger and the agent operations
    listPayments: async ({ limit, kind }: ListPaymentsOptions = {}) => {
      const q = new URLSearchParams();
      if (limit) q.set("limit", String(limit));
      if (kind) q.set("kind", kind);
      const query = q.toString();
      return (await request<{ payments: Payment[] }>("GET", `/payments${query ? `?${query}` : ""}`))
        .payments;
    },
    payX402: (input: ProtocolPaymentInput) =>
      request<ProtocolPaymentResult>("POST", "/payments/x402", input),
    payMpp: (input: ProtocolPaymentInput) =>
      request<ProtocolPaymentResult>("POST", "/payments/mpp", input),
    transfer: (input: TransferInput) => request<OnchainResult>("POST", "/transfers", input),
    sendTransaction: (input: TransactionInput) =>
      request<OnchainResult>("POST", "/transactions", input),
  };
}

function isEnvelope(x: unknown): x is M2mPaymentsErrorEnvelope {
  return (
    typeof x === "object" &&
    x !== null &&
    "error" in x &&
    typeof (x as { error: unknown }).error === "object" &&
    (x as { error: unknown }).error !== null &&
    "code" in ((x as { error: object }).error as object)
  );
}

/** Human-readable message for any thrown value. */
export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (err instanceof M2mPaymentsApiError) return err.message || fallback;
  if (err instanceof Error) return err.message || fallback;
  if (typeof err === "string") return err;
  return fallback;
}
