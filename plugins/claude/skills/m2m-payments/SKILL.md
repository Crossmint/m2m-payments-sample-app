---
name: m2m-payments
description: Pay other machines from the user's agent wallet with M2M Payments. Use this whenever a task needs to pay for an API or a service, call an endpoint that answers 402 or charges over x402 or MPP (the Machine Payments Protocol), check or top up the wallet's credits, transfer credits, or send a transaction from the agent wallet, or when the user mentions their agent wallet, credits, a top-up, x402 or MPP. The `m2m-payments` CLI pays from a non-custodial wallet the user funded by card; the user approves the agent once in a browser. Never ask the user for keys, seed phrases or card numbers.
---

# M2M Payments: pay machines from the user's wallet, with their approval

M2M Payments gives you a wallet you can pay from. You never hold a key, a card or a Crossmint credential: the `m2m-payments` CLI calls the M2M Payments API as the user, and the server signs with a signer the user approved once.

Four things to know:

- **Wallet**: the user's non-custodial smart wallet on Base. Created in their browser the first time they open the app. One per user.
- **Credits**: what the wallet holds and spends. 1 credit = 1 USD. The user buys them by card, with no identity check. Amounts are decimals like `0.05` or `10`.
- **Agent access**: your permission to pay from the wallet. The user approves it once, in the browser, with a code sent to their email. After that every payment runs in the background with no prompt. Status: `none`, `pending`, `active`, `revoked`.
- **Top-up**: the user adding credits. You ask for an amount; they pay by card at a link you show them.

Two ways to pay an endpoint: `pay x402` for the x402 protocol (HTTP 402 with a payment header) and `pay mpp` for the Machine Payments Protocol. The server does the handshake, the signature and the retry. You get the endpoint's response plus a receipt.

## Before anything

Check the session and the wallet:

```sh
m2m-payments whoami
m2m-payments wallet
```

`whoami` exit code 3 means not logged in. Ask the user to run `m2m-payments login --api <their wallet API url>` in their own terminal. Do not run login for them unless they ask. Login opens a browser; in a headless shell it needs `--code`.

If `M2M_PAYMENTS_API_URL` and `M2M_PAYMENTS_TOKEN` are set, no login is needed.

`wallet` prints the address, the balance and your access status. If it says `wallet_not_found`, the user has to open the app once in their browser; tell them. If access is `pending` it exits 2 and prints the approval URL: go to step 1's second half.

## Step 1: get access

Skip this when `wallet` says access is `active`.

```sh
m2m-payments access request --reason "Research API calls for the market brief" --wait --timeout 600
```

The command prints an approval URL. **Show that URL to the user verbatim.** They open it, log in, and approve with a code sent to their email. `--wait` polls every 2 seconds until the request is answered.

- Exit 0: active. Go pay.
- Exit 1: denied or expired. Tell the user. Do not request again without asking them.
- Exit 2: still pending when the timeout hit. Show the URL again and resume with `m2m-payments access status <requestId> --wait`.

You may also skip straight to step 2: a `pay` call without access exits 2 and prints the same approval URL. Show it, wait with `access status <id> --wait`, then retry the payment.

## Step 2: pay

```sh
m2m-payments pay x402 https://api.example.com/v1/search --body '{"q":"solar panels 2026"}' --header "content-type: application/json" --max 0.10 --memo "market brief: search"
m2m-payments pay mpp  https://api.example.com/v1/infer  --body '{"prompt":"..."}' --max 0.10 --memo "market brief: summary"
```

- `--max` caps what this one call may pay, in credits. Set it to what the call is worth. The server refuses before anything is signed when the endpoint asks for more, and tells you the price; raise `--max` only if the user agrees.
- `--method` defaults to GET, or POST when `--body` is given. `--body` is a string: serialize JSON yourself. Repeat `--header` for each header.
- `--memo` is what the user sees in their activity list. Say what the payment was for.

The output shows the amount paid, the settlement transaction (with an explorer link), the response status, and then the response body on its own. Add `--json` to read the result as one object (`paid`, `amount`, `settlement`, `response.body`).

