import { Command, CommanderError } from "commander";
import { formatAmount } from "@m2m-payments/core";
import pc from "picocolors";
import { ApiError } from "./api.js";
import { registerAccessCommands } from "./commands/access.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerPayCommands } from "./commands/pay.js";
import { registerPaymentsCommands } from "./commands/payments.js";
import { registerTopUpCommands } from "./commands/top-up.js";
import { registerTransferCommands } from "./commands/transfer.js";
import { registerWalletCommands } from "./commands/wallet.js";
import { type CliContext, type ContextOverrides, createContext } from "./context.js";
import { CliExit, EXIT, toJson } from "./output.js";

export const VERSION = "0.1.0";

export function createProgram(ctx: CliContext): Command {
  const program = new Command("m2m-payments")
    .description(
      "Agent wallet CLI. Pay x402 and MPP endpoints, transfer credits and send transactions from the user's wallet, with their approval.",
    )
    .version(VERSION, "-v, --version")
    .showHelpAfterError("(run with --help for usage)")
    .configureOutput({
      writeOut: (s) => ctx.out(s.replace(/\n$/, "")),
      writeErr: (s) => ctx.err(s.replace(/\n$/, "")),
    })
    .addHelpText(
      "after",
      `
Exit codes:
  0  ok
  1  error
  2  needs the user: an approval URL or a top-up URL to open
  3  not logged in; run \`m2m-payments login --api <url>\`

Environment:
  M2M_PAYMENTS_API_URL     API base URL (overrides the saved config)
  M2M_PAYMENTS_TOKEN       bearer token for CI and agents (no refresh)
  M2M_PAYMENTS_CONFIG_DIR  where config.json lives (default ~/.config/m2m-payments)`,
    );

  registerAuthCommands(program, ctx);
  registerWalletCommands(program, ctx);
  registerAccessCommands(program, ctx);
  registerTopUpCommands(program, ctx);
  registerPayCommands(program, ctx);
  registerTransferCommands(program, ctx);
  registerPaymentsCommands(program, ctx);
  return program;
}

/**
 * Parse and run. Returns the exit code instead of calling `process.exit`,
 * so tests and embedders can reuse it.
 */
export async function runCli(argv: string[], overrides: ContextOverrides = {}): Promise<number> {
  const ctx = createContext(overrides);
  const json = argv.includes("--json");
  const program = createProgram(ctx).exitOverride();
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT.OK;
  } catch (e) {
    return reportError(ctx, e, json);
  }
}

function reportError(ctx: CliContext, e: unknown, json: boolean): number {
  if (e instanceof CommanderError) {
    // Help and version exit 0. Usage errors were already printed by commander.
    return e.exitCode;
  }
  if (e instanceof CliExit) {
    if (e.message) emit(ctx, json, e.code, e.message);
    return e.exitCode;
  }
  if (e instanceof ApiError) {
    emit(ctx, json, e.code, `${e.message}${hintFor(e)}`, e.details);
    if (!json) printUserHints(ctx, e);
    return e.exitCode;
  }
  const message = e instanceof Error ? e.message : String(e);
  emit(ctx, json, "error", message);
  return EXIT.ERROR;
}

function hintFor(e: ApiError): string {
  switch (e.code) {
    case "unauthorized":
      return " Run `m2m-payments login` again.";
    case "wallet_not_found":
      return " The user has to open the app once so the wallet is created in their browser.";
    default:
      return "";
  }
}

/**
 * The two errors that need the user, spelled out for a human or an agent:
 * the approval link on `access_required`, the balance and the top-up
 * command on `insufficient_funds`. Written to stderr like the error itself.
 */
function printUserHints(ctx: CliContext, e: ApiError): void {
  const access = e.access;
  if (access?.approvalUrl) {
    ctx.err("");
    ctx.err(
      pc.bold("The user has to allow this agent to use their wallet. Open this link to approve:"),
    );
    ctx.err(`  ${pc.cyan(pc.underline(access.approvalUrl))}`);
    ctx.err("");
    ctx.err(
      pc.dim(
        `Show this URL to the user verbatim${access.requestId ? `, then run \`m2m-payments access status ${access.requestId} --wait\`` : ""}. Retry the command once access is active.`,
      ),
    );
    return;
  }
  if (access) {
    ctx.err(
      pc.dim("Run `m2m-payments access request --wait` to get an approval link for the user."),
    );
    return;
  }
  const funds = e.funds;
  if (funds) {
    const balance = funds.balance
      ? formatAmount(funds.balance.value, funds.balance.currency)
      : "unknown";
    const required = funds.required
      ? formatAmount(funds.required.value, funds.required.currency)
      : "unknown";
    ctx.err("");
    ctx.err(`  ${pc.dim("Balance:")}  ${balance}`);
    ctx.err(`  ${pc.dim("Required:")} ${required}`);
    ctx.err("");
    ctx.err(
      pc.dim(
        `Ask the user to add credits: m2m-payments top-up request --amount ${funds.required?.value ?? "<credits>"} --wait`,
      ),
    );
  }
}

function emit(
  ctx: CliContext,
  json: boolean,
  code: string,
  message: string,
  details?: unknown,
): void {
  if (json)
    ctx.err(toJson({ error: { code, message, ...(details === undefined ? {} : { details }) } }));
  else
    ctx.err(
      `${pc.red("Error:")} ${message}${code !== "error" && code !== "cli_error" ? pc.dim(` (${code})`) : ""}`,
    );
}
