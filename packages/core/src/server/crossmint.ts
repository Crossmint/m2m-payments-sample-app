import { CrossmintApiError } from "../errors.js";
import { credits } from "../amount.js";
import { CLOSED_LOOP_TOKEN, tokenInfo } from "../token.js";
import type {
  CrossmintEnvironment,
  PaymentMethod,
  PaymentMethodList,
  TopUpPhase,
  TopUpQuote,
} from "../types.js";

/*
 * The Crossmint REST calls the wallets SDK does not cover: saved cards, the
 * onramp order, and the staging identity fixture.
 *
 * Two credentials, as in the Agent Commerce sample app:
 * - client key + the user's JWT: saved cards, paying an order. Crossmint
 *   resolves the user from the JWT.
 * - server key: creating and reading orders, the users API.
 */

const BASE_URLS: Record<CrossmintEnvironment, string> = {
  staging: "https://staging.crossmint.com/api",
  production: "https://www.crossmint.com/api",
};

export interface CrossmintClientOptions {
  clientApiKey?: string;
  serverApiKey?: string;
  environment?: CrossmintEnvironment;
  /** Override the base URL, e.g. for a proxy. */
  baseUrl?: string;
  /**
   * Sent as the `Origin` header on client-key calls. Crossmint locks client
   * keys to whitelisted origins and rejects server-side calls without one.
   */
  origin?: string;
  fetch?: typeof fetch;
}

export interface UserContext {
  jwt: string;
}

/** What `POST orders` gives back, cut to what the top-up needs. */
export interface OnrampOrder {
  orderId: string;
  clientSecret?: string;
  phase?: string;
  paymentStatus?: string;
  deliveryStatus?: string;
  quote: TopUpQuote;
  raw: unknown;
}

type Json = object | unknown[] | string | number | boolean | null;

