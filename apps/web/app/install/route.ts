import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

/** Reads the request origin, so a self-hosted deployment points agents at itself. */
export const dynamic = "force-dynamic";

/**
 * GET /install: what an agent reads when a user pastes
 * "Set up https://<host>/install". Plain markdown: how to install the CLI,
 * sign in, and the skill that teaches the agent the flow. The skill text is
 * the same file the plugins ship (`pnpm plugin:sync` copies it to public/).
 */
export async function GET(req: Request): Promise<Response> {
  const origin = new URL(req.url).origin;
  const raw = await readFile(path.join(process.cwd(), "public", "skill.md"), "utf8");
  // Drop the YAML frontmatter; the heading below introduces the skill.
  const skill = raw.replace(/^---\n[\s\S]*?\n---\n/, "");
  const body = [
    "# Set up the M2M Payments Sample App",
    "",
    "The M2M Payments Sample App lets you pay other machines from the user's wallet, once they approve you. Do these steps, then follow the skill below.",
    "",
    "1. Install the CLI: `npm i -g @m2m-payments/cli`",
    `2. Sign in as the user: \`m2m-payments login --api ${origin}/api/m2m-payments\`. It prints a link; show it to the user and wait.`,
    "3. Save the skill below as `skills/m2m-payments/SKILL.md` in your skills folder, so you keep it for next time.",
    `4. If you prefer MCP, connect to \`${origin}/api/mcp\` instead; the same tools are there.`,
    "",
    "---",
    "",
    skill.trim(),
    "",
  ].join("\n");
  return new NextResponse(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
