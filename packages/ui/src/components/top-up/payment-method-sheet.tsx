"use client";

import * as React from "react";
import type { PaymentMethod } from "@m2m-payments/core";
import { ArrowLeft, Check, ChevronRight, CreditCard, X } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { useIsMobile } from "../../hooks/use-media-query.js";
import { paymentMethodLabel } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { CardMark } from "../card-mark.js";
import { Spinner } from "../primitives/spinner.js";
import { SaveCard } from "../save-card.js";

export interface PaymentMethodSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Portal target. With one, the sheet docks to the bottom of that element (the phone screen). */
  container: HTMLElement | null;
  paymentMethods: PaymentMethod[] | undefined;
  loading: boolean;
  selectedId: string | undefined;
  onSelect: (paymentMethodId: string) => void;
  /** A new card was saved through the sheet. It is selected too. */
  onAdded?: (paymentMethod: PaymentMethod) => void;
}

/**
 * The saved cards, one row each, and "Add a new card" under them, in the
 * onramp sample app's drawer style. Tapping a card selects it and closes the
 * sheet. Adding a card slides to Crossmint's card form on the same surface.
 *
 * Inside a frame (`container`) it is a bottom sheet in that frame. On a phone
 * without one it is a bottom sheet on the viewport, and on a wide screen a
 * centered dialog. All three are one Radix dialog, so focus and Escape
 * behave the same.
 */
export function PaymentMethodSheet({
  open,
  onOpenChange,
  container,
  paymentMethods,
  loading,
  selectedId,
  onSelect,
  onAdded,
}: PaymentMethodSheetProps) {
  const isMobile = useIsMobile();
  const [view, setView] = React.useState<"list" | "form">("list");
  const cards = React.useMemo(
    () => (paymentMethods ?? []).filter((pm) => pm.type === "card" || pm.card),
    [paymentMethods],
  );

  // Back to the list after the close, not during it.
  React.useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setView("list"), 300);
    return () => clearTimeout(t);
  }, [open]);

  const framed = Boolean(container);
  const asSheet = framed || isMobile;

  return (
    <SheetPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <SheetPrimitive.Portal container={container ?? undefined}>
        <SheetPrimitive.Overlay
          className={cn(
            "z-50 bg-black/10 backdrop-blur-xs",
            framed ? "absolute inset-0" : "fixed inset-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
        />
        <SheetPrimitive.Content
          className={cn(
            "z-50 flex flex-col overflow-hidden bg-popover text-popover-foreground outline-none duration-300",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            asSheet
              ? cn(
                  "inset-x-0 bottom-0 max-h-[92%] rounded-t-[2rem] shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.15)]",
                  framed ? "absolute" : "fixed max-h-[92svh]",
                  "data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom",
                )
              : cn(
                  "fixed top-1/2 left-1/2 w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-[0_24px_48px_-12px_rgba(0,0,0,0.18)] ring-1 ring-foreground/10 sm:max-w-md",
                  "data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
                ),
          )}
        >
          {view === "list" ? (
            <div className="flex min-h-0 flex-col">
              <div className="flex items-start justify-between p-6 pb-2">
                <div className="flex flex-col gap-1.5">
                  <SheetPrimitive.Title className="text-[28px] leading-[1.2] font-medium tracking-[-0.02em]">
                    Pay with
                  </SheetPrimitive.Title>
                  <SheetPrimitive.Description className="text-sm text-muted-foreground">
                    A saved card, or a new one.
                  </SheetPrimitive.Description>
                </div>
                <SheetPrimitive.Close className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-strong focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none">
                  <X className="size-4" />
                  <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
                {loading && !paymentMethods ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Spinner /> Loading saved cards
                  </div>
                ) : cards.length ? (
                  <>
                    <p className="pt-2 pb-1 text-sm text-muted-foreground">Saved cards</p>
                    <ul>
                      {cards.map((pm) => (
                        <MethodRow
                          key={pm.paymentMethodId}
                          icon={<CardMark paymentMethod={pm} size="md" />}
                          label={paymentMethodLabel(pm)}
                          detail={expiryDetail(pm)}
                          selected={pm.paymentMethodId === selectedId}
                          onClick={() => {
                            onSelect(pm.paymentMethodId);
                            onOpenChange(false);
                          }}
                        />
                      ))}
                    </ul>
                  </>
                ) : null}

                <p
                  className={cn(
                    "pb-1 text-sm text-muted-foreground",
                    cards.length ? "pt-5" : "pt-2",
                  )}
                >
                  {cards.length ? "Other" : "No saved cards yet"}
                </p>
                <ul>
                  <MethodRow
                    icon={
                      <span className="flex w-16 justify-center">
                        <CreditCard className="size-5" />
                      </span>
                    }
                    label="Add a new card"
                    detail="Debit or credit card"
                    onClick={() => setView("form")}
                  />
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-3 p-6 pb-2">
                <button
                  type="button"
                  onClick={() => setView("list")}
                  aria-label="Back"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-strong"
                >
                  <ArrowLeft className="size-4.5" />
                </button>
                <div className="flex flex-col">
                  <SheetPrimitive.Title className="text-base font-medium">
                    Add a card
                  </SheetPrimitive.Title>
                  <SheetPrimitive.Description className="text-xs text-muted-foreground">
                    Your card goes straight to Crossmint's vault. This site never sees the number.
                  </SheetPrimitive.Description>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2">
                <SaveCard
                  showResult={false}
                  onSaved={({ paymentMethod }) => {
                    onAdded?.(paymentMethod);
                    onSelect(paymentMethod.paymentMethodId);
                    onOpenChange(false);
                  }}
                />
              </div>
            </div>
          )}
        </SheetPrimitive.Content>
      </SheetPrimitive.Portal>
    </SheetPrimitive.Root>
  );
}

function expiryDetail(pm: PaymentMethod): string | undefined {
  const exp = pm.card?.expiration;
  if (!exp?.month || !exp?.year) return undefined;
  return `Expires ${String(exp.month).padStart(2, "0")}/${String(exp.year).slice(-2)}`;
}

function MethodRow({
  icon,
  label,
  detail,
  selected = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <li className="border-b border-border/60 last:border-0">
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-3 py-3.5 text-left"
      >
        <span className="flex shrink-0 justify-center">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{label}</span>
          {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
        </span>
        {selected ? (
          <Check aria-label="Selected" className="size-4 text-primary" strokeWidth={3} />
        ) : (
          <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
        )}
      </button>
    </li>
  );
}
