"use client";

import * as React from "react";
import type { WalletView } from "@m2m-payments/core";
import { formatCredits } from "@m2m-payments/core";
import { Check, Copy, ExternalLink, Plus } from "lucide-react";
import { errorMessage } from "../api/client.js";
import { useWallet } from "../hooks/use-wallet.js";
import { formatDate, shortAddress } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { useM2mPayments, useSdkWallet } from "../provider.js";
import { Problem } from "./approve-agent-access.js";
import { Button } from "./primitives/button.js";
import { Skeleton } from "./primitives/skeleton.js";
import { Spinner } from "./primitives/spinner.js";

export interface WalletCardProps {
  /** The Add credits button. Without it the button is not shown. */
  onAddCredits?: () => void;
  /**
   * Called after agent access is revoked. The card runs the revoke itself:
   * `revokeAccess` on the API, the email signer approves it (Crossmint shows
   * its code prompt), then `revokedAccess`.
   */
  onRevokeAccess?: (wallet: WalletView) => void;
  /** Tighter spacing and a smaller figure, for a narrow column. */
  compact?: boolean;
  className?: string;
}

/**
 * The wallet at a glance: the balance as the big blue figure, the address
 * with a copy button and an explorer link, Add credits, and the agent access
 * line with Revoke. While the SDK creates the wallet it says so.
 */
export function WalletCard({
  onAddCredits,
  onRevokeAccess,
  compact = false,
  className,
}: WalletCardProps) {
  const { api, userEmail } = useM2mPayments();
  const sdk = useSdkWallet();
  const wallet = useWallet();
  const view = wallet.data;

  const [copied, setCopied] = React.useState(false);
  const [revoking, setRevoking] = React.useState(false);
  const [revokeError, setRevokeError] = React.useState<unknown>(undefined);

  async function copy() {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(view.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the full address is in the title attribute.
    }
  }

  async function revoke() {
    if (!view) return;
    setRevokeError(undefined);
    setRevoking(true);
    try {
      const sdkWallet = sdk.wallet;
      if (!sdkWallet)
        throw new Error(
          "Your wallet is not ready in this browser yet. Wait a moment and try again.",
        );
      const prepared = await api.revokeAccess();
      if (prepared.signatureId || prepared.transactionId) {
        const email = userEmail ?? (await api.me().catch(() => undefined))?.email;
        await sdkWallet.useSigner({ type: "email", email });
        if (prepared.signatureId) await sdkWallet.approve({ signatureId: prepared.signatureId });
        else if (prepared.transactionId)
          await sdkWallet.approve({ transactionId: prepared.transactionId });
      }
      const next = await api.revokedAccess();
      wallet.setData(next);
      onRevokeAccess?.(next);
    } catch (e) {
      setRevokeError(e);
    } finally {
      setRevoking(false);
    }
  }

  const panel = cn(
    "flex flex-col rounded-2xl bg-card text-card-foreground ring-1 ring-foreground/10",
    compact ? "gap-4 p-5" : "gap-6 p-6",
    className,
  );

  if (wallet.loading && !view && !wallet.notFound) {
    return (
      <div className={panel}>
        <Skeleton className="h-4 w-16" />
        <Skeleton className={compact ? "h-10 w-2/3" : "h-14 w-2/3"} />
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    );
  }

  if (wallet.notFound) {
    return (
      <div className={panel}>
        <p className="text-sm font-medium text-foreground">Credits</p>
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-4 text-sm">
          <Spinner className="text-primary" />
          <span>Creating your wallet</span>
        </div>
        <p className="text-sm text-muted-foreground">
          Your wallet is made in this browser on your first sign-in, with your email as the recovery
          method.
        </p>
      </div>
    );
  }

  if (!view) {
    return (
      <div className={panel}>
        <Problem title="We could not load your wallet" message={errorMessage(wallet.error)} />
        <Button
          type="button"
          variant="secondary"
          size="xl"
          className="w-full"
          onClick={() => void wallet.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }

  const access = view.agentAccess;

  return (
    <div className={panel}>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-foreground">Credits</p>
        <p
          className={cn(
            "font-display font-semibold tracking-tight text-primary tabular-nums",
            compact ? "text-4xl" : "text-5xl",
          )}
        >
          {formatCredits(view.balance.value, { symbol: false })}
        </p>
        <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <span className="font-mono tabular-nums" title={view.address}>
            {shortAddress(view.address)}
          </span>
          <button
            type="button"
            onClick={() => void copy()}
            aria-label={copied ? "Copied" : "Copy address"}
            className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          </button>
          <a
            href={view.explorerUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in the block explorer"
            className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </div>
      </div>

      {onAddCredits ? (
        <Button
          type="button"
          size={compact ? "lg" : "xl"}
          className="w-full"
          onClick={onAddCredits}
        >
          <Plus data-icon="inline-start" />
          Add credits
        </Button>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm">
            <span className="text-muted-foreground">Agent access: </span>
            <span className="font-medium">
              {access.status === "active"
                ? `active${access.grantedAt ? ` since ${formatDate(access.grantedAt)}` : ""}`
                : access.status === "pending"
                  ? "pending"
                  : "Not granted"}
            </span>
          </p>
          {access.status === "active" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={revoking}
              onClick={() => void revoke()}
            >
              {revoking ? <Spinner /> : null}
              Revoke
            </Button>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {access.status === "active"
            ? "The agent pays from this wallet in the background."
            : access.status === "pending"
              ? "Waiting for your approval."
              : "The agent asks when it needs it. You approve once with an email code."}
          {access.status === "pending" && access.approvalUrl ? (
            <>
              {" "}
              <a
                href={access.approvalUrl}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Review the request
              </a>
            </>
          ) : null}
        </p>
        {revoking ? (
          <div className="flex items-center gap-3 rounded-2xl bg-muted p-3 text-sm">
            <Spinner className="text-primary" />
            <span>Confirming with your email code</span>
          </div>
        ) : null}
        {revokeError ? (
          <Problem title="Revoking did not work" message={errorMessage(revokeError)} />
        ) : null}
      </div>
    </div>
  );
}
