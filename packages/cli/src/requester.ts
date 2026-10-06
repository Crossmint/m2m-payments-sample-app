import { hostname as osHostname } from "node:os";
import type { Env } from "./config.js";

/**
 * Who is asking to use the wallet. Shown to the user on the approval and top-up pages.
 * Detected from the environment of well-known coding agents.
 */
export function detectRequester(env: Env = process.env, hostname: string = osHostname()): string {
  if (env.CLAUDECODE) return "Claude Code";
  if (env.CODEX || env.CODEX_SANDBOX) return "Codex";
  if (env.CURSOR_AGENT) return "Cursor";
  if (env.GEMINI_CLI) return "Gemini CLI";
  return `m2m-payments CLI on ${hostname}`;
}
