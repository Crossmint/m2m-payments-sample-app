import { bearerToken, type AuthenticatedUser } from "@m2m-payments/auth";
import {
  CrossmintClient,
  createWalletsClient,
  type WalletsClient,
} from "@m2m-payments/core/server";
import { z } from "zod";
import { invalidRequest, unauthorized } from "./errors.js";
import {
  memoryPaymentStore,
  memorySessionStore,
  memoryTopUpOrderStore,
  memoryWalletAccessStore,
} from "./store/memory.js";
import type {
  AgentSession,
  ConfigStore,
  M2mPaymentsServerConfig,
  PaymentStore,
  SessionStore,
  Store,
  TopUpOrderStore,
  WalletAccessStore,
} from "./types.js";

export interface Ctx {
  config: M2mPaymentsServerConfig;
  /** The REST calls: saved cards, orders, the staging identity fixture. */
  crossmint: CrossmintClient;
  /** The wallets SDK: the wallet, its signers, the agent's payments. */
  wallets: WalletsClient;
  store: Store;
  requestTtlMinutes: number;
  defaultRequester: string;
  /** Most credits one x402 or MPP call may pay. */
  maxPayment: string;
  stagingIdentityFixture: boolean;
  now(): Date;
}

export function createContext(config: M2mPaymentsServerConfig): Ctx {
  const crossmint = new CrossmintClient({
    clientApiKey: config.crossmint.clientApiKey,
    serverApiKey: config.crossmint.serverApiKey,
    environment: config.crossmint.environment,
    baseUrl: config.crossmint.baseUrl,
    origin: config.crossmint.origin ?? config.webBaseUrl,
    fetch: config.crossmint.fetch,
  });
  const wallets =
    config.crossmint.walletsClient ??
    createWalletsClient({
      serverApiKey: config.crossmint.serverApiKey,
      environment: config.crossmint.environment,
      signerSecret: config.crossmint.signerSecret,
    });

  return {
    config,
    crossmint,
    wallets,
    store: composeStore(config.store),
    requestTtlMinutes: config.requestTtlMinutes ?? 15,
    defaultRequester: config.defaultRequester ?? "Agent",
    maxPayment: config.maxPayment ?? "1.00",
    stagingIdentityFixture:
      config.stagingIdentityFixture ?? config.crossmint.environment === "staging",
    now: () => new Date(),
  };
}

/**
 * The store the handlers see. The optional parts fall back to memory with a
 * warning. Methods are delegated, not spread, so a class-based store keeps
 * its `this`.
 */
function composeStore(s: ConfigStore): Store {
  let walletAccess: WalletAccessStore;
  if (typeof s.getWalletAccess === "function" && typeof s.putWalletAccess === "function") {
    walletAccess = s as WalletAccessStore;
  } else {
    warnFallback("getWalletAccess/putWalletAccess", "Agent access is forgotten on restart.");
    walletAccess = memoryWalletAccessStore();
  }

  let topUpOrders: TopUpOrderStore;
  if (typeof s.linkTopUpOrder === "function" && typeof s.getTopUpOrder === "function") {
    topUpOrders = s as TopUpOrderStore;
  } else {
    warnFallback("linkTopUpOrder/getTopUpOrder", "Top-up order links are lost on restart.");
    topUpOrders = memoryTopUpOrderStore();
  }

  let payments: PaymentStore;
  if (typeof s.recordPayment === "function" && typeof s.listPayments === "function") {
    payments = s as PaymentStore;
  } else {
    warnFallback("recordPayment/listPayments", "The payments ledger is lost on restart.");
    payments = memoryPaymentStore();
  }

  let sessions: SessionStore;
  if (typeof s.getSession === "function" && typeof s.putSession === "function") {
    sessions = s as SessionStore;
  } else {
    warnFallback("getSession/putSession", "Agents must log in again after a restart.");
    sessions = memorySessionStore();
  }

  const store: Store = {
    createAccessRequest: (r) => s.createAccessRequest(r),
    getAccessRequest: (id) => s.getAccessRequest(id),
    updateAccessRequest: (id, p) => s.updateAccessRequest(id, p),
    findOpenAccessRequest: (u) => s.findOpenAccessRequest(u),
    createTopUpRequest: (r) => s.createTopUpRequest(r),
    getTopUpRequest: (id) => s.getTopUpRequest(id),
    updateTopUpRequest: (id, p) => s.updateTopUpRequest(id, p),
    getWalletAccess: (u) => walletAccess.getWalletAccess(u),
    putWalletAccess: (r) => walletAccess.putWalletAccess(r),
    linkTopUpOrder: (r) => topUpOrders.linkTopUpOrder(r),
    getTopUpOrder: (id) => topUpOrders.getTopUpOrder(id),
    recordPayment: (p) => payments.recordPayment(p),
    listPayments: (u, o) => payments.listPayments(u, o),
    getSession: (h) => sessions.getSession(h),
    putSession: (x) => sessions.putSession(x),
  };
  if (typeof s.listAccessRequests === "function") {
    store.listAccessRequests = (u) => s.listAccessRequests!(u);
  }
  return store;
}

