# @m2m-payments/core

Two entries.

`@m2m-payments/core` is browser-safe: the credits token, the shared types from `docs/API.md`, amount formatting, and `TOOL_DOCS`.

```ts
import { CLOSED_LOOP_TOKEN, tokenInfo, formatCredits, TOOL_DOCS } from "@m2m-payments/core";

tokenInfo("staging");
// { symbol: "CRED", name: "Credits", chain: "base-sepolia", underlying: { symbol: "USDC", ... } }
```

`@m2m-payments/core/server` is Node only. It wraps the Crossmint wallets SDK and pays x402 and MPP endpoints.

```ts
import {
  createWalletsClient,
  CrossmintClient,
  payWithX402,
  payWithMpp,
} from "@m2m-payments/core/server";

const wallets = createWalletsClient({
  serverApiKey: process.env.CROSSMINT_SERVER_API_KEY!,
  environment: "staging",
  signerSecret: process.env.M2M_PAYMENTS_SIGNER_SECRET!,
});

const wallet = await wallets.getUserWallet(userId); // by owner locator, never by address
const balance = await wallets.balance(wallet); // { value: "12.50", currency: "CRED" }
const { locator, signatureId } = await wallets.prepareAgentSigner(wallet); // the user approves it in the browser
const agent = await wallets.asAgent(wallet); // the server signer, active
const result = await payWithX402({ agent, input: { url }, maxAmount: "0.10", decimals: 6 });
```

Contains no auth, no storage, no HTTP routes.
