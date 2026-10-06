import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  describeTool,
  formatAmount,
  paramDoc,
  toDecimalString,
  TOOL_DOCS,
  toolNamesFor,
} from "@m2m-payments/core";
import type {
  AccessRequest,
  Amount,
  Payment,
  ProtocolPaymentResult,
  ToolNameFor,
  TopUpRequest,
  WalletView,
} from "@m2m-payments/core";
import { M2mPaymentsApiError } from "./api.js";
import type { M2mPaymentsApi } from "./api.js";
import * as z from "zod";

export interface M2mPaymentsToolsContext {
  api: M2mPaymentsApi;
  /** Name shown to the user on the approval and top-up screens, e.g. "Claude". Default "Agent". */
  requester?: string;
}

/**
 * The tools this server offers. Names, summaries and parameter docs come
 * from `TOOL_DOCS` in core, shared with the chat agent; this file adds the
 * MCP-specific sentence to each description (how a link reaches the user)
 * and the zod shapes.
 */
export type M2mPaymentsToolName = ToolNameFor<"mcp">;
export const M2M_PAYMENTS_TOOL_NAMES: readonly M2mPaymentsToolName[] = toolNamesFor("mcp");

/** How much of an endpoint's body the text summary carries. `structuredContent` has it all. */
const BODY_EXCERPT_CHARS = 2000;

// ---------------------------------------------------------------------------
// Shared schemas
// ---------------------------------------------------------------------------

const creditsSchema = z.union([z.number(), z.string()]);
const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "an EVM address, 0x-prefixed");
const paymentKindSchema = z.enum(["x402", "mpp", "transfer", "transaction", "top-up"]);

const title = (name: M2mPaymentsToolName) => TOOL_DOCS[name].title;

