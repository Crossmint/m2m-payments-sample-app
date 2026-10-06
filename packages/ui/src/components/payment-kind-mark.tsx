import * as React from "react";
import type { PaymentKind } from "@m2m-payments/core";
import { CodeXml, CreditCard, Radio, Send, Zap, type LucideIcon } from "lucide-react";
import { paymentKindLabel } from "../lib/format.js";
import { cn } from "../lib/utils.js";

const ICON: Record<PaymentKind, LucideIcon> = {
  x402: Zap,
  mpp: Radio,
  transfer: Send,
  transaction: CodeXml,
  "top-up": CreditCard,
};

export type PaymentKindMarkSize = "sm" | "md";

const SIZE: Record<PaymentKindMarkSize, { box: string; icon: string }> = {
  sm: { box: "size-8", icon: "size-4" },
  md: { box: "size-10", icon: "size-5" },
};

export interface PaymentKindMarkProps {
  kind: PaymentKind;
  /** "sm" for a table row, "md" for a list. Default "sm". */
  size?: PaymentKindMarkSize;
  className?: string;
}

/**
 * One small round mark per payment kind, in the summary-list style: a grey
 * disc with the icon in it. Top-ups take the primary colour, since they are
 * the one kind that adds to the wallet.
 */
export function PaymentKindMark({ kind, size = "sm", className }: PaymentKindMarkProps) {
  const Icon = ICON[kind] ?? Zap;
  const s = SIZE[size];
  return (
    <span
      role="img"
      aria-label={paymentKindLabel(kind)}
      title={paymentKindLabel(kind)}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        kind === "top-up" ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
        s.box,
        className,
      )}
    >
      <Icon aria-hidden className={s.icon} />
    </span>
  );
}
