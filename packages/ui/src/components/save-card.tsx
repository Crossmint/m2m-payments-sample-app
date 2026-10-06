"use client";

import * as React from "react";
import { CrossmintPaymentMethodManagement } from "@crossmint/client-sdk-react-ui";
import type { PaymentMethod } from "@m2m-payments/core";
import { AlertCircle, Check } from "lucide-react";
import { paymentMethodAppearanceFromTheme } from "../lib/appearance.js";
import { paymentMethodLabel } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { useM2mPayments } from "../provider.js";
import { CrossmintScope } from "./crossmint-scope.js";
import { Skeleton } from "./primitives/skeleton.js";
import { Spinner } from "./primitives/spinner.js";

type ManagementProps = React.ComponentProps<typeof CrossmintPaymentMethodManagement>;
export type PaymentMethodAppearance = NonNullable<ManagementProps["appearance"]>;
type SelectedPaymentMethod = Parameters<NonNullable<ManagementProps["onPaymentMethodSelected"]>>[0];

export interface SaveCardResult {
  paymentMethod: PaymentMethod;
}

export interface SaveCardProps {
  /** Fires once Crossmint has saved the card. */
  onSaved?: (result: SaveCardResult) => void;
  onError?: (error: unknown) => void;
  /** Passed to Crossmint. Defaults to the page theme. */
  appearance?: PaymentMethodAppearance;
  /** Show the result summary after saving. Default true. */
  showResult?: boolean;
  className?: string;
}

/**
 * Saves a card with Crossmint's PCI component. The number goes straight to
 * Crossmint's vault and never touches your servers. There is no register step
 * here: a saved card pays top-ups as it is.
 */
export function SaveCard({
  onSaved,
  onError,
  appearance,
  showResult = true,
  className,
}: SaveCardProps) {
  const { jwt, crossmint } = useM2mPayments();
  const [result, setResult] = React.useState<SaveCardResult | undefined>(undefined);
  const [themeAppearance, setThemeAppearance] = React.useState<PaymentMethodAppearance | undefined>(
    undefined,
  );

  React.useEffect(() => {
    if (!appearance) setThemeAppearance(paymentMethodAppearanceFromTheme());
  }, [appearance]);

  const handleSelected = React.useCallback(
    (selected: SelectedPaymentMethod) => {
      try {
        if (selected.type !== "card") return;
        // `display` carries the network artwork. It is not in the SDK's type,
        // so it is read off the object and passed on only when it is there.
        const display = (selected as { display?: PaymentMethod["display"] }).display;
        const paymentMethod: PaymentMethod = {
          paymentMethodId: selected.paymentMethodId,
          type: "card",
          default: selected.default,
          card: {
            brand: selected.card.brand,
            last4: selected.card.last4,
            expiration: selected.card.expiration,
          },
          ...(display ? { display } : {}),
        };
        const out = { paymentMethod };
        setResult(out);
        onSaved?.(out);
      } catch (e) {
        onError?.(e);
      }
    },
    [onSaved, onError],
  );

  if (!crossmint.clientApiKey) {
    return (
      <Problem
        className={className}
        title="Saving cards is not set up"
        message="The Crossmint client API key is missing."
      />
    );
  }

  if (!jwt) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <Spinner /> Waiting for your session
      </div>
    );
  }

  if (result && showResult) {
    return (
      <div
        className={cn(
          "flex flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-foreground/10",
          className,
        )}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="size-4.5" strokeWidth={3} />
          </span>
          <div>
            <p className="text-sm font-medium">Saved {paymentMethodLabel(result.paymentMethod)}</p>
            <p className="text-sm text-muted-foreground">You can pay top-ups with it.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <CrossmintScope
        fallback={<Skeleton className="h-64" />}
        failedFallback={
          <Problem
            title="The card form could not load"
            message="Crossmint's card component did not start. Check the browser console, and that this site's origin is allowed on the Crossmint client key."
          />
        }
      >
        <CrossmintPaymentMethodManagement
          jwt={jwt}
          allowedModes={["new"]}
          allowedPaymentMethodTypes={["card"]}
          appearance={appearance ?? themeAppearance}
          onPaymentMethodSelected={handleSelected}
        />
      </CrossmintScope>
    </div>
  );
}

/** A fault, said plainly: the icon, a title, one line. */
function Problem({
  title,
  message,
  className,
}: {
  title: string;
  message: string;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex items-start gap-3", className)}>
      <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