/** The zod shape both protocol payment tools share. */
function protocolPaymentShape(name: "pay_x402" | "pay_mpp") {
  return {
    url: z.url().describe(paramDoc(name, "url")),
    method: z.string().optional().describe(paramDoc(name, "method")),
    headers: z.record(z.string(), z.string()).optional().describe(paramDoc(name, "headers")),
    body: z.string().optional().describe(paramDoc(name, "body")),
    maxAmount: creditsSchema.optional().describe(paramDoc(name, "maxAmount")),
    memo: z.string().optional().describe(paramDoc(name, "memo")),
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerM2mPaymentsTools(server: McpServer, ctx: M2mPaymentsToolsContext): void {
  const { api } = ctx;
  const requesterOf = (given?: string) => given ?? ctx.requester;

  server.registerTool(
    "get_wallet",
    {
      title: title("get_wallet"),
      description: describeTool(
        "get_wallet",
        "When agentAccess is pending the result carries the approval URL: show it to the user.",
      ),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const wallet = await api.getWallet();
      return ok(describeWallet(wallet), { wallet });
    }),
  );

  server.registerTool(
    "get_balance",
    {
      title: title("get_balance"),
      description: describeTool("get_balance"),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async () => {
      const balance = await api.getBalance();
      return ok(
        `Balance: ${formatAmount(balance.balance.value, balance.balance.currency)} on ${balance.address} (${balance.token.chain}).`,
        { ...balance },
      );
    }),
  );

  server.registerTool(
    "request_wallet_access",
    {
      title: title("request_wallet_access"),
      description: describeTool(
        "request_wallet_access",
        "Returns an approval URL. Show the URL to the user verbatim, then poll get_access_request until status is active.",
      ),
      inputSchema: {
        reason: z.string().optional().describe(paramDoc("request_wallet_access", "reason")),
        requester: z
          .string()
          .optional()
          .describe(
            `${paramDoc("request_wallet_access", "requester")} Defaults to the server's label.`,
          ),
      },
      annotations: { openWorldHint: true },
    },
    guard(async (args) => {
      const req = await api.createAccessRequest({
        reason: args.reason,
        requester: requesterOf(args.requester),
      });
      return ok(describeAccessRequest(req), accessStructured(req));
    }),
  );

  server.registerTool(
    "get_access_request",
    {
      title: title("get_access_request"),
      description: describeTool(
        "get_access_request",
        "While pending, show the approval URL again if the user asks for it.",
      ),
      inputSchema: {
        requestId: z.string().min(1).describe(paramDoc("get_access_request", "requestId")),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ requestId }) => {
      const req = await api.getAccessRequest(requestId);
      return ok(describeAccessRequest(req), accessStructured(req));
    }),
  );

  server.registerTool(
    "request_top_up",
    {
      title: title("request_top_up"),
      description: describeTool(
        "request_top_up",
        "Returns a top-up URL. Show the URL to the user verbatim, then poll get_top_up_request until status is completed.",
      ),
      inputSchema: {
        amount: creditsSchema.describe(paramDoc("request_top_up", "amount")),
        reason: z.string().optional().describe(paramDoc("request_top_up", "reason")),
        requester: z
          .string()
          .optional()
          .describe(`${paramDoc("request_top_up", "requester")} Defaults to the server's label.`),
      },
      annotations: { openWorldHint: true },
    },
    guard(async (args) => {
      const req = await api.createTopUpRequest({
        amount: toDecimalString(args.amount),
        reason: args.reason,
        requester: requesterOf(args.requester),
      });
      return ok(describeTopUpRequest(req), topUpStructured(req));
    }),
  );

  server.registerTool(
    "get_top_up_request",
    {
      title: title("get_top_up_request"),
      description: describeTool(
        "get_top_up_request",
        "While pending or paying, show the top-up URL again if the user asks for it.",
      ),
      inputSchema: {
        requestId: z.string().min(1).describe(paramDoc("get_top_up_request", "requestId")),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ requestId }) => {
      const req = await api.getTopUpRequest(requestId);
      return ok(describeTopUpRequest(req), topUpStructured(req));
    }),
  );

  server.registerTool(
    "pay_x402",
    {
      title: title("pay_x402"),
      description: describeTool(
        "pay_x402",
        "An access_required error carries the approval URL to show the user; poll get_access_request with its requestId, then call again.",
      ),
      inputSchema: protocolPaymentShape("pay_x402"),
      annotations: { openWorldHint: true },
    },
    guard(async (args) => {
      const result = await api.payX402({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
        maxAmount: args.maxAmount === undefined ? undefined : toDecimalString(args.maxAmount),
        memo: args.memo,
        requester: ctx.requester,
      });
      return ok(describePaymentResult(result), { ...result });
    }),
  );

  server.registerTool(
    "pay_mpp",
    {
      title: title("pay_mpp"),
      description: describeTool(
        "pay_mpp",
        "An access_required error carries the approval URL to show the user; poll get_access_request with its requestId, then call again.",
      ),
      inputSchema: protocolPaymentShape("pay_mpp"),
      annotations: { openWorldHint: true },
    },
    guard(async (args) => {
      const result = await api.payMpp({
        url: args.url,
        method: args.method,
        headers: args.headers,
        body: args.body,
        maxAmount: args.maxAmount === undefined ? undefined : toDecimalString(args.maxAmount),
        memo: args.memo,
        requester: ctx.requester,
      });
      return ok(describePaymentResult(result), { ...result });
    }),
  );

  server.registerTool(
    "transfer",
    {
      title: title("transfer"),
      description: describeTool(
        "transfer",
        "Report the hash and the explorer link to the user when it is done.",
      ),
      inputSchema: {
        to: addressSchema.describe(paramDoc("transfer", "to")),
        amount: creditsSchema.describe(paramDoc("transfer", "amount")),
        memo: z.string().optional().describe(paramDoc("transfer", "memo")),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    guard(async (args) => {
      const result = await api.transfer({
        to: args.to,
        amount: toDecimalString(args.amount),
        memo: args.memo,
        requester: ctx.requester,
      });
      const amount = result.payment.amount;
      const text = [
        `Sent ${amount ? formatAmount(amount.value, amount.currency) : "credits"} to ${args.to}.`,
        `Transaction ${result.hash}`,
        `Explorer: ${result.explorerUrl}`,
      ].join("\n");
      return ok(text, { ...result });
    }),
  );

  server.registerTool(
    "send_transaction",
    {
      title: title("send_transaction"),
      description: describeTool(
        "send_transaction",
        "Report the hash and the explorer link to the user when it is done.",
      ),
      inputSchema: {
        to: addressSchema.describe(paramDoc("send_transaction", "to")),
        data: z
          .string()
          .regex(/^0x([0-9a-fA-F]{2})*$/, "0x-prefixed hex")
          .optional()
          .describe(paramDoc("send_transaction", "data")),
        value: z
          .string()
          .regex(/^\d+$/, "wei as a decimal string")
          .optional()
          .describe(paramDoc("send_transaction", "value")),
        memo: z.string().optional().describe(paramDoc("send_transaction", "memo")),
      },
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    guard(async (args) => {
      const result = await api.sendTransaction({
        to: args.to,
        data: args.data,
        value: args.value,
        memo: args.memo,
        requester: ctx.requester,
      });
      const text = [
        `Transaction sent to ${args.to}${args.value && args.value !== "0" ? ` with ${args.value} wei` : ""}.`,
        `Transaction ${result.hash}`,
        `Explorer: ${result.explorerUrl}`,
      ].join("\n");
      return ok(text, { ...result });
    }),
  );

  server.registerTool(
    "list_payments",
    {
      title: title("list_payments"),
      description: describeTool("list_payments"),
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .optional()
          .describe(paramDoc("list_payments", "limit")),
        kind: paymentKindSchema.optional().describe(paramDoc("list_payments", "kind")),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    guard(async ({ limit, kind }) => {
      const payments = await api.listPayments({ limit: limit ?? 50, kind });
      const text = payments.length ? payments.map(describePayment).join("\n") : "No payments yet.";
      return ok(text, { payments });
    }),
  );
}

// ---------------------------------------------------------------------------
// Result helpers
// ---------------------------------------------------------------------------

function ok(text: string, structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text }], structuredContent };
}

