#!/usr/bin/env node
/**
 * `m2m-payments-mcp`: serve the M2M Payments tools over stdio for local MCP hosts
 * (Claude Code, Claude Desktop, Cursor, ...).
 *
 *   m2m-payments-mcp --api https://wallet.example.com [--requester "Claude Code"]
 *
 * Token: `M2M_PAYMENTS_TOKEN` env, else `accessToken` from `~/.config/m2m-payments/config.json`
 * written by `m2m-payments login`. API URL: `--api`, else `M2M_PAYMENTS_API` env, else the config file.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createM2mPaymentsMcpServer } from "./server.js";

interface CliConfig {
  apiBaseUrl?: string;
  accessToken?: string;
}

function parseArgs(argv: string[]): {
  api?: string;
  token?: string;
  requester?: string;
  help: boolean;
} {
  const out: { api?: string; token?: string; requester?: string; help: boolean } = { help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--api") out.api = next();
    else if (arg?.startsWith("--api=")) out.api = arg.slice("--api=".length);
    else if (arg === "--token") out.token = next();
    else if (arg?.startsWith("--token=")) out.token = arg.slice("--token=".length);
    else if (arg === "--requester") out.requester = next();
    else if (arg?.startsWith("--requester=")) out.requester = arg.slice("--requester=".length);
    else if (arg === "--help" || arg === "-h") out.help = true;
  }
  return out;
}

export function cliConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config");
  return join(base, "m2m-payments", "config.json");
}

async function readCliConfig(path: string): Promise<CliConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as CliConfig) : {};
  } catch {
    return {};
  }
}

/**
 * `--api https://wallet.example.com` points at the website. The API lives under
 * `/api/m2m-payments` in the reference app. A URL with a path is used as given.
 */
export function resolveApiBaseUrl(input: string): string {
  const url = new URL(input);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/api/m2m-payments";
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/+$/, "");
}

const HELP = `m2m-payments-mcp: M2M Payments wallet tools over MCP stdio.

Usage: m2m-payments-mcp --api <url> [--requester <name>] [--token <jwt>]

  --api        M2M Payments website or API URL, e.g. https://wallet.example.com
  --requester  Name shown to the user on approvals. Default "Agent".
  --token      Bearer token. Default: $M2M_PAYMENTS_TOKEN, else ~/.config/m2m-payments/config.json.

Log in first with: m2m-payments login --api <url>
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stderr.write(HELP);
    return;
  }
  const config = await readCliConfig(cliConfigPath());
  const apiInput = args.api ?? process.env.M2M_PAYMENTS_API ?? config.apiBaseUrl;
  const token = args.token ?? process.env.M2M_PAYMENTS_TOKEN ?? config.accessToken;

  if (!apiInput) {
    process.stderr.write(
      "m2m-payments-mcp: no API URL. Pass --api <url> or run `m2m-payments login --api <url>`.\n",
    );
    process.exit(2);
  }
  if (!token) {
    process.stderr.write(
      "m2m-payments-mcp: no token. Set M2M_PAYMENTS_TOKEN or run `m2m-payments login`.\n",
    );
    process.exit(2);
  }

  const server = createM2mPaymentsMcpServer({
    apiBaseUrl: resolveApiBaseUrl(apiInput),
    bearerToken: token,
    requester: args.requester ?? process.env.M2M_PAYMENTS_REQUESTER,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`m2m-payments-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
