import type { UserAuth } from "@m2m-payments/auth";
import { credits, UNDERLYING, WalletNotFoundError, type ActivityItem } from "@m2m-payments/core";
import type { AgentWallet, UserWallet, WalletsClient } from "@m2m-payments/core/server";
import {
  createM2mPaymentsHandlers,
  memoryStore,
  type M2mPaymentsServerConfig,
} from "../src/index.js";

export const BASE = "https://wallet.test/api/m2m-payments";

export const WALLET_ADDRESS = "0xabcabcabcabcabcabcabcabcabcabcabcabcabca";
export const SIGNER_LOCATOR = "server:0x1111111111111111111111111111111111111111";

export const fakeUserAuth: UserAuth = {
  async verify(jwt) {
    if (jwt !== "good") return null;
    return { userId: "user-test-1", email: "a@b.c", jwt };
  },
};

// ---------------------------------------------------------------------------
// Fake wallets SDK
// ---------------------------------------------------------------------------

export interface FakeWalletState {
  /** Users who have a wallet. */
  wallets: Set<string>;
  /** Credits balance, decimal string. */
  balance: string;
  /** Signer locators Crossmint reports as approved. */
  approved: Set<string>;
  /** The locator `prepareAgentSigner` hands back. */
  signerLocator: string;
  activity: ActivityItem[];
  sends: Array<{ to: string; amount: string }>;
  transactions: Array<{ to: string; data?: string; value?: bigint }>;
  calls: string[];
}

/**
 * A fake for `createWalletsClient`'s return, backed by in-memory state.
 * The wallet object itself only carries an address; handlers never call the
 * SDK on it directly.
 */
export function fakeWallets(over: Partial<FakeWalletState> = {}) {
  const state: FakeWalletState = {
    wallets: new Set(["user-test-1"]),
    balance: "0.00",
    approved: new Set(),
    signerLocator: SIGNER_LOCATOR,
    activity: [],
    sends: [],
    transactions: [],
    calls: [],
    ...over,
  };
  const underlying = UNDERLYING.staging;
  const wallet = { address: WALLET_ADDRESS } as unknown as UserWallet;
  const explorer = (kind: "address" | "tx", id: string) =>
    `https://sepolia.basescan.org/${kind}/${id}`;

  const evm = {
    address: WALLET_ADDRESS,
    async sendTransaction(input: { to: string; data?: string; value?: bigint }) {
      state.calls.push("sendTransaction");
      state.transactions.push(input);
      return {
        hash: "0xtxhash",
        explorerLink: explorer("tx", "0xtxhash"),
        transactionId: "tx_raw_1",
      };
    },
    async signTypedData() {
      return { signature: "0xsig", signatureId: "sig_typed" };
    },
    async signMessage() {
      return { signature: "0xsig", signatureId: "sig_msg" };
    },
  };
  const agent: AgentWallet = {
    evm: evm as unknown as AgentWallet["evm"],
    address: WALLET_ADDRESS,
    chain: "base-sepolia",
    chainId: underlying.chainId,
  };

  const client: WalletsClient = {
    chain: "base-sepolia",
    chainId: underlying.chainId,
    underlying,
    async getUserWallet(userId) {
      state.calls.push("getUserWallet");
      if (!state.wallets.has(userId)) throw new WalletNotFoundError(userId);
      return wallet;
    },
    async balance() {
      state.calls.push("balance");
      return credits(state.balance);
    },
    async prepareAgentSigner() {
      state.calls.push("prepareAgentSigner");
      return { locator: state.signerLocator, signatureId: "sig_1" };
    },
    async agentSignerApproved(_wallet, locator) {
      state.calls.push("agentSignerApproved");
      return state.approved.has(locator);
    },
    async findAgentSigner() {
      return state.approved.has(state.signerLocator) ? state.signerLocator : undefined;
    },
    async prepareRemoveAgentSigner() {
      state.calls.push("prepareRemoveAgentSigner");
      return { transactionId: "tx_remove_1" };
    },
    async asAgent() {
      state.calls.push("asAgent");
      return agent;
    },
    async send(_agent, to, amount) {
      state.calls.push("send");
      state.sends.push({ to, amount });
      return {
        hash: "0xsendhash",
        explorerLink: explorer("tx", "0xsendhash"),
        transactionId: "tx_send_1",
      };
    },
    async activity() {
      return state.activity;
    },
    explorer,
  };
  return { client, state };
}

