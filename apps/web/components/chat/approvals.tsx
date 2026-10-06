"use client";

import { useCallback } from "react";
import {
  ApproveAgentAccess,
  Badge,
  TopUp,
  type AccessOutcome,
  type TopUpOutcome,
} from "@m2m-payments/ui";
import { AGENT_NAME } from "@/components/brand";
import type { AccessOutcomeOutput, TopUpOutcomeOutput } from "@/lib/chat/tools";
import { accessLabel, toAccessOutcome, toTopUpOutcome, topUpLabel } from "./parts";

/*
 * The two inline screens of the desktop chat. The model called
 * `await_wallet_access({ requestId })` or `await_top_up({ requestId })` and
 * the stream stopped. These render the app's own `<ApproveAgentAccess>` or
 * `<TopUp>` in the tool's slot. Once the request reaches a final state,
 * `onDone` hands the outcome back as the tool output and the chat resubmits
 * itself.
 */

export function WalletAccessApproval({
  toolCallId,
  requestId,
  output,
  onOutcome,
}: {
  toolCallId: string;
  requestId: string;
  /** Set once the user answered. Then the card shows the outcome, not the screen. */
  output?: AccessOutcomeOutput;
  onOutcome: (toolCallId: string, outcome: AccessOutcomeOutput) => void;
}) {
  const handleDone = useCallback(
    (o: AccessOutcome) => onOutcome(toolCallId, toAccessOutcome(o)),
    [onOutcome, toolCallId],
  );

  if (output) return <AccessResult outcome={output} />;

  return (
    <div className="w-full max-w-lg">
      <ApproveAgentAccess
        requestId={requestId}
        variant="card"
        agentName={AGENT_NAME}
        onDone={handleDone}
        className="max-w-none"
      />
    </div>
  );
}

export function TopUpApproval({
  toolCallId,
  requestId,
  output,
  onOutcome,
}: {
  toolCallId: string;
  requestId: string;
  output?: TopUpOutcomeOutput;
  onOutcome: (toolCallId: string, outcome: TopUpOutcomeOutput) => void;
}) {
  const handleDone = useCallback(
    (o: TopUpOutcome) => onOutcome(toolCallId, toTopUpOutcome(o)),
    [onOutcome, toolCallId],
  );

  if (output) return <TopUpResult outcome={output} />;

  return (
    <div className="w-full max-w-lg">
      <TopUp requestId={requestId} variant="card" onDone={handleDone} className="max-w-none" />
    </div>
  );
}

const ROW =
  "flex w-full max-w-lg items-center gap-3 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10";

/** What the user decided about wallet access, as one quiet row. */
export function AccessResult({
  outcome,
  className,
}: {
  outcome: AccessOutcomeOutput;
  className?: string;
}) {
  return (
    <div className={className ?? ROW}>
      <Badge
        variant={
          outcome.status === "active"
            ? "success"
            : outcome.status === "denied"
              ? "destructive"
              : "muted"
        }
      >
        {outcome.status}
      </Badge>
      <span className="min-w-0 flex-1 truncate">{accessLabel(outcome)}</span>
      {outcome.signerLocator ? (
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {outcome.signerLocator.slice(0, 16)}…
        </span>
      ) : null}
    </div>
  );
}

/** How the top-up ended, as one quiet row. */
export function TopUpResult({
  outcome,
  className,
}: {
  outcome: TopUpOutcomeOutput;
  className?: string;
}) {
  return (
    <div className={className ?? ROW}>
      <Badge
        variant={
          outcome.status === "completed"
            ? "success"
            : outcome.status === "denied"
              ? "destructive"
              : "muted"
        }
      >
        {outcome.status}
      </Badge>
      <span className="min-w-0 flex-1 truncate">{topUpLabel(outcome)}</span>
      {outcome.orderId ? (
        <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
          {outcome.orderId.slice(0, 12)}…
        </span>
      ) : null}
    </div>
  );
}
