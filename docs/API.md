# M2M Payments HTTP API contract

This is the contract between `@m2m-payments/server` (implements it), `@m2m-payments/ui` (browser caller), the `m2m-payments` CLI and `@m2m-payments/mcp` (agent callers), and the chat tools in `apps/web` (in-process caller). All of them must match this file. Change the file first, then the code.

Base path: the server is mounted at a prefix, in the reference app `/api/m2m-payments`. All paths below are relative to that prefix. Version segment `v1` is part of the path.

## Vocabulary

| Name               | What it is                                                                                                                                                                                       | Backed by                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| **Wallet**         | The user's non-custodial smart wallet on Base. One per user. Signers: a **device signer** made in the browser, an **email signer** as recovery, and once approved the agent's **server signer**. | Crossmint wallet, locator `userId:<userId>:evm` |
| **Credits**        | The closed-loop token the wallet holds and spends. Bought by card with no KYC. 1 credit = 1 USD. On staging it is USDC on Base Sepolia; in production USDC on Base. The UI never says USDC.      | `CLOSED_LOOP_TOKEN` in `@m2m-payments/core`     |
| **Agent access**   | The agent's server signer registered on the user's wallet. The user approves it once with an email code. Revocable.                                                                              | Crossmint delegated signer `server:<address>`   |
| **Access request** | The agent asking for agent access. Stored until the user answers.                                                                                                                                | `access_requests` table                         |
| **Top-up request** | The agent asking the user to add credits. Stored until the user pays or declines.                                                                                                                | `top_up_requests` table                         |
| **Top-up**         | A card → credits order. The user pays it in the browser.                                                                                                                                         | Crossmint order `orders/{id}`                   |
| **Payment**        | One thing the agent did with the wallet: an x402 call, an MPP call, a transfer, or a raw transaction. The user's activity list.                                                                  | `payments` table                                |

## Auth

Every route except `GET /v1/config` and the demo endpoints requires `Authorization: Bearer <user jwt>`. The JWT is a Stytch session JWT (browser) or a Stytch Connected Apps access token (CLI, MCP). The server calls `UserAuth.verify`. On failure: `401 { "error": { "code": "unauthorized", "message": "..." } }`.

An OAuth access token from an agent is first exchanged for a Stytch session (first-party client, full access) and the resulting session JWT is what reaches Crossmint. The server stores that session keyed by a hash of the access token. This part is unchanged from the Agent Commerce sample app.

Which Crossmint credential a route uses:

- **Client key + user JWT**: saved cards (list, delete), paying a top-up order. Crossmint resolves the user from the JWT.
- **Server key**: everything on the wallet. The server resolves the wallet by owner locator `userId:<userId>:evm`, never by an address the caller sends. Agent operations also activate the **server signer** from `M2M_PAYMENTS_SIGNER_SECRET`.

## Errors

```json
{ "error": { "code": "string", "message": "string", "details": {} } }
```

Codes: `unauthorized`, `forbidden`, `not_found`, `invalid_request`, `expired`, `wallet_not_found`, `access_required`, `access_pending`, `insufficient_funds`, `payment_failed`, `top_up_failed`, `crossmint_error`, `internal`. `crossmint_error` carries `details.status` and `details.body` from Crossmint.

- `wallet_not_found` (404): the user has no wallet yet. The browser creates it on first sign-in; an agent tells the user to open the app once.
- `access_required` (403): the agent's server signer is not on this wallet. `details.requestId` and `details.approvalUrl` name a fresh pending access request the server created, so the agent can show the link at once.
- `access_pending` (409): an access request exists and is not answered yet. `details.requestId`, `details.approvalUrl`.
- `insufficient_funds` (402): the wallet cannot cover the payment. `details.balance`, `details.required` (both `Amount`). The agent should call `request_top_up`.

## Shared shapes

```ts
/** Decimal string in major units, e.g. "12.50", with a currency. Credits use currency "CRED". */
interface Amount {
  value: string;
  currency: string;
}

interface TokenInfo {
  symbol: string; // "CRED"
  name: string; // "Credits"
  decimals: number; // 6
  chain: string; // "base-sepolia" | "base"
  /** The on-chain asset behind the credits. Shown only in developer surfaces. */
  underlying: { symbol: string; address: string; locator: string };
}
```

## Public config

`GET /v1/config` (no auth). Same as the Agent Commerce sample app, plus the token and the demo endpoints.

