# M2M Payments plugin for Cursor

Gives the agent in Cursor a wallet it can pay other machines from: x402 endpoints, MPP endpoints, transfers and transactions, in credits the user bought by card. The user approves the agent once.

What it installs:

- **MCP server** `m2m-payments`, pointed at the hosted M2M Payments wallet at `https://m2m-payments.demos-crossmint.com/api/mcp`. Cursor signs the user in through OAuth on first use. The user sees the M2M Payments consent screen, then approves the agent's access to their wallet once, with a code sent to their email.
- **Skill** `m2m-payments`: the order of things. Check the wallet, ask for access and show the link, pay with `pay_x402` or `pay_mpp`, request a top-up when the wallet is short, report the amount and the hash.
- **Rule** `m2m-payments`: the short version, applied whenever a task needs to pay an endpoint or move credits.

## Install

From the Cursor Marketplace, once listed. Until then, add this repository as a plugin source:

```
https://github.com/Crossmint/m2m-payments-sample-app
```

## Point it at your own wallet

If you deploy the M2M Payments template yourself, change the URL in `mcp.json` to your deployment's `/api/mcp`. Or run the MCP server locally over stdio, logged in with the CLI:

```json
{
  "mcpServers": {
    "m2m-payments": {
      "command": "npx",
      "args": [
        "-y",
        "@m2m-payments/mcp",
        "--api",
        "https://your-wallet.example.com/api/m2m-payments"
      ]
    }
  }
}
```

## Keep the skill in sync

`skills/m2m-payments/SKILL.md` here is a copy of `skills/m2m-payments/SKILL.md` at the repo root. Run `pnpm plugin:sync` after editing the original.

## Grok Bot

Grok Bot reads the same plugin layout. Install this folder the same way, or connect the MCP URL directly in its connector settings.
