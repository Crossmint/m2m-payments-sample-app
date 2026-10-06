# @m2m-payments/server

The M2M Payments HTTP API as Web-standard request handlers. Mount it in Next.js or any runtime that speaks `Request` and `Response`.

The contract lives in [`docs/API.md`](../../docs/API.md). This package implements it. The UI, CLI, MCP server and the chat tools call it.

## Install

```sh
pnpm add @m2m-payments/server @m2m-payments/core @m2m-payments/auth
# optional, for Postgres storage
pnpm add drizzle-orm
```

## Mount in Next.js

Create `app/api/m2m-payments/[...path]/route.ts`:

```ts
import { createM2mPaymentsHandlers } from "@m2m-payments/server";
import { drizzleStore } from "@m2m-payments/server/drizzle";
import { createStytchUserAuth } from "@m2m-payments/auth/stytch";
import { db } from "@/lib/db";

export const { GET, POST, PUT, DELETE } = createM2mPaymentsHandlers({
  crossmint: {
    clientApiKey: process.env.CROSSMINT_CLIENT_API_KEY!,
    serverApiKey: process.env.CROSSMINT_SERVER_API_KEY!,
    environment: "staging",
    signerSecret: process.env.M2M_PAYMENTS_SIGNER_SECRET!,
  },
  userAuth: createStytchUserAuth({ projectId: process.env.STYTCH_PROJECT_ID! }),
  store: drizzleStore(db),
  webBaseUrl: "https://wallet.example.com",
  apiBaseUrl: "https://wallet.example.com/api/m2m-payments",
  auth: {
    provider: "stytch",
    projectId: process.env.STYTCH_PROJECT_ID!,
    environment: "test",
    cliClientId: process.env.STYTCH_CLI_CLIENT_ID,
    mcpClientId: process.env.STYTCH_MCP_CLIENT_ID,
  },
  demo: { x402Url: "https://wallet.example.com/api/demo/x402/inference" },
  maxPayment: process.env.M2M_PAYMENTS_MAX_PAYMENT,
});
```

The router finds the mount point by locating `/v1/` in the URL path. Any prefix works.

For a first run without a database, use `memoryStore()`. It forgets everything on restart.

Other options: `requestTtlMinutes` (default 15), `defaultRequester` (default "Agent"), `stagingIdentityFixture` (default true on staging: seeds the identity record Crossmint staging wants before an order), `x402.facilitatorUrl`, `name`. Tests can pass `crossmint.walletsClient` and `crossmint.fetch` to replace the Crossmint wallets SDK and REST calls.

## Other runtimes

`createM2mPaymentsHandlers` also returns `handler`. It dispatches on `req.method`.

```ts
const { handler } = createM2mPaymentsHandlers({ ... });
Bun.serve({ fetch: handler });
```

## Routes