/**
 * API failures as `isError` results. The two errors that need the user are
 * turned into instructions the model can act on: the approval link for
 * `access_required`, the top-up amount for `insufficient_funds`.
 */
function fail(err: unknown): CallToolResult {
  if (err instanceof M2mPaymentsApiError) {
    return {
      isError: true,
      content: [{ type: "text", text: describeApiError(err) }],
      structuredContent: {
        error: { code: err.code, message: err.message, status: err.status, details: err.details },
      },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text", text: `Error: ${message}` }],
    structuredContent: { error: { message } },
  };
}

export function describeApiError(err: M2mPaymentsApiError): string {
  const head = `M2M Payments error ${err.code}: ${err.message}`;
  const access = err.accessDetails;
  if (access) {
    const lines = [head];
    if (access.approvalUrl) {
      lines.push(
        `The user has to allow this agent to use their wallet. Show this link to the user verbatim and ask them to approve: ${access.approvalUrl}`,
      );
    } else {
      lines.push("Call request_wallet_access to get an approval link for the user.");
    }
    if (access.requestId) {
      lines.push(
        `Then poll get_access_request with requestId "${access.requestId}" every few seconds until status is "active", and call this tool again. Stop on "denied", "expired" or "failed".`,
      );
    }
    return lines.join("\n");
  }
  const funds = err.fundsDetails;
  if (funds) {
    const balance = funds.balance
      ? formatAmount(funds.balance.value, funds.balance.currency)
      : "unknown";
    const required = funds.required
      ? formatAmount(funds.required.value, funds.required.currency)
      : undefined;
    return [
      head,
      `The wallet holds ${balance}${required ? ` and this needs ${required}` : ""}.`,
      required
        ? `Call request_top_up with an amount of about ${funds.required!.value} credits (a little room is fine, not more), show the top-up URL to the user, and poll get_top_up_request until status is "completed". Then call this tool again.`
        : "Call request_top_up for what the task needs, show the top-up URL to the user, and poll get_top_up_request until it is completed.",
    ].join("\n");
  }
  switch (err.code) {
    case "unauthorized":
      return `${head}. The user must connect (log in) again.`;
    case "wallet_not_found":
      return `${head}. The user has to open the app once so the wallet is created in their browser. Then call get_wallet again.`;
    case "invalid_request": {
      const required = isAmount((err.details as { required?: unknown } | undefined)?.required)
        ? (err.details as { required: Amount }).required
        : undefined;
      return required
        ? `${head}. The endpoint asks for ${formatAmount(required.value, required.currency)}, above maxAmount for this call. Raise maxAmount only if the user agrees.`
        : `${head}.`;
    }
    default:
      return `${head}.`;
  }
}

function isAmount(value: unknown): value is Amount {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Amount).value === "string" &&
    typeof (value as Amount).currency === "string"
  );
}

