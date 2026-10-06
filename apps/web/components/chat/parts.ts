import type { Amount, OnchainResult, Payment, ProtocolPaymentResult } from "@m2m-payments/core";
import type { AccessOutcome, TopUpOutcome } from "@m2m-payments/ui";
import type { AccessOutcomeOutput, TopUpOutcomeOutput } from "@/lib/chat/tools";
import type { ChatMessage, ChatMessagePart } from "@/lib/chat/types";
import { humanizeToolName } from "./tool-card";

/*
 * What the three chat renderers share about a message's parts: how to name a
 * tool call, how to read the request behind an approval or a top-up, how to
 * read a payment result, and how to turn a screen's outcome into the tool
 * output the model reads. Pure functions, so every frame draws the same facts
 * its own way.
 */

/** The `request_wallet_access` result, as the tool returns it. */
export interface AccessRequestSummary {
  requestId: string;
  approvalUrl: string;
  status: string;
  reason?: string;
}

/** The `request_top_up` result, as the tool returns it. */
export interface TopUpRequestSummary {
  requestId: string;
  approvalUrl: string;
  status: string;
  amount: Amount;
  reason?: string;
}

export type ToolError = { error: string; code: string; next?: string };

export function isToolError(value: unknown): value is ToolError {
  return (
    Boolean(value) && typeof value === "object" && typeof (value as ToolError).error === "string"
  );
}

/** The access request an `await_wallet_access` part refers to, found in the same message. */
export function findAccessRequest(
  message: ChatMessage,
  requestId: string,
): AccessRequestSummary | undefined {
  for (const part of message.parts) {
    if (part.type !== "tool-request_wallet_access" || part.state !== "output-available") continue;
    const output = part.output as AccessRequestSummary | ToolError;
    if (!isToolError(output) && output.requestId === requestId) return output;
  }
  return undefined;
}

/** The top-up request an `await_top_up` part refers to, found in the same message. */
export function findTopUpRequest(
  message: ChatMessage,
  requestId: string,
): TopUpRequestSummary | undefined {
  for (const part of message.parts) {
    if (part.type !== "tool-request_top_up" || part.state !== "output-available") continue;
    const output = part.output as TopUpRequestSummary | ToolError;
    if (!isToolError(output) && output.requestId === requestId) return output;
  }
  return undefined;
}

/** The approval screen's outcome, cut down to what the tool promised the model. */
export function toAccessOutcome(o: AccessOutcome): AccessOutcomeOutput {
  return { status: o.status, signerLocator: o.request?.signerLocator };
}

/** The top-up screen's outcome, cut down to what the tool promised the model. */
export function toTopUpOutcome(o: TopUpOutcome): TopUpOutcomeOutput {
  return {
    status: o.status,
    received: o.received ?? o.request?.received,
    orderId: o.orderId ?? o.request?.orderId,
  };
}

export function accessLabel(outcome: AccessOutcomeOutput): string {
  switch (outcome.status) {
    case "active":
      return "Approved. The agent can pay from your wallet.";
    case "denied":
      return "Denied.";
    case "expired":
      return "The request expired.";
    default:
      return "Access could not be set up.";
  }
}

export function topUpLabel(outcome: TopUpOutcomeOutput): string {
  switch (outcome.status) {
    case "completed":
      return outcome.received ? `Added ${formatCreditsShort(outcome.received)}.` : "Credits added.";
    case "denied":
      return "Declined.";
    case "expired":
      return "The request expired.";
    default:
      return "The top-up did not go through.";
  }
}

/** "0.05 credits", with the word rather than the symbol, for chat copy. */
export function formatCreditsShort(amount: Amount | undefined): string {
  if (!amount) return "";
  const n = Number.parseFloat(amount.value);
  if (Number.isNaN(n)) return `${amount.value} credits`;
  const decimals = n !== 0 && Math.abs(n) < 0.01 ? 6 : 2;
  const text = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
  return `${text} credits`;
}

export const PAYMENT_TITLES = {
  "tool-pay_x402": "Paying over x402",
  "tool-pay_mpp": "Paying over MPP",
  "tool-transfer": "Sending credits",
  "tool-send_transaction": "Sending a transaction",
} as const;

export type PaymentPartType = keyof typeof PAYMENT_TITLES;

export function isPaymentPart(
  part: ChatMessagePart,
): part is Extract<ChatMessagePart, { type: PaymentPartType }> {
  return part.type in PAYMENT_TITLES;
}