```json
{
  "name": "M2M Payments Sample App",
  "apiBaseUrl": "https://wallet.example.com/api/m2m-payments",
  "webBaseUrl": "https://wallet.example.com",
  "crossmintEnvironment": "staging" | "production",
  "token": TokenInfo,
  "demo": { "x402Url": "https://wallet.example.com/api/demo/x402/inference", "mppUrl": "https://wallet.example.com/api/demo/mpp/inference" },
  "auth": {
    "provider": "stytch",
    "projectId": "project-test-...",
    "environment": "test" | "live",
    "authorizationServer": "https://test.stytch.com/v1/public/<projectId>",
    "oauth": {
      "authorizationEndpoint": "https://wallet.example.com/oauth/authorize",
      "tokenEndpoint": "https://test.stytch.com/v1/public/<projectId>/oauth2/token",
      "cliClientId": "connected-app-...",
      "mcpClientId": "connected-app-...",
      "scopes": ["openid", "email", "profile", "offline_access", "full_access"]
    }
  }
}
```

## Whoami

`GET /v1/me` → `{ "userId": "user-test-...", "email": "a@b.c" }`

## Wallet

`GET /v1/wallet` → `WalletView`. `404 wallet_not_found` until the browser has created the wallet.

```ts
interface WalletView {
  address: string; // 0x...
  chain: string; // "base-sepolia" | "base"
  token: TokenInfo;
  balance: Amount; // credits, e.g. { value: "12.50", currency: "CRED" }
  agentAccess: AgentAccess;
  explorerUrl: string; // address page on the chain's explorer
}

type AgentAccessStatus = "none" | "pending" | "active" | "revoked";

interface AgentAccess {
  status: AgentAccessStatus;
  /** The agent's server signer, e.g. "server:0x...". Set once approved. */
  signerLocator?: string;
  /** The open access request, while pending. */
  requestId?: string;
  approvalUrl?: string;
  grantedAt?: string;
  revokedAt?: string;
}
```

`GET /v1/wallet/balance` → `{ "balance": Amount, "token": TokenInfo, "address": string }`. The cheap call agents poll.

`GET /v1/wallet/activity?limit=50` → `{ "activity": ActivityItem[] }`. On-chain transfers in and out of the wallet, from Crossmint, newest first. Used by the app's activity feed next to the `payments` ledger.

```ts
interface ActivityItem {
  id: string;
  direction: "in" | "out";
  amount: Amount; // credits
  counterparty?: string; // the other address
  hash?: string;
  explorerUrl?: string;
  completedAt: string;
}
```

`POST /v1/wallet/access/revoke` (browser) → prepares removing the agent's server signer. → `{ "signerLocator": string, "transactionId"?: string, "signatureId"?: string }`. The browser approves it with the email signer, then calls `POST /v1/wallet/access/revoked` → `WalletView` with `agentAccess.status: "revoked"`. Best effort: a wallet with no server signer returns the view unchanged.

## Access requests

The agent asks to use the wallet. Stored until the user answers.

```ts
type AccessRequestStatus = "pending" | "approved" | "active" | "denied" | "expired" | "failed";

interface AccessRequest {
  id: string; // "acs_" + 21 url-safe chars
  userId: string;
  requester: string; // "Claude Code", "ChatGPT", app name
  reason?: string; // what the agent will do, in its words
  requestExpiresAt: string; // how long the user has to answer, ISO (default 15 min)
  status: AccessRequestStatus;
  signerLocator?: string; // the server signer, once prepared
  failureReason?: string;
  approvalUrl: string; // `${webBaseUrl}/approve/${id}`
  createdAt: string;
  updatedAt: string;
}
```

`POST /v1/access-requests` (agent) body `{ "reason"?: string, "requester"?: string }` → `201 AccessRequest` with `status: "pending"`. When the agent already has active access the server answers `200` with a synthetic `AccessRequest` in `status: "active"` and the existing `signerLocator`, so a tool can call this without checking first.

`GET /v1/access-requests/:id` → `AccessRequest`. Only the owning user. A `pending` request past `requestExpiresAt` is returned as `expired`. While `approved`, the server checks the signer on Crossmint and moves the request to `active` when it is approved there.

`POST /v1/access-requests/:id/approve` (browser) → the server loads the wallet, calls `addSigner({ type: "server", secret }, { prepareOnly: true })`, stores the locator and sets `status: "approved"`. → `{ "request": AccessRequest, "signerLocator": string, "signatureId"?: string, "transactionId"?: string }`. The browser then switches the wallet to the email signer and calls `wallet.approve({ signatureId | transactionId })`, which shows the email code prompt. Allowed while `pending` or `approved`; `409` otherwise.

`POST /v1/access-requests/:id/confirm` (browser) → the server checks `isSignerApproved(signerLocator)` on Crossmint. When approved: `status: "active"`, the `wallet_access` row is written, → `{ "request": AccessRequest, "wallet": WalletView }`. When not yet: `409 access_pending`.

