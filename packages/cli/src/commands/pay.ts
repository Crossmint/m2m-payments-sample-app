import type { Command } from "commander";
import { toDecimalString } from "@m2m-payments/core";
import type { ProtocolPaymentInput, ProtocolPaymentResult } from "@m2m-payments/core";
import pc from "picocolors";
import type { CliContext } from "../context.js";
import { kv, toJson } from "../output.js";
import { detectRequester } from "../requester.js";
import {
  collect,
  fmt,
  getApi,
  type JsonOption,
  parseAmount,
  parseHeaders,
  withJson,
} from "./shared.js";

export interface PayOptions extends JsonOption {
  method?: string;
  body?: string;
  header?: string[];
  max?: number;
  memo?: string;
}

/** Pure: turn the parsed flags into the POST body. Tested on its own. */
export function buildPayBody(
  url: string,
  opts: PayOptions,
  ctx: Pick<CliContext, "env" | "hostname">,
): ProtocolPaymentInput {
  const body: ProtocolPaymentInput = { url, requester: detectRequester(ctx.env, ctx.hostname()) };
  if (opts.method) body.method = opts.method.toUpperCase();
  else if (opts.body !== undefined) body.method = "POST";
  const headers = parseHeaders(opts.header);
  if (headers) body.headers = headers;
  if (opts.body !== undefined) body.body = opts.body;
  if (opts.max !== undefined) body.maxAmount = toDecimalString(opts.max);
  if (opts.memo) body.memo = opts.memo;
  return body;
}

export function registerPayCommands(program: Command, ctx: CliContext): void {
  const pay = program
    .command("pay")
    .description("call a paid endpoint, paying from the wallet in credits");

  const addOptions = (cmd: Command) =>
    withJson(
      cmd
        .option("--method <verb>", "HTTP method; default GET, or POST when --body is given")
        .option("--body <text>", "request body as a string; serialize JSON first")
        .option("--header <k:v>", "extra request header; repeat for more", collect)
        .option(
          "--max <credits>",
          "most credits this one call may pay; refused before signing when the endpoint asks for more",
          parseAmount("--max"),
        )
        .option("--memo <text>", "a note for the user's activity list"),
    );

  addOptions(
    pay.command("x402 <url>").description("call an endpoint that charges with the x402 protocol"),
  ).action(async (url: string, opts: PayOptions) => {
    const api = getApi(ctx);
    const result = await api.payX402(buildPayBody(url, opts, ctx));
    report(ctx, result, opts.json);
  });

  addOptions(
    pay
      .command("mpp <url>")
      .description("call an endpoint that charges with the Machine Payments Protocol (MPP)"),
  ).action(async (url: string, opts: PayOptions) => {
    const api = getApi(ctx);
    const result = await api.payMpp(buildPayBody(url, opts, ctx));
    report(ctx, result, opts.json);
  });
}

/** Paid amount, settlement, response status, then the body on its own. */
function report(ctx: CliContext, r: ProtocolPaymentResult, json: boolean | undefined): void {
  if (json) {
    ctx.out(toJson(r));
    return;
  }
  const { payment, response, settlement } = r;
  const protocol = payment.kind === "mpp" ? "MPP" : "x402";
  if (r.paid) {
    ctx.out(
      `${pc.green("Paid")} ${pc.bold(fmt(r.amount ?? payment.amount) ?? "credits")} to ${payment.counterparty ?? "the endpoint"} over ${protocol}.`,
    );
  } else {
    ctx.out(`${pc.green("Done.")} The endpoint did not ask for payment. Nothing was charged.`);
  }
  const tx = settlement?.transaction ?? payment.hash;
  for (const line of kv([
    ["Payment", payment.id],
    [
      "Settlement",
      tx ? `${tx}${settlement?.network ? ` (${settlement.network})` : ""}` : settlement?.reference,
    ],
    ["Explorer", payment.explorerUrl],
    [
      "Response",
      `${response.status}${response.headers["content-type"] ? ` ${pc.dim(response.headers["content-type"])}` : ""}`,
    ],
  ]))
    ctx.out(line);
  ctx.out("");
  ctx.out(response.body);
  if (response.truncated) ctx.err(pc.dim("The response body was cut at 16 kB by the server."));
}
