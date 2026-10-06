<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Conventions for apps/web

This app is the Agent Commerce sample app with the card domain swapped for a wallet. Keep its shape: five experiences under `/app`, the frames in `components/frame/`, the URL as state, the chat tools calling the server handlers in process, and the two client-side tools that put a screen in the thread.

## Name mapping

| Agent Commerce                                     | M2M Payments                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| saved card, agent card                             | wallet, agent access                                                               |
| budget approval (`ApproveAgentCard`)               | wallet access approval (`ApproveAgentAccess`), `/approve/<id>`                     |
| checkout (`CheckoutView`)                          | top-up (`TopUp`), `/top-up/<id>`                                                   |
| `request_agent_card` + `await_agent_card_approval` | `request_wallet_access` + `await_wallet_access`, `request_top_up` + `await_top_up` |
| `create_checkout`, `get_checkout`                  | `pay_x402`, `pay_mpp`, `transfer`, `send_transaction`                              |
| Cards section                                      | Wallet section (`components/experiences/wallet-section.tsx`)                       |
| `/api/agent-commerce`                              | `/api/m2m-payments`                                                                |

## Where the wallet lives

- Crossmint holds the wallet, its signers, the orders and the on-chain history. The browser creates the wallet on first sign-in through `M2mPaymentsProvider` (device signer, email recovery). The server resolves it by `userId:<id>:evm` and never stores an address.
- The server signs agent payments with the signer in `M2M_PAYMENTS_SIGNER_SECRET`, once the user approved it. The agent never holds a key, a card, or a Crossmint credential.
- The app's own rows (access requests, wallet access, top-up requests, orders, the payments ledger, agent sessions) come from `@m2m-payments/server`; the chat tables are in `lib/db/schema.ts`.
- Two paid endpoints live here so the demo pays something real on staging: `app/api/demo/x402/inference` and `app/api/demo/mpp/inference`. Both charge `M2M_PAYMENTS_DEMO_PRICE` credits to `M2M_PAYMENTS_DEMO_PAY_TO`.

## Writing rules

- Tokens only: colors, radii and type come from `@m2m-payments/ui/styles.css` and the brand themes. No raw hex in components.
- Say credits, never USDC. The underlying asset appears only in developer surfaces.
- Plain sentences in comments. No em dashes, no emoji.
- The chat prompt (`lib/chat/prompt.ts`) and the tool descriptions (`TOOL_DOCS` in `@m2m-payments/core`) are the model's only instructions. Change them together.
