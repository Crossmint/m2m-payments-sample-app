/*
 * One source for what each M2M Payments tool does. The MCP server and the
 * chat agent both build their tool descriptions from here: the shared facts
 * live in `summary` and `params`, and each surface appends one short addendum
 * about how a link reaches the user (shown as a URL on MCP, rendered inline
 * in the chat).
 *
 * When you change a tool, also touch:
 * - packages/mcp/src/tools.ts and apps/web/lib/chat/tools.ts (the addenda and the zod shapes)
 * - apps/web/lib/chat/prompt.ts (the flow the chat model follows)
 * - packages/cli/src/commands/* help text, and skills/m2m-payments/SKILL.md (then `pnpm plugin:sync`)
 * - docs/ARCHITECTURE.md section 3.5
 */

export type ToolSurface = "mcp" | "chat";

export interface ToolDoc {
  /** Short human title. */
  title: string;
  /** What the tool does and the rules that hold on every surface. */
  summary: string;
  /** Parameter name → description. Surfaces attach these to their own schemas. */
  params: Readonly<Record<string, string>>;
  /** Where the tool is offered. */
  surfaces: readonly ToolSurface[];
}

/** Descriptions shared by several tools' parameters. */
export const PARAM_DOCS = {
  credits: 'Decimal amount in credits, e.g. 10 or "0.05". One credit is one US dollar.',
  url: "The full URL of the paid endpoint.",
  method: "HTTP method. Default GET.",
  headers: "Extra request headers, e.g. content-type.",
  body: "Request body as a string. JSON must be serialized first.",
  maxAmount:
    "Most credits this one call may pay. The call is refused before anything is signed when the endpoint asks for more. Default: the server's limit, usually 1.00.",
  memo: "A short note for the user's activity list: what this payment was for.",
  requester: "Name of the agent shown to the user.",
  address: "An EVM address, 0x-prefixed.",
} as const;

