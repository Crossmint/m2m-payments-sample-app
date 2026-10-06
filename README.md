# M2M Payments Sample App

An open source sample app for machine-to-machine payments on Crossmint wallets.

The M2M Payments Sample App shows how to give an AI agent a wallet it can pay other machines from. A user tops up a non-custodial wallet by card, in "credits" (1 credit = 1 USD), with no KYC. The user approves the agent once. The agent then pays x402 endpoints and MPP endpoints on its own, in the background, and can transfer credits or send transactions when asked.

It is the machine-to-machine twin of the [Agent Commerce sample app](https://github.com/Crossmint/agent-commerce-sample-app): the same site, the same five experiences, the same auth, the same package layout. Cards and checkouts are replaced by a wallet, an onramp and two payment protocols. It wraps the Crossmint wallets and onramp APIs and adds the parts Crossmint does not ship: the approval screen, the top-up screen, the agent tooling, and the glue between them.

## What do I use?

| You have                                            | You want                                                          | Install                                                        | Copy                                               |
| --------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| A web app with users                                | Users fund a wallet and let your agent pay from it                | `@m2m-payments/core` `@m2m-payments/server` `@m2m-payments/ui` | the `/app` screens from `apps/web`                 |
| An agent in Claude Code, ChatGPT, or a chat channel | A hosted place where users approve and top up, plus agent tooling | Deploy `apps/web`. Give agents `m2m-payments` or the MCP URL   | Nothing. Configure and deploy                      |
| Your own auth (Auth0, Clerk, Supabase)              | All of the above with your login                                  | Implement `UserAuth` from `@m2m-payments/auth`                 | `packages/auth/src/stytch.ts` as a template        |
| Your own backend                                    | Only the typed wallet client and the x402 and MPP payers          | `@m2m-payments/core`                                           | Nothing                                            |
| A chat product                                      | Approve access and top up inline in the conversation              | `@m2m-payments/ui` + `@m2m-payments/server` in process         | `components/chat` and `api/chat` from `apps/web`   |
| A paid API                                          | An endpoint that charges agents over x402 or MPP                  | Nothing                                                        | `api/demo/x402` and `api/demo/mpp` from `apps/web` |

## Packages

| Package                                      | What it is                                                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`@m2m-payments/core`](packages/core)        | Types, the credits token and the shared tool docs. `@m2m-payments/core/server`: Crossmint wallets and orders client, x402 and MPP payers. |
| [`@m2m-payments/auth`](packages/auth)        | One `UserAuth` interface. Stytch adapter. Generic JWKS adapter. OAuth PKCE helpers.                                                       |
| [`@m2m-payments/server`](packages/server)    | The HTTP API as Web-standard request handlers. Mounts in one Next.js route file at `/api/m2m-payments`.                                   |
| [`@m2m-payments/ui`](packages/ui)            | React components: the wallet, approve agent access, top up, activity.                                                                     |
| [`@m2m-payments/mcp`](packages/mcp)          | MCP server exposing the API as tools, with OAuth 2.1.                                                                                     |
| [`@m2m-payments/cli`](packages/cli)          | The CLI, installed as `m2m-payments`. Same surface as MCP, for terminal agents and humans.                                                |
| [`skills/m2m-payments`](skills/m2m-payments) | A skill that teaches coding agents how to use the CLI.                                                                                    |
| [`plugins/cursor`](plugins/cursor)           | Cursor plugin: the hosted MCP server, the skill, and a payments rule. Also loads in Grok Bot.                                             |
| [`plugins/claude`](plugins/claude)           | Claude Code plugin: the same MCP server and skill. Install with `/plugin marketplace add Crossmint/m2m-payments-sample-app`.              |
| [`apps/web`](apps/web)                       | The reference website: the landing page, the app, the API, the MCP endpoint, two demo endpoints that charge over x402 and MPP.            |

## How it flows

1. The user signs in and the browser creates their **wallet**: a smart wallet on Base with a device signer made in the browser and an email signer as recovery. Non-custodial; the key never leaves the device.
2. The agent runs `m2m-payments pay x402 <url> --max 0.10`. The wallet has not let this agent in yet, so the call answers `access_required` with a link. The user opens it and approves the agent's **server signer** once, with a code sent to their email. From then on the agent pays with no prompt.
3. The wallet is empty, so the next call answers `insufficient_funds`. The agent runs `m2m-payments top-up request --amount 10` and shows the link. The user pays by card. No KYC: credits are a closed-loop token that only buys machine services, the same merchant category as buying OpenAI or Anthropic credits, and Visa and Mastercard treat it that way.
4. The agent pays. The server runs the **x402** handshake or the **MPP** challenge, signs with the agent's server signer, retries the request, and hands back the endpoint's response with the amount paid and the settlement hash. Every payment lands in the user's activity list.

Transfers (`m2m-payments transfer --to 0x... --amount 5`) and raw transactions (`m2m-payments tx --to 0x... --data 0x...`) use the same signer, only when the user asks.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full design and [docs/API.md](docs/API.md) for the HTTP contract.

## Design

The site follows the design of the [Crossmint onramp sample app](https://github.com/Crossmint/onramp-sample-app): a white ground with a dot grid, one blue accent, system sans for text and a display face for money figures only. The app is one Next.js page with a device mockup and an experience switcher at `/app`: Mobile, Desktop, Messaging, Agent MCP and CLI skill show the same flow from each side. The approval screen follows the same fixed order as the card one in Agent Commerce: headline, what is asked, one reassurance line with a lock, Allow, Deny. The top-up screens are the onramp app's screens. Theme tokens live in `packages/ui/src/styles.css`; the frames live in `apps/web/components/frame/`.

## Run it locally

```bash
pnpm install
cp .env.example apps/web/.env.local
pnpm dev
```

You need a Crossmint staging project, a Stytch project, and a signer secret for the agent. See `.env.example`. Staging puts the wallet on Base Sepolia, where the two demo endpoints charge 0.05 credits a call.

Then, in another terminal:

```bash
pnpm --filter @m2m-payments/cli build
node packages/cli/dist/bin.js login --api http://localhost:3000/api/m2m-payments
node packages/cli/dist/bin.js wallet
```

## License

MIT
