import { tool } from "ai";
import { describeTool, paramDoc, type ToolNameFor } from "@m2m-payments/core";
import { z } from "zod";
import { CHAT_REQUESTER } from "./config";
import { M2mPaymentsToolError, type M2mPaymentsClient } from "./api-client";

/**
 * M2M Payments tools for the chat model. Every tool runs in process against
 * the M2M Payments handlers with the user's own session JWT, so the model can
 * do exactly what the user could do from the wallet page, and nothing more.
 * The agent never holds a key: the server signs with the signer the user
 * approved.
 *
 * Human in the loop, twice, the same way each time:
 * 1. `request_wallet_access` and `request_top_up` have `execute`: they store
 *    the request on the server and return `{ requestId, approvalUrl }`. The
 *    request is what the /approve and /top-up pages also read, so a reload
 *    never loses it.
 * 2. `await_wallet_access` and `await_top_up` have no `execute`. The AI SDK
 *    streams the tool call to the client and stops. The message renderer sees
 *    the part in state `input-available` and renders `<ApproveAgentAccess>`
 *    or `<TopUp>` in its place. When the user answers, the client calls
 *    `addToolOutput` with the outcome, and
 *    `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls`
 *    resubmits so the model continues.
 *
 * The outcome lives in the tool part, so history shows what happened, and the
 * model reads a real tool result instead of a synthetic user message.
 *
 * Descriptions: the shared facts come from `TOOL_DOCS` in core (the MCP
 * server uses the same ones); this file adds the chat-specific sentence,
 * such as approving inline instead of through a link.
 */

/** The tools the chat offers. Adding or removing one here must match `TOOL_DOCS` surfaces. */
type ChatTools = Record<ToolNameFor<"chat">, unknown>;

const DECIMAL = /^\d+(\.\d{1,6})?$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const amountSchema = z.string().regex(DECIMAL, 'Decimal string in credits, like "10" or "0.05"');

const amountOut = z.object({ value: z.string(), currency: z.string() });

export const accessOutcomeSchema = z.object({
  status: z.enum(["active", "denied", "expired", "failed"]),
  signerLocator: z.string().optional(),
});
export type AccessOutcomeOutput = z.infer<typeof accessOutcomeSchema>;

export const topUpOutcomeSchema = z.object({
  status: z.enum(["completed", "denied", "expired", "failed"]),
  received: amountOut.optional(),
  orderId: z.string().optional(),
});
export type TopUpOutcomeOutput = z.infer<typeof topUpOutcomeSchema>;

/** What a failed tool call returns. The model reads `next` to know what to do. */
export interface ToolErrorResult {
  error: string;
  code: string;
  details?: Record<string, unknown>;
  requestId?: string;
  approvalUrl?: string;
  balance?: unknown;
  required?: unknown;
  next?: string;
}

/**
 * Turn an M2M Payments API error into a plain tool result the model can read
 * and act on. The two errors the flow turns on carry their next step, so the
 * model does not have to guess: `access_required` names the pending request
 * the server already created, and `insufficient_funds` names the shortfall.
 */
async function guard<T>(fn: () => Promise<T>): Promise<T | ToolErrorResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof M2mPaymentsToolError) {
      const out: ToolErrorResult = { error: e.message, code: e.code, details: e.details };
      const d = e.details ?? {};
      if (e.code === "access_required" || e.code === "access_pending") {
        if (typeof d.requestId === "string") out.requestId = d.requestId;
        if (typeof d.approvalUrl === "string") out.approvalUrl = d.approvalUrl;
        out.next = out.requestId
          ? "Call await_wallet_access with this requestId now."
          : "Call request_wallet_access, then await_wallet_access with its requestId.";
      } else if (e.code === "insufficient_funds") {
        out.balance = d.balance;
        out.required = d.required;
        out.next = "Call request_top_up for at least the shortfall, then await_top_up.";
      } else if (e.code === "wallet_not_found") {
        out.next = "Tell the user to open the app once so their wallet is created, then try again.";
      }
      return out;
    }
    return { error: e instanceof Error ? e.message : "Unknown error", code: "internal" };
  }
}

const protocolInput = (name: "pay_x402" | "pay_mpp") =>
  z.object({
    url: z.string().url().describe(paramDoc(name, "url")),
    method: z.string().optional().describe(paramDoc(name, "method")),
    headers: z.record(z.string(), z.string()).optional().describe(paramDoc(name, "headers")),
    body: z.string().max(64_000).optional().describe(paramDoc(name, "body")),
    maxAmount: amountSchema.optional().describe(paramDoc(name, "maxAmount")),
    memo: z.string().max(200).optional().describe(paramDoc(name, "memo")),
  });

