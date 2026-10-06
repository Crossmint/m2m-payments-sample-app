"use client";

import { ConnectedAgentsBlock } from "./connected-agents-block";
import { CopyChip } from "./copy-chip";
import { ChipSkeleton, Panel, Step } from "./panel";
import type { ExperienceProps } from "./types";
import { useOrigin } from "./use-origin";

/**
 * The app as a CLI for terminal agents. One line to hand the agent: the
 * install page teaches it the skill, and the skill installs the CLI and logs
 * it in. The three commands under it show what the agent then runs.
 */
export function CliPanel(props: ExperienceProps) {
  const origin = useOrigin();

  return (
    <Panel
      title="Give a terminal agent a wallet"
      sub="Claude Code, Codex and OpenClaw can pay machines from the shell with the same approvals."
    >
      <div className="flex flex-col gap-1.5">
        {origin ? (
          <CopyChip label="Give this to your agent" value={`Set up ${origin}/install`} />
        ) : (
          <ChipSkeleton label="Give this to your agent" />
        )}
        <p className="text-xs text-muted-foreground">
          Paste this into Claude Code, Codex or OpenClaw and it installs the skill.
        </p>
      </div>

      <ol className="flex flex-col gap-6">
        <Step n={1} aside={<CopyChip value="m2m-payments login" />}>
          The agent signs in as you. It prints a link; you open it once.
        </Step>
        <Step n={2} aside={<CopyChip value="m2m-payments wallet" />}>
          It reads your wallet: the address, the credits, and whether it has access.
        </Step>
        <Step n={3} aside={<CopyChip value="m2m-payments pay x402 <url>" />}>
          It pays an endpoint. The first time, it asks to use your wallet and you approve with an
          email code.
        </Step>
      </ol>

      <ConnectedAgentsBlock
        choice={props}
        signedIn={props.signedIn}
        sessions={props.sessions}
        sessionsNote={props.sessionsNote}
        revokeSession={props.revokeSession}
        onSignedIn={props.onSignedIn}
      />
    </Panel>
  );
}
