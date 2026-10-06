"use client";

import * as React from "react";
import type { PaymentMethod, TopUpView } from "@m2m-payments/core";
import { formatCredits } from "@m2m-payments/core";
import { ArrowLeft, Lock } from "lucide-react";
import { paymentMethodLabel } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { CardMark } from "../card-mark.js";
import { Button } from "../primitives/button.js";
import { Checkbox } from "../primitives/checkbox.js";
import { Spinner } from "../primitives/spinner.js";

const TOS_URL = "https://www.crossmint.com/legal/terms-of-service";
const PRIVACY_URL = "https://www.crossmint.com/legal/privacy-policy";

// The entrance cascade. Quote-derived values are skeletons until the order exists.
const DELAY = { headline: 40, breakdown: 120, consent: 200, cta: 260 };
const enter = (delay: number) => ({ animationDelay: `${delay}ms` });

export interface TopUpPreviewProps {
  /** Credits asked for, raw. Shown while the quote is on its way. */
  amount: string;
  /** The order, once created. Undefined while creating. */
  view: TopUpView | undefined;
  method: PaymentMethod | undefined;
  busy: boolean;
  onBack: () => void;
  onPay: () => void;
}

/**
 * Step two of the top-up: the quote. Ported from the onramp sample app's
 * order preview, in the exact-out cut: the headline is the credits received,
 * the charge floats under it.
 */
export function TopUpPreview({ amount, view, method, busy, onBack, onPay }: TopUpPreviewProps) {
  const [termsAccepted, setTermsAccepted] = React.useState(false);
  const quote = view?.quote;
  const receive = quote
    ? formatCredits(quote.receive.value, { symbol: false })
    : formatCredits(amount || "0", { symbol: false });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative flex items-center justify-center pb-2">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          aria-label="Back"
          className="absolute left-0 flex size-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-strong disabled:pointer-events-none disabled:opacity-40"
        >
          <ArrowLeft className="size-4.5" />
        </button>
        <h1 className="text-base font-medium">Order preview</h1>
      </div>

      <div className="enter-up pt-6" style={enter(DELAY.headline)}>
        <div className="flex items-end gap-2">
          <span className="font-display text-6xl leading-none font-semibold tracking-tight tabular-nums text-foreground">
            +{receive}
          </span>
          <span className="mb-1 text-2xl font-semibold text-muted-foreground">credits</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {quote ? `You'll be charged $${quote.total}` : <Skeleton className="w-40" />}
        </p>
      </div>

      <dl
        className="enter-up mt-6 rounded-2xl border border-border px-5"
        style={enter(DELAY.breakdown)}
      >
        <Row label="You'll get" strong>
          {quote ? (
            `${formatCredits(quote.receive.value, { symbol: false })} credits`
          ) : (
            <Skeleton className="w-24" />
          )}
        </Row>
        {!quote || quote.unitPrice ? (
          <Row label="Rate">
            {quote ? `$${quote.unitPrice} per credit` : <Skeleton className="w-20" />}
          </Row>
        ) : null}
        <Row label="Fees">{quote ? `$${quote.fees}` : <Skeleton className="w-12" />}</Row>
        <Row label="Pay with">
          {method ? (
            <span className="flex items-center gap-2">
              <CardMark paymentMethod={method} />
              {paymentMethodLabel(method)}
            </span>
          ) : (
            "No card"
          )}
        </Row>
        <Row label="Total" strong>
          {quote ? `$${quote.total}` : <Skeleton className="w-16" />}
        </Row>
      </dl>

      <div className="min-h-6 flex-1" />

      <label
        className="enter-up mb-4 flex items-start gap-3 text-left text-xs text-muted-foreground"
        style={enter(DELAY.consent)}
      >
        <Checkbox
          checked={termsAccepted}
          onCheckedChange={(checked) => setTermsAccepted(checked === true)}
          disabled={busy}
          className="mt-0.5"
        />
        <span>
          By checking this box, you accept{" "}
          <a
            href={TOS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Crossmint&apos;s terms
          </a>{" "}
          and{" "}
          <a
            href={PRIVACY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            privacy policy
          </a>
          .
        </span>
      </label>

      <Button
        type="button"
        size="xl"
        className="enter-up w-full"
        style={enter(DELAY.cta)}
        disabled={busy || !quote || !method || !termsAccepted}
        onClick={onPay}
      >
        {busy || !quote ? (
          <Spinner className="size-5" />
        ) : (
          <>
            <Lock data-icon="inline-start" />
            Pay ${quote.total}
          </>
        )}
      </Button>
    </div>
  );
}

function Skeleton({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-block h-4 animate-pulse rounded bg-muted align-middle", className)}
    />
  );
}

function Row({
  label,
  children,
  strong = false,
}: {
  label: string;
  children: React.ReactNode;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-border/60 py-4 last:border-0">
      <dt
        className={cn(
          "shrink-0 text-sm",
          strong ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right text-sm",
          strong ? "font-semibold tabular-nums" : "font-medium text-foreground",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
