"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import type { PaymentMethod } from "@m2m-payments/core";
import { X } from "lucide-react";
import { useAmountField } from "../../hooks/use-amount-field.js";
import { paymentMethodLabel } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { CardMark } from "../card-mark.js";
import { Button } from "../primitives/button.js";
import { Skeleton } from "../primitives/skeleton.js";
import { AmountDisplay } from "./amount-display.js";
import { NumberKeypad } from "./number-keypad.js";

/** The most credits one top-up can buy. */
export const TOP_UP_MAX = 1000;

export interface TopUpAmountProps {
  amount: string;
  onAmountChange: (amount: string) => void;
  heading: string;
  sub?: string;
  /** Keypad portal target. Null on the server and when there is no frame. */
  container: HTMLElement | null;
  /** False while another step shows, so the keypad and the native keyboard stay down. */
  enabled: boolean;
  method: PaymentMethod | undefined;
  methodsLoading: boolean;
  error?: string;
  /** Focus the field when the screen shows. Default true. */
  autoFocus?: boolean;
  onChangeMethod: () => void;
  onPreview: () => void;
  onClose?: () => void;
  /** With a request behind the top-up, a quiet way to say no. */
  onDecline?: () => void;
  declining?: boolean;
}

/**
 * Step one of the top-up: the big figure, the keypad, the card row and
 * Preview. Ported from the onramp sample app's pay screen and re-worded for
 * credits. The keypad portals to `container` so it can rise from the bottom
 * of the phone screen; without a frame it sits under the button.
 */
export function TopUpAmount({
  amount,
  onAmountChange,
  heading,
  sub,
  container,
  enabled,
  method,
  methodsLoading,
  error,
  autoFocus = true,
  onChangeMethod,
  onPreview,
  onClose,
  onDecline,
  declining = false,
}: TopUpAmountProps) {
  const field = useAmountField({ amount, onAmountChange, container, enabled });
  const { keypadRef, isTouch, keypadOpen, keypadHeight, activate, shake, applyKey } = field;

  // Focus after the entrance, or the keypad parks over the previous screen.
  const activateRef = React.useRef(activate);
  activateRef.current = activate;
  React.useEffect(() => {
    if (!enabled || !autoFocus) return;
    const t = setTimeout(() => activateRef.current(), 350);
    return () => clearTimeout(t);
  }, [enabled, autoFocus]);

  const total = Number.parseFloat(amount) || 0;
  const overMax = total > TOP_UP_MAX;
  const portaled = Boolean(container) && !isTouch;

  const keypad = (
    <div
      ref={keypadRef}
      className={cn(
        portaled
          ? "absolute inset-x-0 bottom-0 z-40 transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          : "mt-4 -mx-6 rounded-2xl",
        portaled && (keypadOpen ? "translate-y-0" : "pointer-events-none translate-y-full"),
        !portaled && !keypadOpen && "hidden",
      )}
      aria-hidden={!keypadOpen}
    >
      <NumberKeypad onKey={applyKey} />
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2">
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mb-3 flex size-9 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-strong"
          >
            <X className="size-4.5" />
          </button>
        ) : null}
        <h1 className="text-[28px] leading-[1.2] font-medium tracking-[-0.02em] text-balance text-foreground">
          {heading}
        </h1>
        {sub ? <p className="text-base text-muted-foreground">{sub}</p> : null}
      </div>

      <div className="pt-8">
        <AmountDisplay amount={amount} field={field} />
        <p className={cn("mt-2 text-sm", overMax ? "text-destructive" : "text-muted-foreground")}>
          {overMax
            ? `The most you can add at once is $${TOP_UP_MAX.toLocaleString("en-US")}`
            : "credits to receive · no ID check"}
        </p>
      </div>

      <div className="min-h-6 flex-1" />

      {/* Rides above the keypad on a transform so the motion stays smooth. */}
      <div
        className="transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] will-change-transform"
        style={{ transform: portaled && keypadOpen ? `translateY(-${keypadHeight}px)` : undefined }}
      >
        <div className="flex items-center justify-between gap-3 py-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            {methodsLoading && !method ? (
              <Skeleton className="h-5 w-40" />
            ) : (
              <>
                {method ? <CardMark paymentMethod={method} /> : null}
                <span className="truncate">
                  {method ? `Pay with ${paymentMethodLabel(method)}` : "Pay with card"}
                </span>
              </>
            )}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-lg"
            onClick={onChangeMethod}
          >
            {method ? "Change" : "Select"}
          </Button>
        </div>
        {error ? <p className="mb-2 text-center text-xs text-destructive">{error}</p> : null}
        <Button
          type="button"
          size="xl"
          className="mt-2 w-full"
          disabled={!method}
          // An invalid amount shakes instead of disabling the button.
          onClick={() => (total <= 0 || overMax ? shake() : onPreview())}
        >
          {method ? "Preview" : "Select a payment method"}
        </Button>
        {onDecline ? (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            className="mt-2 w-full text-muted-foreground"
            disabled={declining}
            onClick={onDecline}
          >
            Not now
          </Button>
        ) : null}
        {!portaled ? keypad : null}
      </div>

      {portaled && container ? createPortal(keypad, container) : null}
    </div>
  );
}
