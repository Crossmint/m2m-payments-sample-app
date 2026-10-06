# `@m2m-payments/ui` public API

The contract between the UI package and the web app. `packages/ui` implements it; `apps/web` imports it. Types named here come from `@m2m-payments/core` unless defined below.

## Provider

```tsx
<M2mPaymentsProvider
  apiBaseUrl="/api/m2m-payments"            // default
  getJwt={() => string | null | Promise<string | null>}
  crossmintClientApiKey={ck}
  crossmintEnvironment="staging" | "production"
  userEmail={email}                          // the signed-in user's email; email recovery needs it
  mascotSrc="/crossmint-mark.svg"
>
```

It mounts Crossmint's `CrossmintProvider` (with the current `jwt`) and `CrossmintWalletProvider` with `createOnLogin: { chain, recovery: { type: "email", email: userEmail } }`, client side only, inside an error boundary (the `CrossmintScope` pattern). The wallet is created on the first sign-in with a device signer and email recovery. The chain comes from `chainFor(crossmintEnvironment)`.

`useM2mPayments()` → `{ api, apiBaseUrl, jwt, refreshJwt, crossmint: { clientApiKey, environment, chain }, userEmail, mascotSrc }`.

`useSdkWallet()` → `{ wallet, status, error }`: Crossmint's `useWallet()`, null-safe when the SDK is not mounted. Used by `ApproveAgentAccess` for `useSigner` + `approve`.

## API client

`createM2mPaymentsApi({ baseUrl, getJwt, fetch? })` → typed functions for every route in `docs/API.md`, throwing `M2mPaymentsApiError` (`status`, `code`, `details`) on non-2xx:

`getConfig, me, getWallet, getBalance, getActivity(limit?), revokeAccess, revokedAccess, createAccessRequest(input), getAccessRequest(id), approveAccessRequest(id), confirmAccessRequest(id), denyAccessRequest(id), createTopUpRequest(input), getTopUpRequest(id), denyTopUpRequest(id), createTopUp(input), payTopUp(orderId, paymentMethodId), getTopUp(orderId), listPaymentMethods, deletePaymentMethod(id), listPayments({ limit?, kind? }), payX402(input), payMpp(input), transfer(input), sendTransaction(input)`.

`errorMessage(err, fallback?)` as in Agent Commerce.

## Hooks

- `useWallet()` → `Resource<WalletView> & { notFound: boolean }`. Polls every 15 s. A `wallet_not_found` 404 sets `notFound` and leaves `data` undefined instead of `error`.
- `useBalance({ pollMs? })` → `Resource<WalletBalance>`.
- `useActivity()` → `Resource<ActivityItem[]>`.
- `usePayments({ limit?, kind? })` → `Resource<Payment[]>`.
- `useAccessRequest(id)` → `Resource<AccessRequest>`. Polls every 2 s while `pending` or `approved`.
- `useTopUpRequest(id)` → `Resource<TopUpRequest>`. Polls every 3 s while `pending` or `paying`.
- `useTopUp()` → the onramp order state machine, ported from the onramp sample app's `useOnrampOrder`:
  `{ phase: "idle" | "creating" | "preview" | "paying" | "confirming" | "success" | "error", view?: TopUpView, error?: string, create(amount: string, requestId?: string), pay(paymentMethodId: string), reset() }`. `pay` polls `getTopUp` every 3 s until `completed` or `failed`, at most 10 times, then treats a still-processing order as success with `pending: true`.
- `usePaymentMethods()` → `Resource<PaymentMethod[]> & { remove(id) }`. Kept.
- `useMediaQuery`, `useResource`. Kept.

## Components

### `<ApproveAgentAccess requestId variant? agentName? onDone? className? />`

The approval screen. Fixed order:

