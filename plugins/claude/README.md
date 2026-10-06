# M2M Payments plugin for Claude Code

Gives Claude Code a wallet it can pay other machines from: x402 endpoints, MPP endpoints, transfers and transactions, in credits the user bought by card. The user approves the agent once.

What it installs:

- **MCP server** `m2m-payments` at `https://m2m-payments.demos-crossmint.com/api/mcp`. Claude Code signs the user in through OAuth on first use (`/mcp`, then Authenticate). The user sees the M2M Payments consent screen, then approves the agent's access to their wallet once, with a code sent to their email.
- **Skill** `m2m-payments`: the order of things. Check the wallet, ask for access and show the link, pay with `pay_x402` or `pay_mpp`, request a top-up when the wallet is short, report the amount and the hash.

## Install

```
/plugin marketplace add Crossmint/m2m-payments-sample-app
/plugin install m2m-payments@m2m-payments
```

## Point it at your own wallet

Change the URL in `.mcp.json` to your deployment's `/api/mcp`, or run the server over stdio with the CLI login:

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

`skills/m2m-payments/SKILL.md` here is a copy of the one at the repo root. Run `pnpm plugin:sync` after editing the original.
