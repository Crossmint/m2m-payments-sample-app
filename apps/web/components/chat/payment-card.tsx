"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import type { OnchainResult, ProtocolPaymentResult } from "@m2m-payments/core";
import { Badge, cn } from "@m2m-payments/ui";
import {
  formatCreditsShort,
  isToolError,
  paymentKindLabel,
  paymentStatusLine,
  summarizePayment,
  type PaymentSummary,
  type ToolError,
} from "./parts";
import { ToolCard, type ToolState } from "./tool-card";

/**
 * A payment as a card, for the desktop chat: the kind, the credits moved,
 * who was paid, the status and a link to the explorer. A protocol payment
 * also carries the endpoint's answer, folded away until the reader wants it.
 */
export function PaymentResultCard({
  title,
  state,
  input,
  output,
  errorText,
}: {
  title: string;
  state: ToolState;
  input?: unknown;
  output?: ProtocolPaymentResult | OnchainResult | ToolError;
  errorText?: string;
}) {
  const failed = output && isToolError(output) ? output : undefined;
  const summary = output && !isToolError(output) ? summarizePayment(output) : undefined;

  return (
    <ToolCard
      title={title}
      state={state}
      input={input}
      output={output}
      errorText={errorText ?? failed?.error}
      summary={summary ? paymentStatusLine(summary) : failed?.next}
    >
      {summary ? <PaymentDetails summary={summary} /> : null}
    </ToolCard>
  );
}

function PaymentDetails({ summary }: { summary: PaymentSummary }) {
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Kind</dt>
        <dd>{paymentKindLabel(summary.kind)}</dd>
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="font-medium">
          {summary.amount
            ? formatCreditsShort(summary.amount)
            : summary.paid === false
              ? "Nothing charged"
              : "Unknown"}
        </dd>
        {summary.counterparty ? (
          <>
            <dt className="text-muted-foreground">To</dt>
            <dd className="truncate font-mono">{summary.counterparty}</dd>
          </>
        ) : null}
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          <Badge variant={summary.status === "succeeded" ? "success" : "destructive"}>
            {summary.status}
          </Badge>
        </dd>
        {summary.hash ? (
          <>
            <dt className="text-muted-foreground">Transaction</dt>
            <dd className="truncate">
              {summary.explorerUrl ? (
                <a
                  href={summary.explorerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary underline-offset-4 hover:underline"
                >
                  {shortHash(summary.hash)}
                  <ArrowUpRight className="size-3" />
                </a>
              ) : (
                <span className="font-mono">{shortHash(summary.hash)}</span>
              )}
            </dd>
          </>
        ) : null}
      </dl>
      {summary.response ? <ResponseExcerpt response={summary.response} /> : null}
    </div>
  );
}

/** The endpoint's answer, folded away. Cut to what fits a card. */
function ResponseExcerpt({ response }: { response: NonNullable<PaymentSummary["response"]> }) {
  const [open, setOpen] = useState(false);
  const text = prettyBody(response.body);
  return (
    <div className="rounded-xl bg-muted/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs"
      >
        <span className="text-muted-foreground">
          Response · HTTP {response.status}
          {response.truncated ? " · cut" : ""}
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <pre className="max-h-56 overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground/90">
          {text}
        </pre>
      ) : null}
    </div>
  );
}

function prettyBody(body: string): string {
  const cut = body.length > 4000 ? `${body.slice(0, 4000)}…` : body;
  try {
    return JSON.stringify(JSON.parse(cut), null, 2);
  } catch {
    return cut;
  }
}

export function shortHash(hash: string): string {
  return hash.length > 14 ? `${hash.slice(0, 8)}…${hash.slice(-6)}` : hash;
}

/**
 * The same payment in the compact style the phone uses: one card with the
 * amount, the counterparty and the status, and the explorer link.
 */
export function PaymentCardCompact({ summary }: { summary: PaymentSummary }) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm font-medium">
            {summary.amount ? formatCreditsShort(summary.amount) : paymentKindLabel(summary.kind)}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {paymentKindLabel(summary.kind)}
            {summary.counterparty ? ` · ${summary.counterparty}` : ""}
          </p>
        </div>
        <Badge variant={summary.status === "succeeded" ? "success" : "destructive"}>
          {summary.status}
        </Badge>
      </div>
      {summary.hash ? (
        summary.explorerUrl ? (
          <a
            href={summary.explorerUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
          >
            View transaction <ArrowUpRight className="size-3" />
          </a>
        ) : (
          <span className="font-mono text-xs text-muted-foreground">{shortHash(summary.hash)}</span>
        )
      ) : null}
    </div>
  );
}