| Route                                                                            | Credential                                 | What it does                                                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /v1/config`, `GET /v1/me`                                                   | none, user JWT                             | Public config with the token and demo endpoints; whoami.                                                                                                                       |
| `GET /v1/wallet`, `/wallet/balance`, `/wallet/activity`                          | server key                                 | The wallet by `userId:<id>:evm`, its credits balance, on-chain transfers.                                                                                                      |
| `POST /v1/wallet/access/revoke`, `/revoked`                                      | server key                                 | Prepare removing the agent's signer; record the revocation.                                                                                                                    |
| `POST /v1/access-requests`, `GET /:id`, `POST /:id/approve`, `/confirm`, `/deny` | server key                                 | The agent's ask to use the wallet. Approve prepares the server signer; the browser approves it with the email code; confirm checks it on Crossmint and writes `wallet_access`. |
| `POST /v1/top-up-requests`, `GET /:id`, `POST /:id/deny`                         | server key                                 | The agent's ask for credits.                                                                                                                                                   |
| `POST /v1/top-ups`, `POST /:orderId/pay`, `GET /:orderId`                        | server key; pay uses client key + user JWT | The card to credits order. The poll completes the linked request and writes one `top-up` payment.                                                                              |
| `GET /v1/payment-methods`, `DELETE /:id`                                         | client key + user JWT                      | Saved cards.                                                                                                                                                                   |
| `GET /v1/payments`                                                               |                                            | The ledger, newest first.                                                                                                                                                      |
| `POST /v1/payments/x402`, `/payments/mpp`, `/transfers`, `/transactions`         | server key + agent signer                  | Agent payments. Without active access: `403 access_required` with a pending request's `approvalUrl`. Empty wallet: `402 insufficient_funds`.                                   |

## Storage

Stytch owns users and sessions. Crossmint owns the wallet, its signers, the orders and the chain history. The server stores what neither has:

| Table             | Rows                                                                  |
| ----------------- | --------------------------------------------------------------------- |
| `access_requests` | The agent's ask to use the wallet, until the user answers.            |
| `wallet_access`   | One row per user: the agent's signer locator, granted at, revoked at. |
| `top_up_requests` | The agent's ask for credits, until the user pays or declines.         |
| `top_up_orders`   | Order id to user and request, so a poll can find its request.         |
| `payments`        | The ledger. Never a key.                                              |
| `agent_sessions`  | Exchanged agent sessions, keyed by token hash.                        |

`Store` is the interface, composed of `AccessRequestStore`, `WalletAccessStore`, `TopUpRequestStore`, `TopUpOrderStore`, `PaymentStore` and `SessionStore`. The two request stores are required; the rest fall back to memory with a warning.

`@m2m-payments/server/drizzle` ships the tables and a store for any Drizzle Postgres driver:

```ts
import { m2mPaymentsSchema, drizzleStore } from "@m2m-payments/server/drizzle";
```

Generate the migration with drizzle-kit from `m2mPaymentsSchema`, or run this SQL:

```sql
create table access_requests (
  id text primary key,
  user_id text not null,
  requester text not null,
  reason text,
  request_expires_at timestamptz not null,
  status text not null,
  signer_locator text,
  failure_reason text,
  approval_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table wallet_access (
  user_id text primary key,
  signer_locator text not null,
  granted_at timestamptz not null,
  revoked_at timestamptz
);

create table top_up_requests (
  id text primary key,
  user_id text not null,
  requester text not null,
  amount jsonb not null,
  reason text,
  request_expires_at timestamptz not null,
  status text not null,
  order_id text,
  received jsonb,
  failure_reason text,
  approval_url text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table top_up_orders (
  order_id text primary key,
  user_id text not null,
  request_id text,
  amount jsonb not null,
  payment_method_id text,
  completed_payment_id text,
  created_at timestamptz not null default now()
);

create table payments (
  id text primary key,
  user_id text not null,
  kind text not null,
  status text not null,
  amount jsonb,
  counterparty text,
  description text,
  hash text,
  explorer_url text,
  requester text,
  failure_reason text,
  created_at timestamptz not null default now()
);
create index payments_user_id_created_at_idx on payments (user_id, created_at);

create table agent_sessions (
  access_token_hash text primary key,
  user_id text not null,
  session_token text not null,
  jwt text not null,
  jwt_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

## What the server does for you

- Verifies the bearer token with your `UserAuth`. Exchanges an agent's OAuth access token for a Stytch session and forwards the session JWT to Crossmint.
- Resolves the wallet by owner locator, never by an address the caller sends.
- Gates every agent payment on the signer the user approved, checked live on Crossmint, and creates the access request the agent needs to show when there is none.
- Refuses an x402 or MPP price above `maxAmount` before anything is signed. Refuses an empty wallet before touching the endpoint.
- Writes one `payments` row per payment, and one per completed top-up.

## Errors

Every error is `{ "error": { "code", "message", "details"? } }`. Codes are in `docs/API.md`. Crossmint failures become `crossmint_error` with `details.status` and `details.body`. A Crossmint 401 or 403 becomes `401 unauthorized`.