1. Headline: "<agentName ?? request.requester> wants to use your wallet". Sub: "Approve it once. After that it pays in the background."
2. A `dl` with rows: **Agent** (the requester), **Reason** (when set), **Can do** ("Pay x402 and MPP services, transfer credits, send transactions"), **From** (the wallet's address, short).
3. One reassurance line with a lock: "You confirm with a code sent to your email. You can revoke access any time from the app."
4. Full-width **Allow**, grey full-width **Deny** under it.

Allow: `api.approveAccessRequest(id)` → `{ signatureId | transactionId }` → `sdkWallet.useSigner({ type: "email", email })` → `sdkWallet.approve({ signatureId | transactionId })` (Crossmint shows its email code prompt) → `api.confirmAccessRequest(id)`. While the SDK prompt is up, the button area shows a spinner line "Confirming with your email code". Success replaces the screen: "Approved" as the small word, the requester's name as the headline, "It can now pay from your wallet. Revoke it any time from the app." and "You can close this tab."

Denied, expired, failed endings follow `ApproveAgentCard` from Agent Commerce. `variant`: `"card"` (own panel) or `"plain"` (the page frames it). Returning to an `approved` request resumes at the SDK approval step when the signer is not approved yet.

```ts
type AccessOutcomeStatus = "active" | "denied" | "expired" | "failed";
interface AccessOutcome {
  status: AccessOutcomeStatus;
  request: AccessRequest;
}
```

### `<TopUp requestId? initialAmount? variant? container? onDone? onClose? className? />`

The onramp, as the onramp sample app draws it, in three steps inside one column:

1. **Amount**: "Add credits" heading; the big figure with `$` and the keypad (desktop) or native keyboard (touch); the line "credits to receive · no ID check"; the payment method row ("Pay with Visa •••• 4242", **Change** / **Select**) which opens `CardPicker` in a sheet or dialog (saved cards, "Add a new card" through `SaveCard`); **Preview** button. With `requestId` the amount is prefilled from the request and the reason shows under the heading.
2. **Preview**: back arrow, "Order preview"; headline `+<amount> credits`; "You'll be charged $<total>"; rows You'll get, Rate, Fees, Pay with, Total; the terms checkbox; **Pay $<total>** with a lock. Skeletons until the quote lands.
3. **Status**: success counts `+<received>` credits up in the display face, then **Done**; error shows the message with **Try again** and **Back**.

`onDone(outcome)` fires once on Done or on a terminal request state. `onClose` on the X of step 1. `container` is the portal target for the keypad and sheets (the phone screen).

```ts
type TopUpOutcomeStatus = "completed" | "denied" | "expired" | "failed";
interface TopUpOutcome {
  status: TopUpOutcomeStatus;
  request?: TopUpRequest;
  received?: Amount;
  orderId?: string;
}
```

### `<WalletCard onAddCredits? onRevokeAccess? compact? className? />`

Balance as the big blue figure (`formatCredits`, display face), "Credits" above it, the short address with a copy button and an explorer link, **Add credits**, and the agent access line: "Agent access: active since <date>" with **Revoke**, "pending" with "Waiting for your approval", or "Not granted" with one line saying the agent asks when it needs it. `notFound` shows "Creating your wallet" with a spinner (the SDK is doing it).

### `<PaymentsTable payments loading? compact? onSelect? />`

One row per `Payment`: a kind mark (x402, MPP, transfer, transaction, top-up), counterparty and description, amount in credits (signed: top-ups `+`, others `−`), status badge, relative time. Empty state through `EmptyState`.

### `<ActivityList items loading? />`

On-chain transfers from `useActivity`, same row style.

### `<ApproveAgentAccessPreview agentName? reason? address? />`

Static replica of the approval screen for the landing page and brand demos. No data, no API.

### Kept from Agent Commerce

`CardPicker`, `SaveCard` (without the register step), `AddCardDialog`, `CardMark`, `ConnectedAgents`, `Mascot`, `EmptyState`, every primitive, `cn`.

## Formatting (`src/lib/format.ts`)

`formatAmount`, `formatCredits` (re-exported from core), `formatDate`, `formatDateTime`, `formatRelativeTime`, `paymentMethodLabel`, `cardBrandLabel`, `shortAddress("0x1234…abcd")`, `paymentKindLabel(kind)`.

## Constants

```ts
export const ACCESS_ASK = {
  title: "wants to use your wallet",
  sub: "Approve it once. After that it pays in the background.",
};
export const TOP_UP_ASK = { title: "Add credits", sub: "By card. No ID check." };
```
