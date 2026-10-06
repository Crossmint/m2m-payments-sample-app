# @m2m-payments/cli

The M2M Payments CLI, installed as `m2m-payments`. It lets an agent pay other machines from the user's non-custodial wallet: x402 endpoints, MPP endpoints, transfers and raw transactions, all in credits (1 credit = 1 USD). The user approves the agent once, in a browser, and tops the wallet up by card. The agent never holds a key, a card or a Crossmint credential.

Works for humans too.

## Install

```sh
npm i -g @m2m-payments/cli
```

Node 20 or newer.

## Log in

```sh
m2m-payments login --api https://wallet.example.com/api/m2m-payments
```

The CLI reads `GET /v1/config` from that URL. It then runs an OAuth 2.1 PKCE login in your browser and stores the tokens in `~/.config/m2m-payments/config.json` (mode 0600).

No local browser? Use the paste flow:

```sh
m2m-payments login --code
```

It prints a URL. Open it anywhere, log in, and paste the code back.

For CI or an agent sandbox, skip login. Set `M2M_PAYMENTS_API_URL` and `M2M_PAYMENTS_TOKEN` instead.

Check the session with `m2m-payments whoami`. Remove it with `m2m-payments logout`.

## The wallet

```sh
m2m-payments wallet     # address, chain, balance, this agent's access
m2m-payments balance    # just the credits
```

`wallet` exits 2 and prints the approval URL when an access request is waiting on the user. Until the user has opened the app once there is no wallet: the command says so.

## Step 1: get access

```sh
m2m-payments access request --reason "Research API calls for the market brief" --wait
```

The command prints an approval URL. Show it to the user verbatim. They approve once, in the browser, with a code sent to their email. With `--wait` the command polls every 2 seconds until the request is active, denied or expired; `--timeout <s>` gives up sooner. Resume waiting later with `m2m-payments access status <id> --wait`.

You can skip this step: the first `pay` call answers with the same URL and exit code 2 when access is missing.

## Step 2: pay

```sh
m2m-payments pay x402 https://api.example.com/v1/search --body '{"q":"solar"}' --header "content-type: application/json" --max 0.10 --memo "market brief"
m2m-payments pay mpp  https://api.example.com/v1/infer  --body '{"prompt":"..."}' --max 0.10
```

The server runs the 402 handshake (or the MPP challenge), signs with the agent's signer, retries the request and returns the endpoint's response. The command prints what was paid, the settlement transaction with an explorer link, the response status, and then the body on its own so it can be piped. `--max` caps this one call in credits; the server refuses before signing when the endpoint asks for more. `--method` defaults to GET, or POST when `--body` is given.

Two errors mean the user has to act, and both exit 2 instead of 1:

- `access_required`: the approval URL is printed. Show it, then retry.
- `insufficient_funds`: the balance and the required amount are printed, with the command to run: `m2m-payments top-up request --amount <required>`.

## Step 3: top up

```sh
m2m-payments top-up request --amount 10 --reason "40 research calls at 0.05 each" --wait
```

Prints a top-up URL. The user pays by card in the browser, with no identity check. `--wait` polls until the request is completed, denied or expired and prints the credits received. Resume with `m2m-payments top-up status <id> --wait`.

## Transfers and transactions

Only when the user asked for them, with the exact address and amount they gave.

```sh
m2m-payments transfer --to 0x... --amount 5 --memo "refund"
m2m-payments tx --to 0x... --data 0x... --value 0
```

Both print the hash and the explorer link.

## Activity

```sh
m2m-payments payments list --limit 20 --kind x402
```

## Output and exit codes

Every command accepts `--json`. Errors go to stderr.

| Code | Meaning                                         |
| ---- | ----------------------------------------------- |
| 0    | ok                                              |
| 1    | error, or the user denied                       |
| 2    | needs the user: an approval URL or a top-up URL |
| 3    | not logged in                                   |

## Config

`~/.config/m2m-payments/config.json` (or `$XDG_CONFIG_HOME/m2m-payments/`, or `$M2M_PAYMENTS_CONFIG_DIR`):

```json
{
  "apiBaseUrl": "https://wallet.example.com/api/m2m-payments",
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "2026-01-01T00:00:00.000Z",
  "tokenEndpoint": "https://test.stytch.com/v1/public/<projectId>/oauth2/token",
  "clientId": "connected-app-...",
  "userId": "user-test-...",
  "email": "you@example.com"
}
```

Access tokens refresh on their own when they are within 60 seconds of expiry.

## Agent skill

The `skills/m2m-payments` folder in the repo teaches Claude Code and similar agents how to use this CLI. See its README.
