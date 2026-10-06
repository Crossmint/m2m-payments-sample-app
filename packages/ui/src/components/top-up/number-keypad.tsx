"use client";

import * as React from "react";
import { Delete } from "lucide-react";
import { cn } from "../../lib/utils.js";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const KEY =
  "flex h-13 items-center justify-center rounded-xl text-2xl font-medium text-foreground transition-colors duration-75 active:bg-keyboard-key-active";
const DIGIT_KEY = `${KEY} bg-muted`;

export interface NumberKeypadProps {
  /** A digit, ".", or "back". */
  onKey: (key: string) => void;
  className?: string;
}

/** The phone keypad under the amount, ported from the onramp sample app. */
export function NumberKeypad({ onKey, className }: NumberKeypadProps) {
  return (
    <div
      // Keep the hidden input focused so taps do not dismiss the keypad.
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        "grid grid-cols-3 gap-2 bg-background px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] select-none",
        className,
      )}
    >
      {DIGITS.map((num) => (
        <button key={num} type="button" onClick={() => onKey(num)} className={DIGIT_KEY}>
          {num}
        </button>
      ))}
      <button type="button" onClick={() => onKey(".")} aria-label="Decimal point" className={KEY}>
        .
      </button>
      <button type="button" onClick={() => onKey("0")} className={DIGIT_KEY}>
        0
      </button>
      <button type="button" onClick={() => onKey("back")} aria-label="Delete" className={KEY}>
        <Delete className="size-6" strokeWidth={1.5} />
      </button>
    </div>
  );
}