// ---------------------------------------------------------------------------
// Fake Crossmint REST
// ---------------------------------------------------------------------------

export interface FakeCall {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Reply =
  { status?: number; body?: unknown } | ((call: FakeCall) => { status?: number; body?: unknown });

export interface FakeRoute {
  method: string;
  /** Matched against the URL path with `includes`, or a regex test. */
  path: string | RegExp;
  reply: Reply;
  /** Use this route at most once, then fall through to the next match. */
  once?: boolean;
}

/** A fake Crossmint. Routes match in order. Records every call. */
export function fakeCrossmint(routes: FakeRoute[]) {
  const calls: FakeCall[] = [];
  const used = new Set<FakeRoute>();
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    const headers = Object.fromEntries(
      Object.entries((init?.headers as Record<string, string>) ?? {}),
    );
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call: FakeCall = { method, url, path, headers, body };
    calls.push(call);
    for (const route of routes) {
      if (route.method !== method) continue;
      const hit =
        typeof route.path === "string" ? path.includes(route.path) : route.path.test(path);
      if (!hit) continue;
      if (route.once && used.has(route)) continue;
      used.add(route);
      const r = typeof route.reply === "function" ? route.reply(call) : route.reply;
      const status = r.status ?? 200;
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: `no fake for ${method} ${path}` }), {
      status: 599,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function makeServer(
  routes: FakeRoute[] = [],
  overrides: Partial<M2mPaymentsServerConfig> = {},
  walletState: Partial<FakeWalletState> = {},
) {
  const crossmint = fakeCrossmint(routes);
  const wallets = fakeWallets(walletState);
  const store = memoryStore();
  const handlers = createM2mPaymentsHandlers({
    crossmint: {
      clientApiKey: "ck_test",
      serverApiKey: "sk_test",
      environment: "staging",
      signerSecret: "xmsk1_" + "0".repeat(64),
      fetch: crossmint.fetch,
      walletsClient: wallets.client,
    },
    userAuth: fakeUserAuth,
    store,
    webBaseUrl: "https://wallet.test",
    apiBaseUrl: BASE,
    auth: {
      provider: "stytch",
      projectId: "project-test-123",
      environment: "test",
      cliClientId: "connected-app-cli",
    },
    demo: { x402Url: "https://wallet.test/api/demo/x402/inference" },
    // The identity fixture is exercised on its own; most tests skip it.
    stagingIdentityFixture: false,
    ...overrides,
  });
  return { handlers, store, calls: crossmint.calls, wallets: wallets.state };
}

export function call(
  handlers: ReturnType<typeof createM2mPaymentsHandlers>,
  method: string,
  path: string,
  opts: { body?: unknown; auth?: string | null } = {},
) {
  const headers: Record<string, string> = {};
  const auth = opts.auth === undefined ? "good" : opts.auth;
  if (auth) headers.authorization = `Bearer ${auth}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const req = new Request(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return handlers.handler(req);
}

/** A Crossmint onramp order, as `GET orders/:id` returns it. */
export function onrampOrder(
  over: {
    orderId?: string;
    amount?: string;
    paymentStatus?: string;
    deliveryStatus?: string;
    phase?: string;
  } = {},
) {
  const amount = over.amount ?? "10.00";
  return {
    clientSecret: "cs_1",
    order: {
      orderId: over.orderId ?? "order_1",
      phase: over.phase ?? "payment",
      payment: { status: over.paymentStatus ?? "awaiting-payment", method: "card" },
      lineItems: [
        {
          quote: {
            status: "valid",
            quantityRange: { lowerBound: amount, upperBound: amount },
            charges: {
              unit: { amount: "1", currency: "usd" },
              crossmintFees: { amount: "0.50", currency: "usd" },
            },
            totalPrice: { amount: String(Number(amount) + 0.5), currency: "usd" },
          },
          delivery: { status: over.deliveryStatus ?? "awaiting-payment" },
        },
      ],
      quote: { totalPrice: { amount: String(Number(amount) + 0.5), currency: "usd" } },
    },
  };
}
