# M2M Payments skill

Teaches a coding agent (Claude Code, Codex, Cursor, and others that read `SKILL.md`) when and how to use the `m2m-payments` CLI to pay for APIs and services from the user's agent wallet.

## Requirements

```sh
npm i -g @m2m-payments/cli
m2m-payments login --api https://wallet.example.com/api/m2m-payments
```

## Install the skill

With the skills CLI:

```sh
npx skills add crossmint/m2m-payments-sample-app
```

Or copy the folder by hand:

```sh
# Claude Code, for one user
mkdir -p ~/.claude/skills
cp -r skills/m2m-payments ~/.claude/skills/m2m-payments

# Claude Code, for one project
mkdir -p .claude/skills
cp -r skills/m2m-payments .claude/skills/m2m-payments
```

Restart the agent. Ask it to call a paid API. It will run `m2m-payments wallet`, ask for access if it has none, and show you an approval URL.

## What the skill enforces

- Log in first. Exit code 3 means run `m2m-payments login`.
- Check the wallet, then ask for access once and show the approval URL to the user verbatim.
- Pay with `m2m-payments pay x402` or `pay mpp`, with `--max` set to what one call is worth.
- On `insufficient_funds`, request a top-up for what the task needs and show the top-up URL verbatim.
- Transfers and raw transactions only when the user asks.
- Report what was paid, with the hash.
- Never ask for keys, seed phrases or card numbers. Never loop after a denial.
- Read exit codes: 0 ok, 1 error, 2 needs the user, 3 not logged in.

## Keep the copies in sync

`plugins/claude/skills/m2m-payments/SKILL.md`, `plugins/cursor/skills/m2m-payments/SKILL.md` and `apps/web/public/skill.md` are copies of this folder's `SKILL.md`. Run `pnpm plugin:sync` after editing it.