export class CrossmintClient {
  readonly environment: CrossmintEnvironment;
  private readonly baseUrl: string;
  private readonly clientApiKey: string | undefined;
  private readonly serverApiKey: string | undefined;
  private readonly origin: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: CrossmintClientOptions) {
    this.environment = opts.environment ?? "staging";
    this.baseUrl = (opts.baseUrl ?? BASE_URLS[this.environment]).replace(/\/$/, "");
    this.clientApiKey = opts.clientApiKey;
    this.serverApiKey = opts.serverApiKey;
    this.origin = opts.origin?.replace(/\/$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    if (!this.clientApiKey && !this.serverApiKey) {
      throw new Error("CrossmintClient needs a clientApiKey, a serverApiKey, or both.");
    }
  }

  // ---------------------------------------------------------------------
  // Payment methods (saved cards): client key + user JWT
  // ---------------------------------------------------------------------

  readonly paymentMethods = {
    list: async (
      user: UserContext,
      query: { type?: string; limit?: number; cursor?: string } = {},
    ): Promise<PaymentMethodList> => {
      const params = new URLSearchParams();
      if (query.type) params.set("type", query.type);
      if (query.limit) params.set("limit", String(query.limit));
      if (query.cursor) params.set("cursor", query.cursor);
      const qs = params.size ? `?${params}` : "";
      const raw = await this.request<unknown>("GET", `/unstable/payment-methods${qs}`, {
        auth: this.userAuth(user),
      });
      return normalizePaymentMethodList(raw);
    },

    get: (user: UserContext, paymentMethodId: string): Promise<PaymentMethod> =>
      this.request<PaymentMethod>(
        "GET",
        `/unstable/payment-methods/${encodeURIComponent(paymentMethodId)}`,
        { auth: this.userAuth(user) },
      ),

    delete: (user: UserContext, paymentMethodId: string): Promise<void> =>
      this.request<void>(
        "DELETE",
        `/unstable/payment-methods/${encodeURIComponent(paymentMethodId)}`,
        { auth: this.userAuth(user) },
      ),
  };

  // ---------------------------------------------------------------------
  // Onramp orders: create and read with the server key, pay with the user JWT
  // ---------------------------------------------------------------------

  readonly orders = {
    /**
     * Card → credits. `exact-out`: `amount` is the credits received and the
     * card charge floats with fees. Crossmint allows exact-out only for
     * USD-pegged tokens, which the underlying asset is.
     */
    create: async (input: {
      amount: string;
      walletAddress: string;
      receiptEmail: string;
      locale?: string;
    }): Promise<OnrampOrder> => {
      const token = tokenInfo(this.environment);
      const raw = await this.request<unknown>("POST", "/2022-06-09/orders", {
        auth: this.serverAuth(),
        body: {
          payment: { method: "card", receiptEmail: input.receiptEmail },
          lineItems: {
            tokenLocator: token.underlying.locator,
            executionParameters: { mode: "exact-out", amount: input.amount },
          },
          recipient: { walletAddress: input.walletAddress },
          locale: input.locale ?? "en-US",
        },
      });
      return parseOrder(raw, input.amount);
    },

    get: async (orderId: string, amountHint?: string): Promise<OnrampOrder> => {
      const raw = await this.request<unknown>(
        "GET",
        `/2022-06-09/orders/${encodeURIComponent(orderId)}`,
        { auth: this.serverAuth() },
      );
      return parseOrder(raw, amountHint);
    },

    /** Pay with a saved card. Client key + the user's JWT: the card is bound to the user, and Crossmint checks that pair. */
    pay: (user: UserContext, orderId: string, paymentMethodId: string): Promise<unknown> =>
      this.request<unknown>("POST", `/2022-06-09/orders/${encodeURIComponent(orderId)}/payment`, {
        auth: this.userAuth(user),
        body: { type: "crossmint-payment-method", id: paymentMethodId },
      }),
  };

  // ---------------------------------------------------------------------
  // Users: the staging identity fixture
  // ---------------------------------------------------------------------

  /**
   * Staging wants an identity record on the user before it accepts an
   * order. This seeds one from a fixture, idempotently, the way the onramp
   * sample app does. It never runs on production: there, credits are a
   * closed-loop token and no identity check is asked for.
   */
  readonly users = {
    acceptPrivacyPolicy: (userId: string): Promise<unknown> =>
      this.request<unknown>(
        "PUT",
        `/2025-06-09/users/${encodeURIComponent(`userId:${userId}`)}/legal-documents`,
        {
          auth: this.serverAuth(),
          body: { type: "crossmint-privacy-policy", acceptedAt: new Date().toISOString() },
        },
      ),

    upsertIdentity: (userId: string, email: string): Promise<unknown> =>
      this.request<unknown>("PUT", `/2025-06-09/users/${encodeURIComponent(`userId:${userId}`)}`, {
        auth: this.serverAuth(),
        body: identityFixture(email),
      }),

    triggerVerification: (userId: string): Promise<unknown> =>
      this.request<unknown>(
        "PUT",
        `/2025-06-09/users/${encodeURIComponent(`userId:${userId}`)}/identity-verification`,
        { auth: this.serverAuth() },
      ),

    verificationStatus: async (userId: string): Promise<string> => {
      const raw = await this.request<unknown>(
        "GET",
        `/2025-06-09/users/${encodeURIComponent(`userId:${userId}`)}/identity-verification`,
        { auth: this.serverAuth() },
      );
      const eligibility = (raw as { eligibility?: Array<{ type?: string; status?: string }> })
        ?.eligibility;
      const entry = eligibility?.find((e) => e.type === "onramp-light") ?? eligibility?.[0];
      return entry?.status ?? "unknown";
    },
  };

  /** Run the whole fixture once. Safe to repeat. Resolves to the verification status. */
  async seedStagingIdentity(userId: string, email: string): Promise<string> {
    await this.users.acceptPrivacyPolicy(userId);
    await this.users.upsertIdentity(userId, email);
    await this.users.triggerVerification(userId);
    return this.users.verificationStatus(userId);
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private userAuth(user: UserContext): Record<string, string> {
    if (!this.clientApiKey)
      throw new Error("This call needs a clientApiKey (ck_...) plus a user JWT.");
    if (!user.jwt) throw new Error("This call needs a user JWT.");
    const headers: Record<string, string> = {
      "X-API-KEY": this.clientApiKey,
      Authorization: `Bearer ${user.jwt}`,
    };
    return this.origin ? { ...headers, Origin: this.origin } : headers;
  }

  private serverAuth(): Record<string, string> {
    if (!this.serverApiKey) throw new Error("This call needs a serverApiKey (sk_...).");
    return { "X-API-KEY": this.serverApiKey };
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    opts: { auth: Record<string, string>; body?: Json },
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { Accept: "application/json", ...opts.auth };
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await this.fetchImpl(url, { method, headers, body });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) throw new CrossmintApiError({ status: res.status, url, body: parsed });
    return parsed as T;
  }
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

function get(obj: unknown, key: string): unknown {
  return obj && typeof obj === "object" ? (obj as Record<string, unknown>)[key] : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

/** The order may come flat or wrapped in `{ order, clientSecret }`. */
export function parseOrder(raw: unknown, amountHint?: string): OnrampOrder {
  const order = get(raw, "order") ?? raw;
  const orderId = get(order, "orderId") ?? get(order, "id") ?? get(raw, "orderId");
  if (orderId == null)
    throw new CrossmintApiError({
      status: 502,
      url: "orders",
      body: raw,
      message: "Order response has no orderId",
    });
  const clientSecret = get(raw, "clientSecret") ?? get(order, "clientSecret");
  const lineItems = get(order, "lineItems");
  const li = Array.isArray(lineItems) ? lineItems[0] : lineItems;
  return {
    orderId: String(orderId),
    clientSecret: typeof clientSecret === "string" ? clientSecret : undefined,
    phase: get(order, "phase") as string | undefined,
    paymentStatus: get(get(order, "payment"), "status") as string | undefined,
    deliveryStatus: get(get(li, "delivery"), "status") as string | undefined,
    quote: parseQuote(order, amountHint),
    raw: order,
  };
}

/** The quote as the preview shows it. All values from the order response. */
export function parseQuote(order: unknown, amountHint?: string): TopUpQuote {
  const orderQuote = get(order, "quote");
  const lineItems = get(order, "lineItems");
  const li = Array.isArray(lineItems) ? lineItems[0] : lineItems;
  const liQuote = get(li, "quote");
  const charges = get(liQuote, "charges");
  const hint = Number.parseFloat(amountHint ?? "") || 0;

  const total =
    num(get(get(orderQuote, "totalPrice"), "amount")) ??
    num(get(get(liQuote, "totalPrice"), "amount")) ??
    hint;
  const crossmintFee = num(get(get(charges, "crossmintFees"), "amount")) ?? 0;
  const otherFee = num(get(get(charges, "fees"), "amount")) ?? 0;
  const fees = crossmintFee + otherFee;
  const unit = num(get(get(charges, "unit"), "amount"));
  const range = get(liQuote, "quantityRange");
  const receive =
    num(get(range, "lowerBound")) ??
    num(get(range, "upperBound")) ??
    (hint || (unit && unit > 0 ? (total - fees) / unit : Math.max(0, total - fees)));
  const currencyRaw =
    get(get(orderQuote, "totalPrice"), "currency") ??
    get(get(liQuote, "totalPrice"), "currency") ??
    CLOSED_LOOP_TOKEN.fiat;

  return {
    receive: credits(receive),
    unitPrice: unit != null ? String(unit) : "1",
    fees: fees.toFixed(2),
    total: total.toFixed(2),
    currency: String(currencyRaw).toUpperCase(),
  };
}

const DONE = /completed|success|delivered/i;
const FAILED = /failed|rejected|cancel|expired/i;

/** Crossmint's two statuses folded into the four phases the UI draws. */
export function topUpPhase(
  order: Pick<OnrampOrder, "phase" | "paymentStatus" | "deliveryStatus">,
): TopUpPhase {
  const p = order.paymentStatus ?? "";
  const d = order.deliveryStatus ?? "";
  if (FAILED.test(p) || FAILED.test(d)) return "failed";
  if (DONE.test(d) || order.phase === "completed") return "completed";
  if (DONE.test(p) || order.phase === "delivery") return "processing";
  if (/pending|in-progress|processing/i.test(p)) return "processing";
  return "awaiting-payment";
}

function normalizePaymentMethodList(raw: unknown): PaymentMethodList {
  if (Array.isArray(raw)) return { paymentMethods: raw as PaymentMethod[] };
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["paymentMethods", "data", "items"]) {
      if (Array.isArray(obj[key])) {
        return {
          paymentMethods: obj[key] as PaymentMethod[],
          nextCursor: typeof obj.nextCursor === "string" ? obj.nextCursor : undefined,
        };
      }
    }
  }
  return { paymentMethods: [] };
}

/**
 * The staging identity fixture, from the onramp sample app. Chicago on
 * purpose: a New York address verifies for onramp but blocks other flows.
 * `email` is the real login email so receipts match.
 */
export function identityFixture(email: string) {
  const now = new Date().toISOString();
  return {
    userDetails: {
      firstName: "John",
      lastName: "Doe",
      dateOfBirth: "1990-01-15",
      countryOfResidence: "US",
    },
    kycData: {
      nationality: "US",
      email,
      phoneNumber: "+12125551234",
      addressOfResidence: {
        line1: "123 Main Street",
        line2: "Apt 4B",
        city: "Chicago",
        stateOrRegion: "IL",
        postalCode: "60601",
      },
      identityDocument: { type: "ssn", number: "123-45-6789", issuingCountryCode: "US" },
      ipAddresses: [],
    },
    verificationHistory: { idVerificationTimestamp: now, livenessVerificationTimestamp: now },
    dueDiligence: {
      employmentStatus: "full-time",
      sourceOfFunds: "salary-disbursement",
      industry: "financial-institution",
      estimatedYearlyIncome: "income-50k-100k",
      expectedYearlyTxVolume: "volume-0-25k",
    },
  };
}
