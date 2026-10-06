import type { Command } from "commander";
import { formatAmount } from "@m2m-payments/core";
import type { Amount } from "@m2m-payments/core";
import pc from "picocolors";
import { M2mPaymentsApi } from "../api.js";
import { resolveConfig } from "../config.js";
import type { CliContext } from "../context.js";
import { CliExit, EXIT, fail, notLoggedIn } from "../output.js";

export interface JsonOption {
  json?: boolean;
}

export interface WaitOptions {
  wait?: boolean;
  timeout?: number;
}

export function withJson(cmd: Command): Command {
  return cmd.option("--json", "print raw JSON");
}

export function withWait(cmd: Command, what: string): Command {
  return cmd
    .option("--wait", `block until the user ${what}`)
    .option(
      "--timeout <s>",
      "with --wait: give up after this many seconds",
      parsePositiveNumber("--timeout"),
    );
}

/** Build an authenticated client, or exit 3. */
export function getApi(ctx: CliContext): M2mPaymentsApi {
  const config = resolveConfig(ctx.config, ctx.env);
  if (!config) throw notLoggedIn();
  if (!config.accessToken) throw notLoggedIn();
  return new M2mPaymentsApi({
    config,
    fetch: ctx.fetch,
    store: config.tokenFromEnv ? undefined : ctx.config,
    now: ctx.now,
  });
}

export function parsePositiveNumber(label: string): (value: string) => number {
  return (value) => {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0)
      throw fail(`${label} must be a positive number, got "${value}".`);
    return n;
  };
}

/** Credits input. Accepts "10", "0.05", "$10", "1,000". */
export function parseAmount(label: string): (value: string) => number {
  return (value) => {
    const n = Number(value.replace(/[$€£,\s]/g, ""));
    if (!Number.isFinite(n) || n <= 0)
      throw fail(`${label} must be a positive amount, got "${value}".`);
    return n;
  };
}

export function parseJsonValues(raw: string, label = "--values"): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw fail(`${label} is not valid JSON: ${(e as Error).message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw fail(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

/**
 * Repeated `--header k:v` (or `k=v`) flags into one headers object. Header
 * names are lower-cased so a later flag replaces an earlier one.
 */
export function parseHeaders(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const raw of values) {
    const idx = raw.search(/[:=]/);
    if (idx <= 0) throw fail(`--header must be "name: value", got "${raw}".`);
    const name = raw.slice(0, idx).trim().toLowerCase();
    const value = raw.slice(idx + 1).trim();
    if (!name) throw fail(`--header must be "name: value", got "${raw}".`);
    headers[name] = value;
  }
  return headers;
}

/** Commander collects repeated options through this accumulator. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function fmt(amount: Amount | undefined): string | undefined {
  return amount ? formatAmount(amount.value, amount.currency) : undefined;
}

/** How often `--wait` asks the server again. */
export const POLL_MS = 2000;

/**
 * Poll `read` until `done` says so, or the deadline passes. Progress is
 * written to stderr so `--json` output stays one document. On timeout the
 * caller's `onTimeout` decides the exit.
 */
export async function pollUntil<T extends { status: string }>(
  ctx: CliContext,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  opts: { initial: T; deadline?: number; onTimeout: (last: T) => CliExit },
): Promise<T> {
  let last = opts.initial;
  if (done(last)) return last;
  for (;;) {
    if (opts.deadline !== undefined && ctx.now() >= opts.deadline) throw opts.onTimeout(last);
    await ctx.sleep(POLL_MS);
    const next = await read();
    if (next.status !== last.status) ctx.err(`Status: ${next.status}`);
    last = next;
    if (done(last)) return last;
  }
}

/** The moment to stop waiting: the user's `--timeout`, else a little past the request's own expiry. */
export function waitDeadline(
  ctx: CliContext,
  requestExpiresAt: string,
  timeoutS: number | undefined,
): number | undefined {
  const deadlines: number[] = [];
  const expires = new Date(requestExpiresAt).getTime();
  if (Number.isFinite(expires)) deadlines.push(expires + POLL_MS * 2);
  if (timeoutS) deadlines.push(ctx.now() + timeoutS * 1000);
  return deadlines.length ? Math.min(...deadlines) : undefined;
}

/** Print a link the user has to open, the same way on every command. */
export function printUserLink(ctx: CliContext, heading: string, url: string, note: string): void {
  ctx.out("");
  ctx.out(pc.bold(heading));
  ctx.out(`  ${pc.cyan(pc.underline(url))}`);
  ctx.out("");
  ctx.out(pc.dim(note));
}

/** Exit 2: the user has to act in the browser. */
export function needsUser(message: string, code: string): CliExit {
  return new CliExit(EXIT.NEEDS_USER_ACTION, message, code);
}