export const TOOL_DOCS = {
  get_wallet: {
    title: "Get the wallet",
    summary:
      "The user's wallet: address, chain, credits balance, and whether this agent has access to it (none, pending, active, revoked). Start here. When the wallet does not exist yet, the user has to open the app once; tell them so.",
    params: {},
    surfaces: ["mcp", "chat"],
  },
  get_balance: {
    title: "Check the balance",
    summary:
      "The wallet's credits balance. Cheap; call it before a payment when you are unsure the wallet can cover it, and after a top-up to confirm the credits landed.",
    params: {},
    surfaces: ["mcp", "chat"],
  },
  request_wallet_access: {
    title: "Ask to use the wallet",
    summary:
      "Ask the user to let this agent pay from their wallet. The user approves once, in the app, with a code sent to their email; after that every payment runs in the background with no prompt. Returns a requestId and status. When access is already active the result says so at once. Call it when a payment answers access_required, or before the first payment of a task.",
    params: {
      reason:
        "What you will pay for, in the user's words, e.g. Research API calls for the market brief. Shown on the approval screen.",
      requester: PARAM_DOCS.requester,
    },
    surfaces: ["mcp", "chat"],
  },
  get_access_request: {
    title: "Check an access request",
    summary:
      "Poll an access request. Status goes pending → approved → active, or denied / expired / failed. Once active, pay.",
    params: { requestId: "The requestId from request_wallet_access." },
    surfaces: ["mcp"],
  },
  await_wallet_access: {
    title: "Wait for wallet access in the chat",
    summary:
      "Wait for the user to approve wallet access right here in the chat. Call it immediately after request_wallet_access returns a pending request, with no text in between. The result carries the final status.",
    params: { requestId: "The requestId from request_wallet_access." },
    surfaces: ["chat"],
  },
  request_top_up: {
    title: "Ask for a top-up",
    summary:
      "Ask the user to add credits to the wallet. They pay by card in the app; no identity check. Returns a requestId and status. Call it when a payment answers insufficient_funds, or when the balance will not cover the task ahead. Ask for what the task needs with a little room, not more.",
    params: {
      amount: `${PARAM_DOCS.credits} How many credits to add.`,
      reason:
        "What the credits are for, e.g. 40 research calls at 0.05 each. Shown on the top-up screen.",
      requester: PARAM_DOCS.requester,
    },
    surfaces: ["mcp", "chat"],
  },
  get_top_up_request: {
    title: "Check a top-up request",
    summary:
      "Poll a top-up request. Status goes pending → paying → completed, or denied / expired / failed. Completed carries the credits received.",
    params: { requestId: "The requestId from request_top_up." },
    surfaces: ["mcp"],
  },
  await_top_up: {
    title: "Wait for a top-up in the chat",
    summary:
      "Wait for the user to pay a top-up right here in the chat. Call it immediately after request_top_up returns a pending request, with no text in between. The result carries the final status and the credits received.",
    params: { requestId: "The requestId from request_top_up." },
    surfaces: ["chat"],
  },
  pay_x402: {
    title: "Pay an x402 endpoint",
    summary:
      "Call an HTTP endpoint that charges with the x402 protocol, paying from the user's wallet in credits. The 402 handshake, the signature and the retry are handled for you; you get the endpoint's response plus what was paid and the settlement. Needs wallet access and enough credits: on access_required show the approval link and wait, on insufficient_funds request a top-up. Never pay more than the task needs.",
    params: {
      url: PARAM_DOCS.url,
      method: PARAM_DOCS.method,
      headers: PARAM_DOCS.headers,
      body: PARAM_DOCS.body,
      maxAmount: PARAM_DOCS.maxAmount,
      memo: PARAM_DOCS.memo,
    },
    surfaces: ["mcp", "chat"],
  },
  pay_mpp: {
    title: "Pay an MPP endpoint",
    summary:
      "Call an HTTP endpoint that charges with the Machine Payments Protocol (MPP), paying from the user's wallet in credits. The challenge, the authorization and the retry are handled for you; you get the endpoint's response plus what was paid. Same rules as pay_x402: access_required means show the approval link, insufficient_funds means request a top-up.",
    params: {
      url: PARAM_DOCS.url,
      method: PARAM_DOCS.method,
      headers: PARAM_DOCS.headers,
      body: PARAM_DOCS.body,
      maxAmount: PARAM_DOCS.maxAmount,
      memo: PARAM_DOCS.memo,
    },
    surfaces: ["mcp", "chat"],
  },
  transfer: {
    title: "Transfer credits",
    summary:
      "Send credits from the user's wallet to another address. Only when the user asked for it, with the exact amount and address they gave. Returns the transaction hash. Cannot be undone.",
    params: {
      to: `${PARAM_DOCS.address} The recipient.`,
      amount: `${PARAM_DOCS.credits} Credits to send.`,
      memo: PARAM_DOCS.memo,
    },
    surfaces: ["mcp", "chat"],
  },
  send_transaction: {
    title: "Send a transaction",
    summary:
      "Send a raw transaction from the user's wallet: a contract call with calldata, or a native transfer. For anything x402, MPP and transfer do not cover. Only when the user asked for it and you know what the calldata does. Returns the transaction hash. Cannot be undone.",
    params: {
      to: `${PARAM_DOCS.address} The contract or recipient.`,
      data: "Calldata, 0x-prefixed hex. Optional.",
      value: "Native value in wei, decimal string. Default 0.",
      memo: PARAM_DOCS.memo,
    },
    surfaces: ["mcp", "chat"],
  },
  list_payments: {
    title: "List payments",
    summary:
      "The wallet's activity, newest first: every x402 call, MPP call, transfer, transaction and top-up, with amount, counterparty, status and hash. Use it to report what a task spent.",
    params: {
      limit: "How many rows. Default 50.",
      kind: "Only one kind: x402, mpp, transfer, transaction, top-up.",
    },
    surfaces: ["mcp", "chat"],
  },
} as const satisfies Record<string, ToolDoc>;

export type M2mPaymentsToolName = keyof typeof TOOL_DOCS;

/** The tool names offered on one surface, as a type. */
export type ToolNameFor<S extends ToolSurface> = {
  [K in M2mPaymentsToolName]: S extends (typeof TOOL_DOCS)[K]["surfaces"][number] ? K : never;
}[M2mPaymentsToolName];

export const M2M_PAYMENTS_TOOL_NAMES = Object.keys(TOOL_DOCS) as M2mPaymentsToolName[];

export function toolNamesFor<S extends ToolSurface>(surface: S): ToolNameFor<S>[] {
  return M2M_PAYMENTS_TOOL_NAMES.filter((name) =>
    (TOOL_DOCS[name].surfaces as readonly ToolSurface[]).includes(surface),
  ) as ToolNameFor<S>[];
}

/** The shared summary, plus one surface-specific sentence when given. */
export function describeTool(name: M2mPaymentsToolName, addendum?: string): string {
  const summary = TOOL_DOCS[name].summary;
  return addendum ? `${summary} ${addendum}` : summary;
}

/** A parameter's shared description. Typed to the tool's own parameter names. */
export function paramDoc<N extends M2mPaymentsToolName>(
  name: N,
  param: keyof (typeof TOOL_DOCS)[N]["params"] & string,
): string {
  return (TOOL_DOCS[name].params as Record<string, string>)[param] ?? param;
}
