import type { Command } from "commander";
import { toDecimalString } from "@m2m-payments/core";
import type { OnchainResult } from "@m2m-payments/core";
import pc from "picocolors";
import type { CliContext } from "../context.js";
import { fail, kv, toJson } from "../output.js";
import { detectRequester } from "../requester.js";
import { fmt, getApi, type JsonOption, parseAmount, withJson } from "./shared.js";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x([0-9a-fA-F]{2})*$/;

function parseAddress(label: string): (value: string) => string {
  return (value) => {
    if (!ADDRESS.test(value))
      throw fail(`${label} must be a 0x-prefixed EVM address, got "${value}".`);
    return value;
  };
}

export function registerTransferCommands(program: Command, ctx: CliContext): void {
  withJson(
    program
      .command("transfer")
      .description("send credits to another address; only when the user asked for it")
      .requiredOption("--to <address>", "the recipient", parseAddress("--to"))
      .requiredOption("--amount <credits>", "credits to send", parseAmount("--amount"))
      .option("--memo <text>", "a note for the user's activity list"),
  ).action(async (opts: JsonOption & { to: string; amount: number; memo?: string }) => {
    const api = getApi(ctx);
    const result = await api.transfer({
      to: opts.to,
      amount: toDecimalString(opts.amount),
      memo: opts.memo,
      requester: detectRequester(ctx.env, ctx.hostname()),
    });
    report(
      ctx,
      result,
      `Sent ${fmt(result.payment.amount) ?? toDecimalString(opts.amount)} to ${opts.to}.`,
      opts.json,
    );
  });

  withJson(
    program
      .command("tx")
      .description("send a raw transaction from the wallet; only when the user asked for it")
      .requiredOption("--to <address>", "the contract or recipient", parseAddress("--to"))
      .option("--data <hex>", "calldata, 0x-prefixed", (v: string) => {
        if (!HEX.test(v)) throw fail(`--data must be 0x-prefixed hex, got "${v}".`);
        return v;
      })
      .option("--value <wei>", "native value in wei, decimal; default 0", (v: string) => {
        if (!/^\d+$/.test(v)) throw fail(`--value must be a whole number of wei, got "${v}".`);
        return v;
      })
      .option("--memo <text>", "a note for the user's activity list"),
  ).action(
    async (opts: JsonOption & { to: string; data?: string; value?: string; memo?: string }) => {
      const api = getApi(ctx);
      const result = await api.sendTransaction({
        to: opts.to,
        data: opts.data,
        value: opts.value,
        memo: opts.memo,
        requester: detectRequester(ctx.env, ctx.hostname()),
      });
      report(ctx, result, `Transaction sent to ${opts.to}.`, opts.json);
    },
  );
}

function report(
  ctx: CliContext,
  r: OnchainResult,
  headline: string,
  json: boolean | undefined,
): void {
  if (json) {
    ctx.out(toJson(r));
    return;
  }
  ctx.out(`${pc.green("Done.")} ${headline}`);
  for (const line of kv([
    ["Payment", r.payment.id],
    ["Hash", r.hash],
    ["Explorer", r.explorerUrl],
  ]))
    ctx.out(line);
}
