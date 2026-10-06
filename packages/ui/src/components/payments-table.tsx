"use client";

import * as React from "react";
import type { Payment } from "@m2m-payments/core";
import { ExternalLink } from "lucide-react";
import {
  formatDateTime,
  formatRelativeTime,
  formatSignedCredits,
  paymentKindLabel,
  shortAddress,
} from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { EmptyState } from "./mascot.js";
import { PaymentKindMark } from "./payment-kind-mark.js";
import { Badge } from "./primitives/badge.js";
import { Skeleton } from "./primitives/skeleton.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./primitives/table.js";

export interface PaymentsTableProps {
  payments: Payment[] | undefined;
  loading?: boolean;
  /**
   * Keep the narrow column set whatever the viewport is, for a table inside a
   * narrow container on a wide screen: the phone frame. The status folds into
   * the first column and the time goes.
   */
  compact?: boolean;
  /** Opens a row. With it, rows become buttons; without it they are plain. */
  onSelect?: (payment: Payment) => void;
  className?: string;
  emptyAction?: React.ReactNode;
}

/**
 * The ledger, one row per payment: a kind mark, who was paid and what for,
 * the amount in credits (signed: top-ups plus, everything else minus), the
 * status, and when. Newest first, as the API sends them.
 */
export function PaymentsTable({
  payments,
  loading = false,
  compact = false,
  onSelect,
  className,
  emptyAction,
}: PaymentsTableProps) {
  if (loading && !payments) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-10" />
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  if (!payments?.length) {
    return (
      <EmptyState
        className={className}
        title="No payments yet"
        description="When an agent pays from your wallet, it shows here."
        action={emptyAction}
      />
    );
  }

  return (
    <Table containerClassName={className}>
      <TableHeader>
        <TableRow>
          <TableHead>Payment</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          <TableHead className={cn(compact && "hidden")}>Status</TableHead>
          <TableHead className={cn("text-right", compact && "hidden")}>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {payments.map((p) => {
          const amount = formatSignedCredits(p.amount, p.kind);
          const counterparty = counterpartyLabel(p);
          return (
            <TableRow
              key={p.id}
              {...(onSelect
                ? {
                    role: "button" as const,
                    tabIndex: 0,
                    "aria-label": `Open ${paymentKindLabel(p.kind)} payment`,
                    onClick: () => onSelect(p),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key !== "Enter" && e.key !== " ") return;
                      e.preventDefault();
                      onSelect(p);
                    },
                  }
                : {})}
              className={cn(
                onSelect &&
                  "cursor-pointer outline-none focus-visible:bg-accent focus-visible:inset-ring-2 focus-visible:inset-ring-ring/60",
              )}
            >
              <TableCell className="max-w-[12rem] lg:max-w-[18rem]">
                <span className="flex items-center gap-3">
                  <PaymentKindMark kind={p.kind} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="block truncate font-medium">{counterparty}</span>
                      {compact ? <StatusBadge payment={p} /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.description ?? paymentKindLabel(p.kind)}
                      {compact ? ` · ${formatRelativeTime(p.createdAt)}` : ""}
                    </span>
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right whitespace-nowrap tabular-nums">
                {amount ? (
                  <span className={cn("font-semibold", p.kind === "top-up" && "text-primary")}>
                    {amount}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Unknown</span>
                )}
              </TableCell>
              <TableCell className={cn(compact && "hidden")}>
                <StatusBadge payment={p} />
              </TableCell>
              <TableCell
                className={cn(
                  "text-right whitespace-nowrap text-muted-foreground",
                  compact && "hidden",
                )}
                onClick={(e) => e.stopPropagation()}
              >
                <span className="inline-flex items-center gap-1.5">
                  <span title={formatDateTime(p.createdAt)}>{formatRelativeTime(p.createdAt)}</span>
                  {p.explorerUrl ? (
                    <a
                      href={p.explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="Open the transaction in the block explorer"
                      className="flex size-6 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <ExternalLink className="size-3.5" />
                    </a>
                  ) : null}
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function StatusBadge({ payment }: { payment: Payment }) {
  return payment.status === "succeeded" ? (
    <Badge variant="success">Paid</Badge>
  ) : (
    <Badge variant="destructive" title={payment.failureReason}>
      Failed
    </Badge>
  );
}

/** The host for x402 and MPP, the short address for transfers and transactions, the card for top-ups. */
function counterpartyLabel(p: Payment): string {
  if (!p.counterparty) return paymentKindLabel(p.kind);
  if (/^0x[0-9a-fA-F]{40}$/.test(p.counterparty)) return shortAddress(p.counterparty);
  return p.counterparty;
}
