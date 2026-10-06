import type { Command } from "commander";
import type { PaymentKind } from "@m2m-payments/core";
import pc from "picocolors";
import type { CliContext } from "../context.js";
import { fail, formatDate, statusColor, table, toJson } from "../output.js";
import { PAYMENT_KINDS } from "../types.js";
import { fmt, getApi, type JsonOption, parsePositiveNumber, withJson } from "./shared.js";

export function registerPaymentsCommands(program: Command, ctx: CliContext): void {
  const payments = program.command("payments").description("what this wallet paid, newest first");

  withJson(
    payments
      .command("list")
      .description("list payments as a table")
      .option("--limit <n>", "how many rows; default 50", parsePositiveNumber("--limit"), 50)
      .option("--kind <kind>", `only one kind: ${PAYMENT_KINDS.join(", ")}`, (v: string) => {
        if (!(PAYMENT_KINDS as readonly string[]).includes(v))
          throw fail(`--kind must be one of ${PAYMENT_KINDS.join(", ")}, got "${v}".`);
        return v as PaymentKind;
      }),
  ).action(async (opts: JsonOption & { limit: number; kind?: PaymentKind }) => {
    const api = getApi(ctx);
    const { payments: rows } = await api.listPayments({ limit: opts.limit, kind: opts.kind });
    if (opts.json) {
      ctx.out(toJson(rows));
      return;
    }
    if (rows.length === 0) {
      ctx.out("No payments yet.");
      return;
    }
    const lines = table([
      ["ID", "KIND", "STATUS", "AMOUNT", "TO", "NOTE", "WHEN"].map((h) => pc.dim(h)),
      ...rows.map((p) => [
        p.id,
        p.kind,
        statusColor(p.status),
        fmt(p.amount) ?? "",
        p.counterparty ?? "",
        p.description ?? p.failureReason ?? "",
        pc.dim(formatDate(p.createdAt) ?? ""),
      ]),
    ]);
    for (const line of lines) ctx.out(line.trimEnd());
  });
}
