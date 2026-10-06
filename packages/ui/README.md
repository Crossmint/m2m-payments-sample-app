# @m2m-payments/ui

React components for M2M Payments: the wallet, agent access approval, the credits onramp and the payments ledger. shadcn/ui on Tailwind v4, on the same theme tokens as the Agent Commerce sample app.

`docs/UI.md` at the repository root is the contract this package implements.

## Setup

```tsx
import "@m2m-payments/ui/styles.css"; // once, after `@import "tailwindcss"` in your CSS

<M2mPaymentsProvider
  apiBaseUrl="/api/m2m-payments"
  getJwt={() => session?.jwt ?? null}
  crossmintClientApiKey={process.env.NEXT_PUBLIC_CROSSMINT_CLIENT_API_KEY}
  crossmintEnvironment="staging"
  userEmail={user.email}
>
  {children}
</M2mPaymentsProvider>;
```

The provider wires the API client to the session JWT and mounts Crossmint's wallet SDK client side, as a sibling of your tree, so the wallet is created on the first sign-in with a device signer and email recovery. Read it with `useSdkWallet()`.

## Components

| Component                                                    | What it does                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `ApproveAgentAccess`                                         | "<Agent> wants to use your wallet". Allow prepares the agent's signer, the email code prompt confirms it, Deny declines. |
| `TopUp`                                                      | Add credits by card in three steps: amount and keypad, order preview, status with the count-up.                          |
| `WalletCard`                                                 | Balance, address, Add credits, agent access with Revoke.                                                                 |
| `PaymentsTable`                                              | The ledger: x402, MPP, transfers, transactions, top-ups.                                                                 |
| `ActivityList`                                               | On-chain transfers in and out.                                                                                           |
| `ApproveAgentAccessPreview`                                  | A static replica of the approval screen for landing pages.                                                               |
| `CardPicker`, `SaveCard`, `AddCardDialog`, `ConnectedAgents` | Kept from Agent Commerce.                                                                                                |

## Hooks

`useWallet`, `useBalance`, `useActivity`, `usePayments`, `useAccessRequest`, `useTopUpRequest`, `useTopUp`, `usePaymentMethods`, `useAmountField`, `useCountUp`, `useMediaQuery`, `useResource`.

## API client

`createM2mPaymentsApi({ baseUrl, getJwt })` has one typed function per route in `docs/API.md` and throws `M2mPaymentsApiError` (`status`, `code`, `details`) on any non-2xx.

## Styles

`styles.css` holds the theme tokens and the keyframes the amount field needs. The `enter-up` cascade comes from the host app's global CSS; without it the screens lose only motion.
