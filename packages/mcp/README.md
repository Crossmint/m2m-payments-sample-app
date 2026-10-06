# @m2m-payments/mcp

MCP server for the M2M Payments wallet. It exposes the M2M Payments HTTP API as tools for Claude, ChatGPT, and any MCP host, so an agent can pay x402 and MPP endpoints, transfer credits and send transactions from the user's non-custodial wallet.

The server is stateless. It holds no Crossmint keys, no signer and no sessions. Each request carries the user's bearer token. The server forwards that token to the M2M Payments API, which verifies it and signs with the agent's server signer the user approved once.

Auth is OAuth 2.1. Stytch Connected Apps is the identity provider. This package publishes the protected resource metadata and, because Stytch's own discovery is incomplete, the authorization server metadata that points at the app's own proxy routes.

## Tools

Names, summaries and parameter docs come from `TOOL_DOCS` in `@m2m-payments/core`, shared with the chat agent in `apps/web`. This package appends one sentence per tool about how a link reaches the user.

| Tool                    | What it does                                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_wallet`            | Address, chain, credits balance, and this agent's access (`none`, `pending`, `active`, `revoked`). Start here.                                                          |
| `get_balance`           | The credits balance. Cheap; poll it after a top-up.                                                                                                                     |
| `request_wallet_access` | Ask the user to let this agent pay from the wallet. Returns `requestId` and `approvalUrl`.                                                                              |
| `get_access_request`    | Poll a request until `active`, `denied`, `expired` or `failed`.                                                                                                         |
| `request_top_up`        | Ask the user to add credits by card, with no identity check. Returns `requestId` and `approvalUrl`.                                                                     |
| `get_top_up_request`    | Poll a top-up until `completed`, `denied`, `expired` or `failed`. Carries the credits received.                                                                         |
| `pay_x402`              | Call an endpoint that charges over x402. The handshake and the signature run on the server; the result has the endpoint's response, the amount paid and the settlement. |
| `pay_mpp`               | Same, for the Machine Payments Protocol.                                                                                                                                |
| `transfer`              | Send credits to an address. Only when the user asked.                                                                                                                   |
| `send_transaction`      | Send a raw transaction. Only when the user asked.                                                                                                                       |
| `list_payments`         | The wallet's activity, newest first.                                                                                                                                    |

Every tool returns `structuredContent` and a text summary. API errors come back as `isError` results, and two of them carry instructions: `access_required` shows the approval URL and says to poll `get_access_request` with the `requestId`; `insufficient_funds` says to call `request_top_up` with about `details.required`.

## Mount in Next.js

The reference app mounts the M2M Payments API at `/api/m2m-payments` and the MCP endpoint at `/api/mcp`.

`app/api/mcp/route.ts`:

```ts
import { createM2mPaymentsMcpHandler } from "@m2m-payments/mcp";

const base = process.env.M2M_PAYMENTS_WEB_BASE_URL!; // https://wallet.example.com

const handler = createM2mPaymentsMcpHandler({
  apiBaseUrl: `${base}/api/m2m-payments`,
  resourceUrl: `${base}/api/mcp`,
  authorizationServers: [base],
  scopes: ["openid", "email", "profile", "offline_access"],
  requester: "MCP agent",
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
```

`app/.well-known/oauth-protected-resource/route.ts`:

```ts
import { createProtectedResourceMetadataHandler } from "@m2m-payments/mcp";

const handler = createProtectedResourceMetadataHandler({
  resourceUrl: `${process.env.M2M_PAYMENTS_WEB_BASE_URL}/api/mcp`,
  authorizationServers: [process.env.M2M_PAYMENTS_WEB_BASE_URL!],
  scopes: ["openid", "email", "profile", "offline_access"],
});

export const GET = handler;
export const OPTIONS = handler;
```

`createAuthorizationServerMetadataHandler` serves `/.well-known/oauth-authorization-server` with this origin as the issuer, the consent page at `/oauth/authorize`, and the token and registration endpoints the app proxies to Stytch. See `apps/web/lib/mcp.ts` for the wiring.

Some clients also try the path form from RFC 9728: `/.well-known/oauth-protected-resource/api/mcp`. Add a route with the same handler if you want to serve both.

### What happens on a request

1. No `Authorization` header: the handler returns `401` with `WWW-Authenticate: Bearer ..., resource_metadata="https://wallet.example.com/.well-known/oauth-protected-resource"`.
2. The client reads the metadata and runs OAuth 2.1 with PKCE against the app, which proxies to Stytch.
3. The client retries with `Authorization: Bearer <token>`. The handler builds a fresh MCP server for that token and answers with JSON. No session id. No SSE.
4. Each tool calls the M2M Payments API with the same token. The server signs payments with the agent's server signer.

### Env

The web app needs these to mount the endpoint:

- `M2M_PAYMENTS_WEB_BASE_URL`: public origin, e.g. `https://wallet.example.com`.
- `STYTCH_PROJECT_ID`: to derive the Stytch endpoints the proxy routes forward to.
- `STYTCH_MCP_CLIENT_ID`: the Connected Apps client for MCP. Stytch needs the host's redirect URL registered on that client, or dynamic client registration enabled.

## Connect from Claude or ChatGPT

Add a remote MCP server with the URL:

```
https://wallet.example.com/api/mcp
```

The host opens the login. The user logs in as usual. The tools then appear in the chat. The first payment answers `access_required` with a link; the user approves the agent once, with a code sent to their email.

## Stdio for local hosts

For Claude Code, Claude Desktop, Cursor, and other local hosts:

```sh
m2m-payments login --api https://wallet.example.com      # from the m2m-payments CLI, once
npx @m2m-payments/mcp --api https://wallet.example.com
```

`m2m-payments-mcp` reads the token from `M2M_PAYMENTS_TOKEN`, else from `~/.config/m2m-payments/config.json` (`accessToken`, written by `m2m-payments login`). A URL with no path maps to `<url>/api/m2m-payments`. A URL with a path is used as given.

Claude Code:

```sh
claude mcp add m2m-payments -- npx @m2m-payments/mcp --api https://wallet.example.com
```

Options: `--requester "Claude Code"` sets the name the user sees on approvals and top-ups. `--token <jwt>` overrides the token.

## Library use

```ts
import {
  createM2mPaymentsMcpServer,
  registerM2mPaymentsTools,
  M2mPaymentsApi,
} from "@m2m-payments/mcp";

// One server bound to one token.
const server = createM2mPaymentsMcpServer({ apiBaseUrl, bearerToken, requester: "My agent" });

// Or add the tools to your own McpServer.
registerM2mPaymentsTools(myServer, {
  api: new M2mPaymentsApi({ baseUrl: apiBaseUrl, bearerToken }),
});
```

The text summaries are exported too (`describeWallet`, `describeAccessRequest`, `describeTopUpRequest`, `describePaymentResult`, `describePayment`, `describeApiError`) for anyone who wants the same wording in another surface.
