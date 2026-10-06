import type { Command } from "commander";
import type { AccessRequest, AccessRequestStatus } from "@m2m-payments/core";
import pc from "picocolors";
import type { M2mPaymentsApi } from "../api.js";
import type { CliContext } from "../context.js";
import { CliExit, EXIT, formatDate, kv, statusColor, toJson } from "../output.js";
import { detectRequester } from "../requester.js";
import {
  getApi,
  type JsonOption,
  needsUser,
  pollUntil,
  printUserLink,
  waitDeadline,
  type WaitOptions,
  withJson,
  withWait,
} from "./shared.js";

const TERMINAL: ReadonlySet<AccessRequestStatus> = new Set([
  "active",
  "denied",
  "expired",
  "failed",
]);

interface RequestOptions extends JsonOption, WaitOptions {
  reason?: string;
  requester?: string;
}

export function registerAccessCommands(program: Command, ctx: CliContext): void {
  const access = program.command("access").description("this agent's access to the user's wallet");

  withJson(
    withWait(
      access
        .command("request")
        .description(
          "ask the user to let this agent pay from their wallet; prints the approval URL",
        )
        .option("--reason <text>", "what you will pay for, in the user's words")
        .option("--requester <name>", "who is asking; default is detected from the environment"),
      "approves or denies",
    ),
  ).action(async (opts: RequestOptions) => {
    const api = getApi(ctx);
    let request = await api.createAccessRequest({
      reason: opts.reason,
      requester: opts.requester ?? detectRequester(ctx.env, ctx.hostname()),
    });
    if (!opts.wait) {
      report(ctx, request, opts.json);
      return;
    }
    if (opts.json) ctx.err(`Approval URL: ${request.approvalUrl}`);
    else if (!TERMINAL.has(request.status)) {
      printRequest(ctx, request);
      ctx.out(pc.dim("Waiting for approval... (Ctrl-C stops waiting; the request stays open)"));
    }
    request = await waitForRequest(ctx, api, request, opts.timeout);
    report(ctx, request, opts.json, true);
  });

  withJson(
    withWait(
      access
        .command("status <requestId>")
        .description("show an access request; --wait blocks until it is answered"),
      "approves or denies",
    ),
  ).action(async (requestId: string, opts: JsonOption & WaitOptions) => {
    const api = getApi(ctx);
    let request = await api.getAccessRequest(requestId);
    if (opts.wait && !TERMINAL.has(request.status)) {
      if (!opts.json) printRequest(ctx, request);
      ctx.err("Waiting for approval...");
      request = await waitForRequest(ctx, api, request, opts.timeout);
    }
    report(ctx, request, opts.json, opts.wait);
  });
}

async function waitForRequest(
  ctx: CliContext,
  api: M2mPaymentsApi,
  request: AccessRequest,
  timeoutS: number | undefined,
): Promise<AccessRequest> {
  return pollUntil(
    ctx,
    () => api.getAccessRequest(request.id),
    (r) => TERMINAL.has(r.status),
    {
      initial: request,
      deadline: waitDeadline(ctx, request.requestExpiresAt, timeoutS),
      onTimeout: (last) =>
        needsUser(
          `Still ${last.status}. Ask the user to open ${last.approvalUrl}, then run \`m2m-payments access status ${last.id} --wait\`.`,
          "access_pending",
        ),
    },
  );
}

/**
 * Print the request, then exit by status: 0 active, 1 denied / expired /
 * failed, 2 still waiting on the user (unless `waited`, which cannot end pending).
 */
function report(
  ctx: CliContext,
  r: AccessRequest,
  json: boolean | undefined,
  waited = false,
): void {
  if (json) ctx.out(toJson(r));
  else if (waited && r.status === "active") {
    ctx.out(
      `${pc.green("Approved.")} This agent can pay from the wallet${r.signerLocator ? ` as ${pc.bold(r.signerLocator)}` : ""}.`,
    );
    ctx.out(pc.dim("Next: m2m-payments pay x402 <url> --max 0.10"));
  } else printRequest(ctx, r);

  switch (r.status) {
    case "denied":
      throw new CliExit(
        EXIT.ERROR,
        "The user denied wallet access. Do not ask again without talking to them.",
        "denied",
      );
    case "expired":
      throw new CliExit(
        EXIT.ERROR,
        "The access request expired before the user answered.",
        "expired",
      );
    case "failed":
      throw new CliExit(
        EXIT.ERROR,
        `The access request failed: ${r.failureReason ?? "unknown reason"}.`,
        "failed",
      );
    case "active":
      return;
    default:
      throw needsUser(
        json ? `Still ${r.status}. The user must open ${r.approvalUrl}.` : "",
        "access_pending",
      );
  }
}

function printRequest(ctx: CliContext, r: AccessRequest): void {
  ctx.out(`Access request ${pc.bold(r.id)} ${pc.dim("·")} ${statusColor(r.status)}`);
  for (const line of kv([
    ["Reason", r.reason],
    ["Requester", r.requester],
    ["Signer", r.signerLocator],
    ["Answer by", formatDate(r.requestExpiresAt)],
    ["Failure", r.failureReason],
  ]))
    ctx.out(line);
  if (r.status === "pending" || r.status === "approved") {
    printUserLink(
      ctx,
      "Open this link to approve:",
      r.approvalUrl,
      "Show this URL to the user verbatim. They approve once, in the browser, with a code sent to their email.",
    );
  }
}