/** Wrap a tool body so API failures become `isError` results instead of protocol errors. */
function guard<A extends unknown[]>(
  fn: (...args: A) => Promise<CallToolResult>,
): (...args: A) => Promise<CallToolResult> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      return fail(err);
    }
  };
}

function accessStructured(req: AccessRequest): Record<string, unknown> {
  return {
    requestId: req.id,
    status: req.status,
    approvalUrl: req.approvalUrl,
    signerLocator: req.signerLocator,
    requestExpiresAt: req.requestExpiresAt,
    request: req,
  };
}

function topUpStructured(req: TopUpRequest): Record<string, unknown> {
  return {
    requestId: req.id,
    status: req.status,
    approvalUrl: req.approvalUrl,
    amount: req.amount,
    received: req.received,
    requestExpiresAt: req.requestExpiresAt,
    request: req,
  };
}

// ---------------------------------------------------------------------------
// Text summaries
// ---------------------------------------------------------------------------

export function describeWallet(wallet: WalletView): string {
  const access = wallet.agentAccess;
  const lines = [
    `Wallet ${wallet.address} on ${wallet.chain}. Balance ${formatAmount(wallet.balance.value, wallet.balance.currency)}.`,
    `Agent access: ${access.status}${access.signerLocator ? ` (signer ${access.signerLocator})` : ""}.`,
  ];
  switch (access.status) {
    case "none":
      lines.push("This agent cannot pay yet. Call request_wallet_access before the first payment.");
      break;
    case "pending":
      lines.push(
        `Waiting for the user to approve${access.approvalUrl ? `. Show this link to the user verbatim: ${access.approvalUrl}` : "."}`,
      );
      if (access.requestId)
        lines.push(
          `Poll get_access_request with requestId "${access.requestId}" until status is "active".`,
        );
      break;
    case "active":
      lines.push("Payments run in the background with no prompt. Pay with pay_x402 or pay_mpp.");
      break;
    case "revoked":
      lines.push(
        `The user revoked this agent's access${access.revokedAt ? ` on ${access.revokedAt}` : ""}. Ask the user before calling request_wallet_access again.`,
      );
      break;
  }
  lines.push(`Explorer: ${wallet.explorerUrl}`);
  return lines.join("\n");
}

export function describeAccessRequest(req: AccessRequest): string {
  const head = `Access request ${req.id}: status ${req.status}.${req.reason ? ` Reason: ${req.reason}.` : ""}`;
  switch (req.status) {
    case "pending":
      return [
        head,
        `Approval needed. Show this link to the user verbatim and ask them to approve: ${req.approvalUrl}`,
        `The user has until ${req.requestExpiresAt} to answer. They confirm with a code sent to their email.`,
        `Poll get_access_request with requestId "${req.id}" every few seconds until status is "active". Stop on "denied", "expired" or "failed".`,
      ].join("\n");
    case "approved":
      return `${head}\nThe user approved. The signer is being confirmed on the wallet. Poll again in a few seconds.`;
    case "active":
      return `${head}\nThis agent can pay from the wallet${req.signerLocator ? ` as ${req.signerLocator}` : ""}. Use pay_x402 or pay_mpp.`;
    case "denied":
      return `${head}\nThe user denied the request. Do not request again without asking the user.`;
    case "expired":
      return `${head}\nThe request expired before the user answered. Ask the user, then call request_wallet_access again.`;
    case "failed":
      return `${head}\nFailed${req.failureReason ? `: ${req.failureReason}` : ""}.`;
    default:
      return head;
  }
}

