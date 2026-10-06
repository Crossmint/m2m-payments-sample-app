"use client";

import * as React from "react";
import type { AmountField } from "../../hooks/use-amount-field.js";
import { cn } from "../../lib/utils.js";

export interface AmountDisplayProps {
  amount: string;
  field: AmountField;
  className?: string;
}

/**
 * The big editable amount, ported from the onramp sample app. It owns the
 * sr-only input that the keypad and the native keyboard commit through. The
 * `$` slides in once there is a figure; "credits" sits after a zero.
 */
export function AmountDisplay({ amount, field, className }: AmountDisplayProps) {
  const {
    inputRef,
    amountBtnRef,
    setFocused,
    active,
    display,
    charKeys,
    isZero,
    enteringIndices,
    shakeKey,
    activate,
    handleChange,
  } = field;

  const showPrefix = active || !isZero;
  const showSuffix = !active && isZero;

  const caret = (side: "before" | "after") => (
    <span
      aria-hidden
      className={cn(
        "caret-blink inline-block w-[3px] self-center rounded-full bg-primary",
        side === "before" ? "mr-1" : "ml-0.5",
      )}
      style={{ height: "0.85em" }}
    />
  );

  return (
    <div className={className}>
      <button
        ref={amountBtnRef}
        type="button"
        // Keep the input's focus.
        onMouseDown={(e) => e.preventDefault()}
        onClick={activate}
        className="block w-full cursor-text text-left"
      >
        <div
          key={shakeKey}
          className={cn(
            "flex items-baseline font-display text-6xl font-semibold tracking-tight tabular-nums",
            shakeKey > 0 && "amount-shake",
            isZero ? "text-muted-foreground/30" : "text-foreground",
          )}
        >
          <span
            aria-hidden
            className="inline-block self-center overflow-hidden text-4xl leading-none"
            style={{
              maxWidth: showPrefix ? "1.2ch" : "0ch",
              opacity: showPrefix ? 1 : 0,
              marginRight: showPrefix ? "0.15em" : "0",
              transform: showPrefix ? "translateY(0)" : "translateY(6px)",
              transition:
                "max-width 200ms ease-out, opacity 180ms ease-out, margin-right 200ms ease-out, transform 180ms ease-out",
            }}
          >
            $
          </span>

          {active && isZero && caret("before")}

          <span className="inline-flex items-baseline">
            {display.split("").map((char, i) => (
              <span
                key={charKeys[i] ?? i}
                className={cn("inline-block", enteringIndices.has(i) && "digit-enter")}
              >
                {char}
              </span>
            ))}
          </span>

          {active && !isZero && caret("after")}

          <span
            aria-hidden
            className="inline-block overflow-hidden text-2xl"
            style={{
              maxWidth: showSuffix ? "8ch" : "0ch",
              opacity: showSuffix ? 1 : 0,
              marginLeft: showSuffix ? "0.25em" : "0",
              transform: showSuffix ? "scale(1)" : "scale(0)",
              transformOrigin: "left center",
              transition:
                "max-width 200ms ease-in, opacity 180ms ease-in, margin-left 200ms ease-in, transform 200ms ease-in",
            }}
          >
            credits
          </span>
        </div>
      </button>

      <input
        ref={inputRef}
        value={amount}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        // An outside click owns dismissal; a blur would shift layout mid-tap.
        onBlur={() => setFocused(false)}
        inputMode="decimal"
        aria-label="Amount in credits"
        className="sr-only"
      />
    </div>
  );
}