function warnFallback(methods: string, consequence: string): void {
  console.warn(`[m2m-payments] store has no ${methods}. Falling back to memory. ${consequence}`);
}

/** Verify the bearer token. Throws 401 when it is missing or invalid. */
export async function requireUser(req: Request, ctx: Ctx): Promise<AuthenticatedUser> {
  const token = bearerToken(req);
  if (!token) throw unauthorized("Missing Authorization: Bearer <jwt>");
  const user = await ctx.config.userAuth.verify(token);
  if (!user) throw unauthorized("Invalid or expired token");
  if (user.kind !== "access") return { ...user, jwt: user.jwt || token };
  // An agent's OAuth access token. Crossmint verifies session JWTs, so swap it for one.
  const jwt = await sessionJwtForAccessToken(token, user.userId, ctx);
  return { ...user, jwt, kind: "session" };
}

/** Refresh the session JWT this many ms before it expires. */
const JWT_REFRESH_MARGIN_MS = 30_000;

async function sessionJwtForAccessToken(
  accessToken: string,
  userId: string,
  ctx: Ctx,
): Promise<string> {
  const auth = ctx.config.userAuth;
  const hash = await sha256Base64Url(accessToken);
  const now = ctx.now();
  const existing = await ctx.store.getSession(hash);

  if (existing) {
    if (new Date(existing.jwtExpiresAt).getTime() - now.getTime() > JWT_REFRESH_MARGIN_MS) {
      return existing.jwt;
    }
    if (!auth.refresh)
      throw unauthorized("Agent session expired and the auth adapter cannot refresh it.");
    const fresh = await auth.refresh(existing.sessionToken);
    await ctx.store.putSession({
      ...existing,
      jwt: fresh.jwt,
      jwtExpiresAt: fresh.expiresAt.toISOString(),
      updatedAt: now.toISOString(),
    });
    return fresh.jwt;
  }

  if (!auth.exchangeAccessToken) {
    throw unauthorized(
      "This server cannot exchange agent access tokens. Configure the auth adapter with a secret.",
    );
  }
  let exchanged;
  try {
    exchanged = await auth.exchangeAccessToken(accessToken);
  } catch (e) {
    console.warn("[m2m-payments] access token exchange failed", e instanceof Error ? e.message : e);
    throw unauthorized(
      "Could not exchange the agent access token for a session. The token may be older than five minutes, " +
        "or the Connected App is not first-party with full access. Log in again.",
    );
  }
  const session: AgentSession = {
    accessTokenHash: hash,
    userId: exchanged.userId || userId,
    sessionToken: exchanged.sessionToken,
    jwt: exchanged.jwt,
    jwtExpiresAt: exchanged.expiresAt.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await ctx.store.putSession(session);
  return session.jwt;
}

async function sha256Base64Url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  let s = "";
  for (const b of new Uint8Array(digest)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parse a JSON body with a zod schema. Throws 400 on failure. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<z.output<T>> {
  let raw: unknown;
  const text = await req.text();
  if (!text) {
    raw = {};
  } else {
    try {
      raw = JSON.parse(text);
    } catch {
      throw invalidRequest("Body is not valid JSON");
    }
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw invalidRequest("Invalid request body", { issues: result.error.issues });
  }
  return result.data;
}

const emailCache = new Map<string, string>();

/**
 * Email for the order receipt and the staging identity record: the body,
 * then the token, then a lookup through the auth adapter. Throws 400 when
 * none is available.
 */
export async function resolveEmail(
  user: AuthenticatedUser,
  ctx: Ctx,
  fromBody?: string,
): Promise<string> {
  const email = fromBody ?? user.email ?? (await lookupEmail(user.userId, ctx));
  if (!email) {
    throw invalidRequest(
      "No email is known for this account. Pass `email`, or configure the auth adapter with a secret so it can look the email up.",
    );
  }
  return email;
}

export async function lookupEmail(userId: string, ctx: Ctx): Promise<string | undefined> {
  const cached = emailCache.get(userId);
  if (cached) return cached;
  const found = await ctx.config.userAuth.lookupEmail?.(userId).catch(() => undefined);
  if (found) emailCache.set(userId, found);
  return found;
}