Exit codes from `pay`:

- Exit 0: done. `Paid 0.05 CRED to api.example.com over x402.` If the endpoint did not ask for money the output says so and nothing was charged.
- Exit 2, `access_required`: the approval URL is printed. Show it verbatim, then `m2m-payments access status <id> --wait`, then retry.
- Exit 2, `insufficient_funds`: the balance and the required amount are printed, with the command to run. Go to step 3.
- Exit 1: anything else. Read stderr and tell the user.

## Step 3: top up when the wallet is short

```sh
m2m-payments top-up request --amount 10 --reason "40 research calls at 0.05 each" --wait --timeout 600
```

Ask for what the task needs with a little room, not more. The command prints a top-up URL. **Show that URL to the user verbatim.** They pay by card in the browser, with no identity check. `--wait` polls until the credits land.

- Exit 0: completed. The output shows the credits received. Retry the payment.
- Exit 1: declined or expired. Tell the user. Do not ask again without talking to them.
- Exit 2: still pending when the timeout hit. Show the URL again and resume with `m2m-payments top-up status <requestId> --wait`.

Confirm with `m2m-payments balance` when you want to be sure before paying.

## Transfers and transactions: only when the user asks

```sh
m2m-payments transfer --to 0x... --amount 5 --memo "refund to Ada"
m2m-payments tx --to 0x... --data 0x... --value 0 --memo "claim"
```

Use the exact address and amount the user gave. Both print the hash and an explorer link. Neither can be undone. Never send a transaction whose calldata you do not understand.

## Reporting

Tell the user what was spent and where it went. Every payment has an amount in credits and, when it settled on chain, a hash. `m2m-payments payments list` shows the wallet's activity, newest first, with kind, status, amount, counterparty and note. Use it to sum up a task.

## Exit codes

| Code | Meaning        | What to do                                                             |
| ---- | -------------- | ---------------------------------------------------------------------- |
| 0    | ok             | continue                                                               |
| 1    | error          | read stderr, tell the user; a denial is final until they say otherwise |
| 2    | needs the user | show the approval URL or the top-up URL verbatim, then wait            |
| 3    | not logged in  | ask the user to run `m2m-payments login`                               |

Errors go to stderr. With `--json`, errors are `{ "error": { "code", "message", "details" } }`; `details.approvalUrl` holds the link on `access_required`, `details.required` the amount on `insufficient_funds`.

## Example: a market brief from a paid research API

```sh
m2m-payments whoami
m2m-payments wallet
# → access none, balance 0.00 CRED
m2m-payments pay x402 https://api.example.com/v1/search --body '{"q":"solar"}' --max 0.10
# → exit 2, access_required. Show https://wallet.example.com/approve/acs_... to the user
m2m-payments access status acs_... --wait
# → exit 0, active
m2m-payments pay x402 https://api.example.com/v1/search --body '{"q":"solar"}' --max 0.10
# → exit 2, insufficient_funds: balance 0.00 CRED, required 0.05 CRED
m2m-payments top-up request --amount 10 --reason "40 research calls at 0.05 each" --wait
# → show https://wallet.example.com/top-up/tup_... to the user; exit 0, 10.00 CRED received
m2m-payments pay x402 https://api.example.com/v1/search --body '{"q":"solar"}' --max 0.10 --memo "market brief"
# → exit 0: Paid 0.05 CRED to api.example.com over x402. Settlement 0x...
```

Report: "Paid 0.05 credits for the search (tx 0x...). 9.95 credits left."

## Do not

- Do not ask the user for a private key, a seed phrase, a card number or a Crossmint key. M2M Payments exists so you never need them.
- Do not pay more than the task needs, and do not set `--max` above what one call is worth.
- Do not request a top-up for more than the task needs with a little room.
- Do not loop on `access request` or `top-up request` after the user denied or declined. Ask them first.
- Do not run `transfer` or `tx` unless the user asked for that exact action.
- Do not paraphrase an approval or top-up URL. Show it as printed.
