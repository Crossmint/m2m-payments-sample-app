import type { Command } from "commander";
import { toDecimalString } from "@m2m-payments/core";
import type { TopUpRequest, TopUpRequestStatus } from "@m2m-payments/core";
import pc from "picocolors";
import type { M2mPaymentsApi } from "../api.js";
import type { CliContext } from "../context.js";
import { CliExit, EXIT, formatDate, kv, statusColor, toJson } from "../output.js";
import { detectRequester } from "../requester.js";
import {
  fmt,
  getApi,
  type JsonOption,
  needsUser,
  parseAmount,
  pollUntil,
  printUserLink,
  waitDeadline,
  type WaitOptions,
  withJson,
  withWait,
} from "./shared.js";

const TERMINAL: ReadonlySet<TopUpRequestStatus> = new Set([
  "completed",
  "denied",
  "expired",
  "failed",
]);

interface RequestOptions extends JsonOption, WaitOptions {
  amount: number;
  reason?: string;
  requester?: string;
}

export function registerTopUpCommands(program: Command, ctx: CliContext): void {
  const topUp = program.command("top-up").description("ask the user to add credits by card");

  withJson(
    withWait(
      topUp
        .command("request")
        .description("ask the user to add credits; prints the top-up URL")
        .requiredOption(
          "--amount <credits>",
          "credits to add, e.g. 10 or 0.50",
          parseAmount("--amount"),
        )
        .option("--reason <text>", "what the credits are for, e.g. 40 research calls at 0.05 each")
        .option("--requester <name>", "who is asking; default is detected from the environment"),
      "pays or declines",
    ),
  ).action(async (opts: RequestOptions) => {
    const api = getApi(ctx);
    let request = await api.createTopUpRequest({
      amount: toDecimalString(opts.amount),
      reason: opts.reason,
      requester: opts.requester ?? detectRequester(ctx.env, ctx.hostname()),
    });
    if (!opts.wait) {
      report(ctx, request, opts.json);
      return;
    }
    if (opts.json) ctx.err(`Top-up URL: ${request.approvalUrl}`);
    else {
      printRequest(ctx, request);
      ctx.out(pc.dim("Waiting for the top-up... (Ctrl-C stops waiting; the request stays open)"));
    }
    request = await waitForRequest(ctx, api, request, opts.timeout);
    report(ctx, request, opts.json, true);
  });

  withJson(
    withWait(
      topUp
        .command("status <requestId>")
        .description("show a top-up request; --wait blocks until it is paid or declined"),
      "pays or declines",
    ),
  ).action(async (requestId: string, opts: JsonOption & WaitOptions) => {
    const api = getApi(ctx);
    let request = await api.getTopUpRequest(requestId);
    if (opts.wait && !TERMINAL.has(request.status)) {
      if (!opts.json) printRequest(ctx, request);
      ctx.err("Waiting for the top-up...");
      request = await waitForRequest(ctx, api, request, opts.timeout);
    }
    report(ctx, request, opts.json, opts.wait);
  });
}

async function waitForRequest(
  ctx: CliContext,
  api: M2mPaymentsApi,
  request: TopUpRequest,
  timeoutS: number | undefined,
): Promise<TopUpRequest> {
  return pollUntil(
    ctx,
    () => api.getTopUpRequest(request.id),
    (r) => TERMINAL.has(r.status),
    {
      initial: request,
      deadline: waitDeadline(ctx, request.requestExpiresAt, timeoutS),
      onTimeout: (last) =>
        needsUser(
          `Still ${last.status}. Ask the user to open ${last.approvalUrl}, then run \`m2m-payments top-up status ${last.id} --wait\`.`,
          "top_up_pending",
        ),
    },
  );
}

function report(ctx: CliContext, r: TopUpRequest, json: boolean | undefined, waited = false): void {
  if (json) ctx.out(toJson(r));
  else if (waited && r.status === "completed") {
    ctx.out(
      `${pc.green("Completed.")} ${pc.bold(fmt(r.received ?? r.amount) ?? "")} landed in the wallet.`,
    );
  } else printRequest(ctx, r);

  switch (r.status) {
    case "denied":
      throw new CliExit(
        EXIT.ERROR,
        "The user declined the top-up. Do not ask again without talking to them.",
        "denied",
      );
    case "expired":
      throw new CliExit(
        EXIT.ERROR,
        "The top-up request expired before the user answered.",
        "expired",
      );
    case "failed":
      throw new CliExit(
        EXIT.ERROR,
        `The top-up failed: ${r.failureReason ?? "unknown reason"}.`,
        "failed",
      );
    case "completed":
      return;
    default:
      throw needsUser(
        json ? `Still ${r.status}. The user must open ${r.approvalUrl}.` : "",
        "top_up_pending",
      );
  }
}

function printRequest(ctx: CliContext, r: TopUpRequest): void {
  ctx.out(`Top-up request ${pc.bold(r.id)} ${pc.dim("·")} ${statusColor(r.status)}`);
  for (const line of kv([
    ["Amount", fmt(r.amount)],
    ["Received", fmt(r.received)],
    ["Reason", r.reason],
    ["Requester", r.requester],
    ["Order", r.orderId],
    ["Answer by", formatDate(r.requestExpiresAt)],
    ["Failure", r.failureReason],
  ]))
    ctx.out(line);
  if (r.status === "pending" || r.status === "paying") {
    printUserLink(
      ctx,
      "Open this link to add credits:",
      r.approvalUrl,
      "Show this URL to the user verbatim. They pay by card in the browser, with no identity check.",
    );
  }
}
