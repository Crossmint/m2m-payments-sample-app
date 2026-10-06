"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { delay, Typed, typedFor } from "../bits";
import { STORY } from "../story";
import { useStepLoop } from "../use-step-loop";
import { WindowMock } from "./window-mock";

/*
 * A terminal agent driving Acme's own CLI, built on @m2m-payments/cli.
 * It reads the wallet, asks for access and waits for the approval, then pays
 * the research API over x402 and prints the receipt. Commands type in,
 * output lands line by line, and the whole run replays on a loop while in
 * view.
 */

const SPEED = 22;
const CMD_WALLET = `${STORY.cli} wallet`;
const CMD_ACCESS = `${STORY.cli} access request --wait`;
const CMD_PAY = `${STORY.cli} pay x402 ${STORY.apiUrl} --body '{"q":"${STORY.apiQuery}"}'`;

const T = (() => {
  const wallet = 400;
  const walletOut = wallet + typedFor(CMD_WALLET, SPEED) + 300;
  const cmd1 = walletOut + 900;
  const out1 = cmd1 + typedFor(CMD_ACCESS, SPEED) + 300;
  const waiting = out1 + 500;
  const approved = waiting + 1600;
  const cmd2 = approved + 900;
  const out2 = cmd2 + typedFor(CMD_PAY, SPEED) + 300;
  const steps = [out2 + 500, out2 + 1200, out2 + 1900];
  const done = out2 + 2600;
  const loop = done + 4200;
  return { wallet, walletOut, cmd1, out1, waiting, approved, cmd2, out2, steps, done, loop };
})();

/** What the server says while it settles the 402, in order. */
const PAY_STEPS = [
  `402 · ${STORY.callPrice} CRED required…`,
  "signing with the agent's signer…",
  "retrying with the payment…",
];

export function TerminalMock({ className }: { className?: string }) {
  const { ref, cycle } = useStepLoop<HTMLDivElement>(1, { interval: T.loop });
  return (
    <div ref={ref} className={cn("flex w-full flex-col gap-3", className)}>
      <WindowMock tone="dark" address="zsh" className="aspect-[3/4] sm:aspect-[16/11]">
        <pre
          key={cycle}
          className="scrollbar-none m-0 flex min-h-0 flex-1 flex-col gap-1 overflow-hidden p-4 font-mono text-[11px] leading-[1.6] whitespace-pre-wrap break-all text-background/85 sm:text-[12px]"
        >
          <Line>
            <Prompt />
            <Typed
              text={CMD_WALLET}
              at={T.wallet}
              speed={SPEED}
              className="whitespace-pre-wrap text-background"
            />
          </Line>
          <Out at={T.walletOut}>
            {STORY.address} · {STORY.balanceAfter} CRED on {STORY.network} · agent access: none
          </Out>
          <Line className="mt-2">
            <Prompt at={T.cmd1} />
            <Typed
              text={CMD_ACCESS}
              at={T.cmd1}
              speed={SPEED}
              className="whitespace-pre-wrap text-background"
            />
          </Line>
          <Out at={T.out1}>
            Approve at{" "}
            <span className="underline decoration-background/40 underline-offset-2">
              {STORY.approveUrl}
            </span>
          </Out>
          <Out at={T.waiting} muted>
            Waiting for approval…
          </Out>
          <Out at={T.approved}>
            <Ok /> Approved. Agent access active · {STORY.accessRequestId}
          </Out>
          <Line className="mt-2">
            <Prompt at={T.cmd2} />
            <Typed
              text={CMD_PAY}
              at={T.cmd2}
              speed={SPEED}
              className="whitespace-pre-wrap text-background"
            />
          </Line>
          {PAY_STEPS.map((label, i) => (
            <Out key={label} at={T.steps[i] ?? T.out2} muted>
              {label}
            </Out>
          ))}
          <Out at={T.done}>
            <Ok /> Paid {STORY.callPrice} CRED over x402 · tx {STORY.txHash}
          </Out>
          <Out at={T.done + 300} muted>
            200 · {STORY.sources} results
          </Out>
        </pre>
      </WindowMock>
    </div>
  );
}

function Line({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("block", className)}>{children}</span>;
}

function Prompt({ at }: { at?: number }) {
  return (
    <span
      className={cn("mr-2 text-background/50 select-none", at !== undefined && "landing-fade")}
      style={at !== undefined ? delay(at) : undefined}
    >
      $
    </span>
  );
}

function Out({ at, muted, children }: { at: number; muted?: boolean; children: ReactNode }) {
  return (
    <span className={cn("landing-fade block", muted && "text-background/55")} style={delay(at)}>
      {children}
    </span>
  );
}

function Ok() {
  return (
    <span className="mr-1 inline-flex size-3.5 translate-y-[2px] items-center justify-center rounded-full bg-primary text-primary-foreground">
      <Check className="size-2.5" strokeWidth={3.5} />
    </span>
  );
}