`POST /v1/access-requests/:id/deny` → `AccessRequest` with `status: "denied"`. Allowed while `pending` or `approved`.

## Top-up requests

The agent asks the user to add credits.

```ts
type TopUpRequestStatus = "pending" | "paying" | "completed" | "denied" | "expired" | "failed";

interface TopUpRequest {
  id: string; // "tup_" + 21 url-safe chars
  userId: string;
  requester: string;
  amount: Amount; // credits asked for, e.g. { value: "10.00", currency: "CRED" }
  reason?: string; // what the credits are for
  requestExpiresAt: string; // default 15 min
  status: TopUpRequestStatus;
  orderId?: string; // the Crossmint order, once the user starts paying
  received?: Amount; // credits delivered, once completed
  failureReason?: string;
  approvalUrl: string; // `${webBaseUrl}/top-up/${id}`
  createdAt: string;
  updatedAt: string;
}
```

`POST /v1/top-up-requests` (agent) body `{ "amount": Amount | string, "reason"?: string, "requester"?: string }` → `201 TopUpRequest` with `status: "pending"`. `amount` may be a bare decimal string; the currency is always credits.

`GET /v1/top-up-requests/:id` → `TopUpRequest`. While `paying`, the server reads the order on Crossmint and moves the request to `completed` (with `received`) or `failed`.

`POST /v1/top-up-requests/:id/deny` → `TopUpRequest` with `status: "denied"`. Allowed while `pending` or `paying`.

## Top-ups (the onramp)