/** One payment result, whichever tool made it, flattened for a card. */
export interface PaymentSummary {
  payment: Payment;
  kind: Payment["kind"];
  status: Payment["status"];
  amount?: Amount;
  counterparty?: string;
  hash?: string;
  explorerUrl?: string;
  /** Protocol payments only. */
  paid?: boolean;
  response?: ProtocolPaymentResult["response"];
  settlement?: ProtocolPaymentResult["settlement"];
}

/** The payment a tool part carries, once it has one. */
export function paymentOf(part: ChatMessagePart): PaymentSummary | undefined {
  if (!isPaymentPart(part) || part.state !== "output-available") return undefined;
  const output = part.output as ProtocolPaymentResult | OnchainResult | ToolError;
  if (isToolError(output)) return undefined;
  return summarizePayment(output);
}

export function summarizePayment(output: ProtocolPaymentResult | OnchainResult): PaymentSummary {
  const p = output.payment;
  if ("response" in output) {
    return {
      payment: p,
      kind: p.kind,
      status: p.status,
      amount: output.amount ?? p.amount,
      counterparty: p.counterparty,
      hash: output.settlement?.transaction ?? p.hash,
      explorerUrl: p.explorerUrl,
      paid: output.paid,
      response: output.response,
      settlement: output.settlement,
    };
  }
  return {
    payment: p,
    kind: p.kind,
    status: p.status,
    amount: p.amount,
    counterparty: p.counterparty,
    hash: output.hash ?? p.hash,
    explorerUrl: output.explorerUrl ?? p.explorerUrl,
  };
}

/** "x402", "MPP", "Transfer", "Transaction", "Top-up". */
export function paymentKindLabel(kind: Payment["kind"]): string {
  switch (kind) {
    case "x402":
      return "x402";
    case "mpp":
      return "MPP";
    case "transfer":
      return "Transfer";
    case "transaction":
      return "Transaction";
    case "top-up":
      return "Top-up";
    default:
      return String(kind);
  }
}

/** The payment's state in a few words. */
export function paymentStatusLine(s: PaymentSummary): string {
  if (s.status === "failed")
    return `Failed${s.payment.failureReason ? `: ${s.payment.failureReason}` : ""}`;
  if (s.paid === false) return `${s.counterparty ?? "The endpoint"} answered without charging`;
  const amount = s.amount ? formatCreditsShort(s.amount) : "Paid";
  return s.counterparty ? `${amount} to ${s.counterparty}` : amount;
}

/** "Checking your wallet", the line a phone shows while a tool runs. */
export function toolTitle(type: string): string {
  const titles: Record<string, string> = {
    "tool-get_wallet": "Checking your wallet",
    "tool-get_balance": "Checking the balance",
    "tool-request_wallet_access": "Asking to use your wallet",
    "tool-await_wallet_access": "Waiting for your approval",
    "tool-request_top_up": "Asking for a top-up",
    "tool-await_top_up": "Waiting for the top-up",
    "tool-list_payments": "Listing payments",
    ...PAYMENT_TITLES,
  };
  return titles[type] ?? humanizeToolName(type.replace(/^tool-/, ""));
}

/** One line under a finished tool call. */
export function toolSummary(type: string, output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const o = output as Record<string, unknown>;
  if (typeof o.error === "string") return o.error;
  switch (type) {
    case "tool-get_wallet": {
      const balance = o.balance as Amount | undefined;
      const access = o.agentAccess as { status?: string } | undefined;
      const parts = [
        balance ? formatCreditsShort(balance) : undefined,
        access?.status ? `access ${access.status}` : undefined,
      ];
      return parts.filter(Boolean).join(" · ") || undefined;
    }
    case "tool-get_balance": {
      const balance = o.balance as Amount | undefined;
      return balance ? formatCreditsShort(balance) : undefined;
    }
    case "tool-request_wallet_access":
      return typeof o.reason === "string" ? o.reason : undefined;
    case "tool-request_top_up": {
      const amount = o.amount as Amount | undefined;
      return amount
        ? `${formatCreditsShort(amount)}${typeof o.reason === "string" ? ` for ${o.reason}` : ""}`
        : undefined;
    }
    case "tool-list_payments": {
      const n = Array.isArray(o.payments) ? o.payments.length : 0;
      return n === 1 ? "1 payment" : `${n} payments`;
    }
    default:
      return undefined;
  }
}

/** The plain text of a message, for bubbles and copy buttons. */
export function messageText(message: ChatMessage): string {
  return message.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("\n")
    .trim();
}

/** True while the part's tool is still running. */
export function toolBusy(state: string): boolean {
  return (
    state === "input-streaming" || state === "input-available" || state === "approval-requested"
  );
}