export function createChatTools(api: M2mPaymentsClient) {
  return {
    get_wallet: tool({
      description: describeTool("get_wallet"),
      inputSchema: z.object({}),
      execute: () =>
        guard(async () => {
          const w = await api.getWallet();
          return {
            address: w.address,
            chain: w.chain,
            balance: w.balance,
            agentAccess: w.agentAccess,
            explorerUrl: w.explorerUrl,
          };
        }),
    }),

    get_balance: tool({
      description: describeTool("get_balance"),
      inputSchema: z.object({}),
      execute: () =>
        guard(async () => {
          const b = await api.getBalance();
          return { balance: b.balance, address: b.address };
        }),
    }),

    request_wallet_access: tool({
      description: describeTool(
        "request_wallet_access",
        "Immediately after, call await_wallet_access with that requestId so the user can approve in the chat.",
      ),
      inputSchema: z.object({
        reason: z.string().min(1).max(200).describe(paramDoc("request_wallet_access", "reason")),
      }),
      execute: ({ reason }) =>
        guard(async () => {
          const req = await api.createAccessRequest({ reason, requester: CHAT_REQUESTER });
          return {
            requestId: req.id,
            approvalUrl: req.approvalUrl,
            status: req.status,
            reason: req.reason,
            signerLocator: req.signerLocator,
            requestExpiresAt: req.requestExpiresAt,
            next:
              req.status === "active"
                ? "Access is already active. Go ahead and pay."
                : "Call await_wallet_access with this requestId now. Do not write text first.",
          };
        }),
    }),

    // Client-side tool: no `execute`. The chat UI supplies the output after the user answers.
    await_wallet_access: tool({
      description: describeTool("await_wallet_access"),
      inputSchema: z.object({
        requestId: z.string().min(1).describe(paramDoc("await_wallet_access", "requestId")),
      }),
      outputSchema: accessOutcomeSchema,
    }),

    request_top_up: tool({
      description: describeTool(
        "request_top_up",
        "Immediately after, call await_top_up with that requestId so the user can pay in the chat.",
      ),
      inputSchema: z.object({
        amount: amountSchema.describe(paramDoc("request_top_up", "amount")),
        reason: z
          .string()
          .min(1)
          .max(200)
          .optional()
          .describe(paramDoc("request_top_up", "reason")),
      }),
      execute: ({ amount, reason }) =>
        guard(async () => {
          const req = await api.createTopUpRequest({ amount, reason, requester: CHAT_REQUESTER });
          return {
            requestId: req.id,
            approvalUrl: req.approvalUrl,
            status: req.status,
            amount: req.amount,
            reason: req.reason,
            requestExpiresAt: req.requestExpiresAt,
            next: "Call await_top_up with this requestId now. Do not write text first.",
          };
        }),
    }),

    // Client-side tool: no `execute`. The chat UI supplies the output once the top-up ends.
    await_top_up: tool({
      description: describeTool("await_top_up"),
      inputSchema: z.object({
        requestId: z.string().min(1).describe(paramDoc("await_top_up", "requestId")),
      }),
      outputSchema: topUpOutcomeSchema,
    }),

    pay_x402: tool({
      description: describeTool(
        "pay_x402",
        "In this chat, access_required and insufficient_funds results name the next tool to call; call it at once.",
      ),
      inputSchema: protocolInput("pay_x402"),
      execute: (input) => guard(() => api.payX402({ ...input, requester: CHAT_REQUESTER })),
    }),

    pay_mpp: tool({
      description: describeTool(
        "pay_mpp",
        "In this chat, access_required and insufficient_funds results name the next tool to call; call it at once.",
      ),
      inputSchema: protocolInput("pay_mpp"),
      execute: (input) => guard(() => api.payMpp({ ...input, requester: CHAT_REQUESTER })),
    }),

    transfer: tool({
      description: describeTool("transfer"),
      inputSchema: z.object({
        to: z
          .string()
          .regex(ADDRESS, "An EVM address, 0x-prefixed")
          .describe(paramDoc("transfer", "to")),
        amount: amountSchema.describe(paramDoc("transfer", "amount")),
        memo: z.string().max(200).optional().describe(paramDoc("transfer", "memo")),
      }),
      execute: (input) => guard(() => api.transfer({ ...input, requester: CHAT_REQUESTER })),
    }),

    send_transaction: tool({
      description: describeTool("send_transaction"),
      inputSchema: z.object({
        to: z
          .string()
          .regex(ADDRESS, "An EVM address, 0x-prefixed")
          .describe(paramDoc("send_transaction", "to")),
        data: z
          .string()
          .regex(/^0x([0-9a-fA-F]{2})*$/, "Calldata, 0x-prefixed hex")
          .optional()
          .describe(paramDoc("send_transaction", "data")),
        value: z
          .string()
          .regex(/^\d+$/, "Wei, decimal string")
          .optional()
          .describe(paramDoc("send_transaction", "value")),
        memo: z.string().max(200).optional().describe(paramDoc("send_transaction", "memo")),
      }),
      execute: (input) => guard(() => api.sendTransaction({ ...input, requester: CHAT_REQUESTER })),
    }),

    list_payments: tool({
      description: describeTool("list_payments"),
      inputSchema: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(100)
          .optional()
          .describe(paramDoc("list_payments", "limit")),
        kind: z
          .enum(["x402", "mpp", "transfer", "transaction", "top-up"])
          .optional()
          .describe(paramDoc("list_payments", "kind")),
      }),
      execute: ({ limit, kind }) =>
        guard(async () => ({
          payments: (await api.listPayments({ limit: limit ?? 50, kind })).map((p) => ({
            id: p.id,
            kind: p.kind,
            status: p.status,
            amount: p.amount,
            counterparty: p.counterparty,
            description: p.description,
            hash: p.hash,
            explorerUrl: p.explorerUrl,
            requester: p.requester,
            failureReason: p.failureReason,
            createdAt: p.createdAt,
          })),
        })),
    }),
  } satisfies ChatTools;
}

export type ChatToolSet = ReturnType<typeof createChatTools>;