export function describeTopUpRequest(req: TopUpRequest): string {
  const amount = formatAmount(req.amount.value, req.amount.currency);
  const head = `Top-up request ${req.id}: status ${req.status}. ${amount} asked for${req.reason ? `: ${req.reason}` : ""}.`;
  switch (req.status) {
    case "pending":
      return [
        head,
        `The user pays by card in the app, with no identity check. Show this link to the user verbatim: ${req.approvalUrl}`,
        `The user has until ${req.requestExpiresAt} to answer.`,
        `Poll get_top_up_request with requestId "${req.id}" every few seconds until status is "completed". Stop on "denied", "expired" or "failed".`,
      ].join("\n");
    case "paying":
      return `${head}\nThe user is paying. Poll again in a few seconds.`;
    case "completed":
      return `${head}\nCompleted. ${req.received ? formatAmount(req.received.value, req.received.currency) : amount} landed in the wallet. Retry the payment.`;
    case "denied":
      return `${head}\nThe user declined. Do not request again without asking the user.`;
    case "expired":
      return `${head}\nThe request expired before the user answered. Ask the user, then call request_top_up again.`;
    case "failed":
      return `${head}\nFailed${req.failureReason ? `: ${req.failureReason}` : ""}.`;
    default:
      return head;
  }
}

export function describePaymentResult(result: ProtocolPaymentResult): string {
  const { payment, response } = result;
  const protocol = payment.kind === "mpp" ? "MPP" : "x402";
  const lines: string[] = [];
  if (result.paid) {
    const amount = result.amount ?? payment.amount;
    lines.push(
      `Paid ${amount ? formatAmount(amount.value, amount.currency) : "credits"} to ${payment.counterparty ?? "the endpoint"} over ${protocol}. Payment ${payment.id}, ${payment.status}.`,
    );
    const s = result.settlement;
    if (s?.transaction) {
      lines.push(`Settlement transaction ${s.transaction}${s.network ? ` on ${s.network}` : ""}.`);
    } else if (s?.reference) {
      lines.push(`Settlement reference ${s.reference}.`);
    }
    if (payment.explorerUrl) lines.push(`Explorer: ${payment.explorerUrl}`);
  } else {
    lines.push(
      `The endpoint answered without asking for payment. Nothing was charged. Payment ${payment.id}.`,
    );
  }
  const contentType = response.headers["content-type"] ?? response.headers["Content-Type"];
  lines.push(`Response status ${response.status}${contentType ? ` (${contentType})` : ""}.`);
  const excerpt =
    response.body.length > BODY_EXCERPT_CHARS
      ? `${response.body.slice(0, BODY_EXCERPT_CHARS)}...`
      : response.body;
  const cut = response.truncated || excerpt.length < response.body.length;
  lines.push(
    `Body${cut ? " (excerpt; the full text is in structuredContent.response.body)" : ""}:`,
  );
  lines.push(excerpt || "(empty)");
  return lines.join("\n");
}

export function describePayment(p: Payment): string {
  const amount = p.amount ? formatAmount(p.amount.value, p.amount.currency) : "amount unknown";
  const parts = [`- ${p.id} ${p.kind} ${p.status}: ${amount}`];
  if (p.counterparty) parts.push(`to ${p.counterparty}`);
  if (p.description) parts.push(`"${p.description}"`);
  if (p.hash) parts.push(`tx ${p.hash}`);
  if (p.failureReason) parts.push(`failed: ${p.failureReason}`);
  parts.push(`at ${p.createdAt}`);
  return parts.join(" ");
}
