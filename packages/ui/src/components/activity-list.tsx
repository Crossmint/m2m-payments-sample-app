"use client";

import * as React from "react";
import type { ActivityItem } from "@m2m-payments/core";
import { formatCredits } from "@m2m-payments/core";
import { ArrowDownLeft, ArrowUpRight, ExternalLink } from "lucide-react";
import { formatDateTime, formatRelativeTime, shortAddress } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { EmptyState } from "./mascot.js";
import { Skeleton } from "./primitives/skeleton.js";

export interface ActivityListProps {
  items: ActivityItem[] | undefined;
  loading?: boolean;
  className?: string;
}

/**
 * On-chain transfers in and out of the wallet, from `useActivity`, in the
 * summary-list style: one bordered block, a hairline between rows, a round
 * grey mark leading each one. Credits in are the primary colour.
 */
export function ActivityList({ items, loading = false, className }: ActivityListProps) {
  if (loading && !items) {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (!items?.length) {
    return (
      <EmptyState
        className={className}
        title="No activity yet"
        description="Credits moving in and out of your wallet show here."
      />
    );
  }

  return (
    <ul className={cn("flex flex-col rounded-2xl border border-border px-5", className)}>
      {items.map((item) => {
        const incoming = item.direction === "in";
        return (
          <li
            key={item.id}
            className="flex items-center gap-4 border-b border-border/60 py-4 last:border-0"
          >
            <span
              aria-hidden
              className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-full",
                incoming ? "bg-primary/10 text-primary" : "bg-muted text-foreground",
              )}
            >
              {incoming ? (
                <ArrowDownLeft className="size-5" />
              ) : (
                <ArrowUpRight className="size-5" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {incoming ? "Received" : "Sent"}
                {item.counterparty ? (
                  <span className="text-muted-foreground">
                    {" "}
                    {incoming ? "from" : "to"}{" "}
                    <span className="font-mono tabular-nums" title={item.counterparty}>
                      {shortAddress(item.counterparty)}
                    </span>
                  </span>
                ) : null}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span title={formatDateTime(item.completedAt)}>
                  {formatRelativeTime(item.completedAt)}
                </span>
                {item.explorerUrl ? (
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="Open in the block explorer"
                    className="flex size-5 items-center justify-center rounded-full transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                ) : null}
              </p>
            </div>
            <p
              className={cn(
                "shrink-0 text-sm font-semibold tabular-nums",
                incoming && "text-primary",
              )}
            >
              {incoming ? "+" : "−"}
              {formatCredits(item.amount.value, { symbol: false })}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
