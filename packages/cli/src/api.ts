import { refreshAccessToken } from "@m2m-payments/auth";
import type {
  AccessRequest,
  Amount,
  CreateAccessRequestInput,
  CreateTopUpRequestInput,
  Me,
  OnchainResult,
  Payment,
  ProtocolPaymentInput,
  ProtocolPaymentResult,
  PublicConfig,
  TopUpRequest,
  TransactionInput,
  TransferInput,
  WalletBalance,
  WalletView,
} from "@m2m-payments/core";
import type { ConfigStore, ResolvedConfig } from "./config.js";
import { EXIT, CliExit } from "./output.js";
import type { ApiErrorEnvelope, ListPaymentsQuery } from "./types.js";

/** Refresh the access token when it expires within this window. */
export const REFRESH_WINDOW_MS = 60_000;

/** An error envelope from the M2M Payments server, or a transport failure. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;
  constructor(opts: { code: string; message: string; status: number; details?: unknown }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.details = opts.details;
  }

  /**
   * Exit code for the CLI. `unauthorized` means the session is gone.
   * `access_required`, `access_pending` and `insufficient_funds` mean the user
   * has to do something in the browser, so they exit 2 like a pending request.
   */
  get exitCode(): number {
    if (this.code === "unauthorized") return EXIT.NOT_LOGGED_IN;
    if (this.needsUser) return EXIT.NEEDS_USER_ACTION;
    return EXIT.ERROR;
  }

  get needsUser(): boolean {
    return (
      this.code === "access_required" ||
      this.code === "access_pending" ||
      this.code === "insufficient_funds"
    );
  }

  /** `details.approvalUrl` and `details.requestId` on an access error. */
  get access(): { requestId?: string; approvalUrl?: string } | undefined {
    if (this.code !== "access_required" && this.code !== "access_pending") return undefined;
    return isRecord(this.details)
      ? (this.details as { requestId?: string; approvalUrl?: string })
      : {};
  }

  /** `details.balance` and `details.required` on `insufficient_funds`. */
  get funds(): { balance?: Amount; required?: Amount } | undefined {
    if (this.code !== "insufficient_funds") return undefined;
    return isRecord(this.details) ? (this.details as { balance?: Amount; required?: Amount }) : {};
  }

  override toString(): string {
    return `${this.code}: ${this.message}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ApiClientOptions {
  config: ResolvedConfig;
  fetch?: typeof fetch;
  /** Persists refreshed tokens. Omit to keep them in memory only. */
  store?: ConfigStore;
  now?: () => number;
}

export interface RequestOptions {
  body?: unknown;
  /** Skip the bearer header. Only `GET /v1/config` uses this. */
  noAuth?: boolean;
}

/** Public config needs no session. */
export async function fetchPublicConfig(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<PublicConfig> {
  const res = await fetchImpl(`${apiBaseUrl}/v1/config`, {
    headers: { Accept: "application/json" },
  });
  return parseResponse<PublicConfig>(res);
}

/**
 * Thin typed wrapper over the routes in docs/API.md.
 * Adds the bearer token, refreshes it when near expiry, and turns the
 * error envelope into an `ApiError`.
 */
export class M2mPaymentsApi {
  private config: ResolvedConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly store: ConfigStore | undefined;
  private readonly now: () => number;
  private refreshing: Promise<void> | null = null;

  constructor(opts: ApiClientOptions) {
    this.config = opts.config;
    this.fetchImpl = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.store = opts.store;
    this.now = opts.now ?? (() => Date.now());
  }

  get baseUrl(): string {
    return this.config.apiBaseUrl;
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (!opts.noAuth) headers.Authorization = `Bearer ${await this.accessToken()}`;
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
    } catch (e) {
      throw new ApiError({
        code: "network_error",
        status: 0,
        message: `Could not reach ${this.config.apiBaseUrl}: ${(e as Error).message}`,
      });
    }
    return parseResponse<T>(res);
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body: body ?? {} });
  }

  delete(path: string): Promise<void> {
    return this.request<void>("DELETE", path);
  }

  // --- Typed routes -------------------------------------------------------

  me(): Promise<Me> {
    return this.get("/v1/me");
  }

  getWallet(): Promise<WalletView> {
    return this.get("/v1/wallet");
  }

  getBalance(): Promise<WalletBalance> {
    return this.get("/v1/wallet/balance");
  }

  createAccessRequest(body: CreateAccessRequestInput = {}): Promise<AccessRequest> {
    return this.post("/v1/access-requests", body);
  }

  getAccessRequest(id: string): Promise<AccessRequest> {
    return this.get(`/v1/access-requests/${encodeURIComponent(id)}`);
  }

  createTopUpRequest(body: CreateTopUpRequestInput): Promise<TopUpRequest> {
    return this.post("/v1/top-up-requests", body);
  }

  getTopUpRequest(id: string): Promise<TopUpRequest> {
    return this.get(`/v1/top-up-requests/${encodeURIComponent(id)}`);
  }

  payX402(body: ProtocolPaymentInput): Promise<ProtocolPaymentResult> {
    return this.post("/v1/payments/x402", body);
  }

  payMpp(body: ProtocolPaymentInput): Promise<ProtocolPaymentResult> {
    return this.post("/v1/payments/mpp", body);
  }

  transfer(body: TransferInput): Promise<OnchainResult> {
    return this.post("/v1/transfers", body);
  }

  sendTransaction(body: TransactionInput): Promise<OnchainResult> {
    return this.post("/v1/transactions", body);
  }

  listPayments(query: ListPaymentsQuery = {}): Promise<{ payments: Payment[] }> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    if (query.kind) params.set("kind", query.kind);
    const qs = params.toString();
    return this.get(`/v1/payments${qs ? `?${qs}` : ""}`);
  }

  // --- Tokens -------------------------------------------------------------

  /** Current access token, refreshed first when it is about to expire. */
  async accessToken(): Promise<string> {
    if (!this.config.accessToken) {
      throw new CliExit(
        EXIT.NOT_LOGGED_IN,
        "Not logged in. Run `m2m-payments login --api <url>` first.",
        "not_logged_in",
      );
    }
    if (this.needsRefresh()) {
      this.refreshing ??= this.refresh().finally(() => {
        this.refreshing = null;
      });
      await this.refreshing;
    }
    return this.config.accessToken;
  }

  needsRefresh(): boolean {
    const { tokenFromEnv, expiresAt, refreshToken, tokenEndpoint, clientId } = this.config;
    if (tokenFromEnv || !expiresAt || !refreshToken || !tokenEndpoint || !clientId) return false;
    const exp = new Date(expiresAt).getTime();
    return Number.isFinite(exp) && exp - this.now() < REFRESH_WINDOW_MS;
  }

  private async refresh(): Promise<void> {
    const { refreshToken, tokenEndpoint, clientId } = this.config;
    if (!refreshToken || !tokenEndpoint || !clientId) return;
    let token;
    try {
      token = await withFetch(this.fetchImpl, () =>
        refreshAccessToken({ tokenEndpoint, clientId, refreshToken }),
      );
    } catch (e) {
      throw new CliExit(
        EXIT.NOT_LOGGED_IN,
        `Session expired and refresh failed (${(e as Error).message}). Run \`m2m-payments login\` again.`,
        "not_logged_in",
      );
    }
    this.config = {
      ...this.config,
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? refreshToken,
      expiresAt: new Date(this.now() + (token.expires_in ?? 3600) * 1000).toISOString(),
    };
    if (this.store) {
      const { tokenFromEnv: _omit, ...persisted } = this.config;
      this.store.write(persisted);
    }
  }
}

async function parseResponse<T>(res: Response): Promise<T> {
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
    const envelope = json as Partial<ApiErrorEnvelope> | undefined;
    if (envelope?.error?.code) {
      throw new ApiError({
        code: envelope.error.code,
        message: envelope.error.message ?? "",
        status: res.status,
        details: envelope.error.details,
      });
    }
    throw new ApiError({
      code: `http_${res.status}`,
      message: text.slice(0, 300) || res.statusText || `HTTP ${res.status}`,
      status: res.status,
    });
  }
  return json as T;
}

/**
 * `@m2m-payments/auth` calls the global `fetch`. Swap it for the duration of
 * one call so tests and custom transports stay in control.
 */
export async function withFetch<T>(fetchImpl: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  if (fetchImpl === original) return fn();
  globalThis.fetch = fetchImpl;
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
  }
}
