"use client";

import { useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import {
  ActivityList,
  AddCardDialog,
  Badge,
  Button,
  CardMark,
  Dialog,
  DialogContent,
  DialogTitle,
  PaymentsTable,
  Skeleton,
  Spinner,
  TopUp,
  WalletCard,
  errorMessage,
  formatDate,
  paymentMethodLabel,
  useActivity,
  usePaymentMethods,
  usePayments,
  useWallet,
} from "@m2m-payments/ui";
import { ScreenHeading } from "@/components/focus-screen";

/**
 * The Wallet section of the desktop app: the balance and the address, the
 * agent's access to it, what the agent paid, what moved on chain, and the
 * cards that top the wallet up. One scrolling column, each block a heading
 * and the thing itself.
 */
export function WalletSection() {
  const wallet = useWallet();
  const payments = usePayments({ limit: 50 });
  const activity = useActivity();
  // Fetched once here: the saved-cards block lists them and the top-up picks from them.
  const paymentMethods = usePaymentMethods();
  const [adding, setAdding] = useState(false);
  const [toppingUp, setToppingUp] = useState(false);

  const access = wallet.data?.agentAccess;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-6 py-8 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <ScreenHeading title="Wallet" sub="Credits the agent pays with. You approve it once." />
        <Button type="button" onClick={() => setToppingUp(true)}>
          <Plus /> Add credits
        </Button>
      </div>

      {/* The card runs the revoke itself: prepare on the API, approve with the email signer, record. */}
      <WalletCard
        onAddCredits={() => setToppingUp(true)}
        onRevokeAccess={() => void wallet.refetch()}
      />

      <Block
        title="Agent access"
        description="The agent's signer on your wallet. Approved once with an email code. Revoke it from the card above any time."
      >
        {wallet.loading && !wallet.data ? (
          <Skeleton className="h-14 rounded-xl" />
        ) : wallet.notFound ? (
          <p className="text-sm text-muted-foreground">
            Your wallet is being created. Agent access comes after.
          </p>
        ) : access ? (
          <div className="flex items-center gap-3 rounded-2xl bg-card px-4 py-3 ring-1 ring-foreground/10">
            <Badge
              variant={
                access.status === "active"
                  ? "success"
                  : access.status === "pending"
                    ? "warning"
                    : "muted"
              }
            >
              {access.status}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {access.status === "active"
                ? `Active${access.grantedAt ? ` since ${formatDate(access.grantedAt)}` : ""}`
                : access.status === "pending"
                  ? "Waiting for your approval"
                  : access.status === "revoked"
                    ? `Revoked${access.revokedAt ? ` on ${formatDate(access.revokedAt)}` : ""}`
                    : "Not granted. The agent asks when it needs it."}
            </span>
            {access.signerLocator ? (
              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                {access.signerLocator.slice(0, 18)}…
              </span>
            ) : null}
          </div>
        ) : null}
      </Block>

      <Block
        title="Payments"
        description="Everything the agent did with the wallet: x402 calls, MPP calls, transfers, transactions and top-ups."
      >
        {payments.error && !payments.data ? (
          <p className="text-sm text-destructive">{errorMessage(payments.error)}</p>
        ) : (
          <PaymentsTable payments={payments.data} loading={payments.loading && !payments.data} />
        )}
      </Block>

      <Block title="Activity" description="Credits moving in and out of the wallet on chain.">
        {activity.error && !activity.data ? (
          <p className="text-sm text-destructive">{errorMessage(activity.error)}</p>
        ) : (
          <ActivityList items={activity.data} loading={activity.loading && !activity.data} />
        )}
      </Block>

      <Block
        title="Saved cards"
        description="The cards that top the wallet up. The number stays in Crossmint's vault."
      >
        <SavedCards cards={paymentMethods} onAdd={() => setAdding(true)} />
      </Block>

      <AddCardDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={async () => {
          await paymentMethods.refetch();
          setAdding(false);
        }}
      />

      <Dialog open={toppingUp} onOpenChange={setToppingUp}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="sr-only">Add credits</DialogTitle>
          {toppingUp ? (
            <TopUp
              variant="plain"
              onClose={() => setToppingUp(false)}
              onDone={() => {
                void wallet.refetch();
                void payments.refetch();
                setToppingUp(false);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Block({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium tracking-[-0.02em] text-foreground">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SavedCards({
  cards,
  onAdd,
}: {
  cards: ReturnType<typeof usePaymentMethods>;
  onAdd: () => void;
}) {
  const { data, loading, error, remove } = cards;
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 rounded-xl" />
        <Skeleton className="h-14 rounded-xl" />
      </div>
    );
  }
  if (error && !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;

  return (
    <div className="flex flex-col gap-3">
      {data?.length ? (
        <ul className="flex flex-col rounded-2xl bg-card ring-1 ring-foreground/10">
          {data.map((pm) => (
            <li
              key={pm.paymentMethodId}
              className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-0"
            >
              <span className="flex w-9 shrink-0 justify-center">
                <CardMark paymentMethod={pm} size="md" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{paymentMethodLabel(pm)}</span>
                {pm.card?.expiration ? (
                  <span className="block text-xs text-muted-foreground">
                    Expires {pm.card.expiration.month}/{pm.card.expiration.year}
                  </span>
                ) : null}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy === pm.paymentMethodId}
                onClick={async () => {
                  if (!window.confirm(`Remove ${paymentMethodLabel(pm)}?`)) return;
                  setBusy(pm.paymentMethodId);
                  try {
                    await remove(pm.paymentMethodId);
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                {busy === pm.paymentMethodId ? <Spinner className="size-3.5" /> : "Remove"}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No cards yet. Add one to top the wallet up.</p>
      )}
      <Button type="button" variant="secondary" className="self-start" onClick={onAdd}>
        <Plus /> Add card
      </Button>
    </div>
  );
}