The card → credits order. The browser drives it, with or without a request behind it. The flow is the one from the Crossmint onramp sample app: create the order (server key, recipient is the user's wallet), show the quote, pay it with a saved card (client key + user JWT), poll until delivered.

`POST /v1/top-ups` (browser) body `{ "amount": string, "requestId"?: string }` → `201 TopUpView`. The server creates the order with the server key, `recipient.walletAddress` set to the user's wallet, `executionParameters.mode: "exact-out"` so `amount` is the credits received. With `requestId`, the request is linked and moves to `paying`. On staging, the server first runs the identity fixture described in ARCHITECTURE.md so the order is accepted.

```ts
type TopUpPhase = "awaiting-payment" | "processing" | "completed" | "failed";

interface TopUpView {
  orderId: string;
  requestId?: string;
  phase: TopUpPhase;
  quote: {
    receive: Amount; // credits, e.g. { value: "10.00", currency: "CRED" }
    unitPrice?: string; // USD per credit, "1"
    fees: string; // USD
    total: string; // USD the card is charged
    currency: string; // "USD"
  };
  paymentStatus?: string; // Crossmint's payment.status
  deliveryStatus?: string; // Crossmint's lineItems[0].delivery.status
  /** For the embedded checkout, when a wallet pay button is used. */
  clientSecret?: string;
  createdAt: string;
}
```

`POST /v1/top-ups/:orderId/pay` (browser) body `{ "paymentMethodId": string }` → `TopUpView` with `phase: "processing"`. The server pays with the client key and the user's JWT: `POST orders/{id}/payment { type: "crossmint-payment-method", id }`. Never with the server key.

`GET /v1/top-ups/:orderId` → `TopUpView`. Poll about every 3s. `completed` when payment and delivery are done; the linked request, if any, becomes `completed` with `received`. A `payments` row of kind `top-up` is written once, on completion.

## Payment methods (saved cards)

Kept from the Agent Commerce sample app. Cards are saved in the browser with Crossmint's PCI component; the server only lists and deletes.

`GET /v1/payment-methods` → `{ "paymentMethods": PaymentMethod[] }` (`paymentMethodId`, `type`, `displayName`, `default`, `card.brand`, `card.last4`, `card.expiration`, `display.imageUrl`). Never a full number.

`DELETE /v1/payment-methods/:id` → `204`.

## Agent payments

Everything here runs with the server key and the agent's server signer. Without active access: `403 access_required` (see Errors), and the server has already created a pending access request for the agent to show. Every successful call writes one `payments` row.

```ts
type PaymentKind = "x402" | "mpp" | "transfer" | "transaction" | "top-up";
type PaymentStatus = "succeeded" | "failed";

interface Payment {
  id: string; // "pay_" + 21 url-safe chars
  userId: string;
  kind: PaymentKind;
  status: PaymentStatus;
  amount?: Amount; // credits moved, when known
  /** What was paid: the URL host for x402 and MPP, the address for transfers and transactions, the card for top-ups. */
  counterparty?: string;
  description?: string; // the agent's memo, or the endpoint's description
  hash?: string; // on-chain transaction hash, when there is one
  explorerUrl?: string;
  requester?: string; // "Claude Code", "Chat", ...
  failureReason?: string;
  createdAt: string;
}
```

`GET /v1/payments?limit=100&kind=` → `{ "payments": Payment[] }`. Newest first.

### x402

`POST /v1/payments/x402` body:

```json
{ "url": "https://api.example.com/v1/search", "method"?: "GET", "headers"?: { "content-type": "application/json" }, "body"?: "...", "maxAmount"?: "0.10", "memo"?: "..." }
```

`body` is a string; JSON must be serialized by the caller. `maxAmount` caps what the agent may pay for this one call, in credits; default `M2M_PAYMENTS_MAX_PAYMENT` (`"1.00"`). → `201 ProtocolPaymentResult`.

```ts
interface ProtocolPaymentResult {
  payment: Payment; // kind "x402" | "mpp"
  /** Whether the endpoint asked for money at all. False when it answered 2xx without a 402. */
  paid: boolean;
  amount?: Amount; // credits the endpoint charged
  settlement?: { transaction?: string; network?: string; payer?: string; reference?: string };
  response: {
    status: number;
    headers: Record<string, string>; // content-type and the protocol's receipt headers only
    body: string; // text, cut at 16 kB
    truncated: boolean;
  };
}
```

Insufficient balance → `402 insufficient_funds`. The endpoint asking for more than `maxAmount` → `400 invalid_request` with `details.required`. A settled payment whose endpoint then fails → `502 payment_failed`, with the `payments` row marked `failed`.

### MPP

`POST /v1/payments/mpp` body: same as x402. → `201 ProtocolPaymentResult` with `payment.kind: "mpp"`. The server uses `mppx/client` with the `evm` charge method; the challenge names the chain, asset and recipient, and the agent's signer signs the authorization.

### Transfer

`POST /v1/transfers` body `{ "to": "0x...", "amount": "5.00", "memo"?: string }` → `201 { "payment": Payment, "hash": string, "explorerUrl": string, "transactionId": string }`. Credits only: the server calls `wallet.send(to, <underlying symbol>, amount)` with the server signer.

### Transaction

`POST /v1/transactions` body `{ "to": "0x...", "data"?: "0x...", "value"?: "0" , "memo"?: string }` → `201 { "payment": Payment, "hash": string, "explorerUrl": string, "transactionId": string }`. `value` is in wei as a decimal string; default `"0"`. The server calls `EVMWallet.sendTransaction`.

## Demo services (no auth)

Two paid endpoints the reference app hosts so the demo works on staging without a third party. Both return the same made-up inference result and charge `M2M_PAYMENTS_DEMO_PRICE` credits (default `"0.05"`) to `M2M_PAYMENTS_DEMO_PAY_TO`.

- `POST /api/demo/x402/inference` — x402 v2, `exact` scheme on the app's chain, facilitator `M2M_PAYMENTS_X402_FACILITATOR_URL` (default `https://x402.org/facilitator` for Base Sepolia). Body `{ "prompt": string }` → `{ "model": "acme-1", "completion": string, "usage": { "inputTokens": n, "outputTokens": n }, "paid": true }`.
- `POST /api/demo/mpp/inference` — MPP `evm` charge with `mppx/server`. Same body and answer.

These live outside the `/v1` prefix and are not part of the versioned contract.

## Server config object

```ts
createM2mPaymentsHandlers({
  crossmint: { clientApiKey, serverApiKey, environment, signerSecret, baseUrl?, origin?, fetch? },
  userAuth: UserAuth,
  store: Store,                          // RequestStore & Partial<SessionStore> & Partial<PaymentStore>
  webBaseUrl: string,                    // for approvalUrl
  apiBaseUrl: string,                    // for /v1/config
  auth: { provider: "stytch", projectId, environment, cliClientId?, mcpClientId?, projectDomain?, authorizationUrl? },
  demo?: { x402Url?: string; mppUrl?: string },
  x402?: { facilitatorUrl?: string },
  requestTtlMinutes?: number,            // default 15
  defaultRequester?: string,             // default "Agent"
  maxPayment?: string,                   // default "1.00" credits per call
  stagingIdentityFixture?: boolean,      // default true on staging: seed the identity record before an order
  name?: string,
})
```

Returns `{ GET, POST, PUT, DELETE, handler }` where each is `(req: Request) => Promise<Response>` and `handler` dispatches on method. The router matches on the path after the mount prefix; it finds the prefix by locating `/v1/` in the URL path.
