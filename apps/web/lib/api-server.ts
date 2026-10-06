import { createStytchUserAuth, inferStytchEnvironment } from "@m2m-payments/auth/stytch";
import { createM2mPaymentsHandlers, memoryRequestStore } from "@m2m-payments/server";
import { serverEnv } from "./env";

type Handlers = ReturnType<typeof createM2mPaymentsHandlers>;

/**
 * Builds the M2M Payments API handlers from env vars, once per process.
 * With DATABASE_URL set, requests, wallet access and the payments ledger
 * persist in Postgres through Drizzle. Without it, they live in memory: fine
 * for a first `pnpm dev`.
 */
let handlersPromise: Promise<Handlers> | undefined;

export function getM2mPaymentsHandlers(): Promise<Handlers> {
  handlersPromise ??= buildHandlers();
  return handlersPromise;
}

async function buildHandlers(): Promise<Handlers> {
  const projectId = serverEnv.required("STYTCH_PROJECT_ID");
  const stytchEnv = inferStytchEnvironment(projectId);

  const projectDomain = serverEnv.optional("STYTCH_PROJECT_DOMAIN");
  const userAuth = createStytchUserAuth({
    projectId,
    secret: serverEnv.optional("STYTCH_SECRET"),
    environment: stytchEnv,
    projectDomain,
  });

  const store = await buildStore();

  return createM2mPaymentsHandlers({
    crossmint: {
      clientApiKey: serverEnv.required("CROSSMINT_CLIENT_API_KEY"),
      // The server key resolves the wallet, creates top-up orders and runs the agent's payments.
      serverApiKey: serverEnv.required("CROSSMINT_SERVER_API_KEY"),
      environment: serverEnv.crossmintEnvironment(),
      signerSecret: serverEnv.signerSecret(),
    },
    userAuth,
    store,
    webBaseUrl: serverEnv.webBaseUrl(),
    apiBaseUrl: serverEnv.apiBaseUrl(),
    auth: {
      provider: "stytch",
      projectId,
      environment: stytchEnv,
      cliClientId: serverEnv.optional("STYTCH_CLI_CLIENT_ID"),
      mcpClientId: serverEnv.optional("STYTCH_MCP_CLIENT_ID"),
      projectDomain,
      authorizationUrl: `${serverEnv.webBaseUrl()}/oauth/authorize`,
    },
    // The two paid endpoints this app hosts, so the demo pays something real on staging.
    demo: serverEnv.demoUrls(),
    x402: { facilitatorUrl: serverEnv.x402FacilitatorUrl() },
    maxPayment: serverEnv.maxPayment(),
    defaultRequester: "Agent",
    name: "M2M Payments Sample App",
  });
}

async function buildStore() {
  const databaseUrl = serverEnv.optional("DATABASE_URL");
  if (!databaseUrl) return memoryRequestStore();

  // Loaded only when a database is configured, so a dev without Postgres
  // never pays for these imports.
  const [{ drizzleRequestStore }, { drizzle }, { default: postgres }] = await Promise.all([
    import("@m2m-payments/server/drizzle"),
    import("drizzle-orm/postgres-js"),
    import("postgres"),
  ]);
  const sql = postgres(databaseUrl, { prepare: false });
  const db = drizzle(sql);
  return drizzleRequestStore(db);
}
