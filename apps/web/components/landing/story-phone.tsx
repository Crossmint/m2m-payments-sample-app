"use client";

import { cn } from "@/lib/cn";
import { AgentAppRun, type AppRunScript } from "./agent-app-run";
import {
  askEntry,
  checkedWalletEntry,
  doneEntry,
  grantedEntry,
  PAYMENT_RUN,
  payingEntry,
  progressEntry,
  receiptEntry,
  replyEntry,
  requestEntry,
  TOP_UP_COUNT,
  topUpAskEntry,
  topUpEntry,
  toppedUpEntry,
} from "./agent-app-story";
import { LandingPhone } from "./landing-phone";
import { STORY } from "./story";
import { useStepLoop } from "./use-step-loop";

/*
 * The hero phone: the agent app's own mobile screen, playing the whole story
 * from the ask to the receipt, and never more than one window.
 *
 * The screen is the one from `components/experiences/mobile-app.tsx`, the app
 * a visitor gets from "Try it live", so the hero shows the product rather
 * than an impression of it. `AgentAppRun` holds the how; this file is only
 * the script.
 */

/** When each entry lands, ms from the start of a run. */
const AT = {
  ask: 300,
  checkedWallet: 1100,
  reply: 1700,
  request: 2300,
  granted: 6950,
  topUpAsk: 7500,
  topUp: 8100,
  toppedUp: 12850,
  paying: 13400,
  progress: 13950,
  done: 17450,
  receipt: 18000,
} as const;

/** The access sheet, on the run clock. */
const ACCESS_SHEET = {
  up: 3400,
  down: 6600,
  ready: 3900,
  press: 4700,
  done: 5250,
} as const;

/** The top-up sheet, on the run clock. The credits count in after `done`. */
const TOP_UP_SHEET = {
  up: 9200,
  down: 12500,
  ready: 9700,
  press: 10500,
  done: 11050,
} as const;

/** The run restarts here, a beat after the receipt has settled. */
const LOOP = 21300;

const SCRIPT: AppRunScript = {
  thread: [
    { at: AT.ask, entry: askEntry() },
    { at: AT.checkedWallet, entry: checkedWalletEntry() },
    { at: AT.reply, entry: replyEntry() },
    {
      at: AT.request,
      entry: requestEntry({
        // Review presses itself, which calls the sheet up.
        reviewPress: ACCESS_SHEET.up - AT.request - 350,
        settleAt: ACCESS_SHEET.done - AT.request,
      }),
    },
    { at: AT.granted, entry: grantedEntry() },
    { at: AT.topUpAsk, entry: topUpAskEntry() },
    {
      at: AT.topUp,
      entry: topUpEntry({
        addPress: TOP_UP_SHEET.up - AT.topUp - 350,
        settleAt: TOP_UP_SHEET.done - AT.topUp,
      }),
    },
    { at: AT.toppedUp, entry: toppedUpEntry() },
    { at: AT.paying, entry: payingEntry() },
    { at: AT.progress, entry: progressEntry() },
    { at: AT.done, entry: doneEntry() },
    { at: AT.receipt, entry: receiptEntry() },
  ],
  sheets: [
    { kind: "access", ...ACCESS_SHEET },
    { kind: "top-up", ...TOP_UP_SHEET },
  ],
};

// The last payment step has to land before the agent says it is done, and
// the credits have to finish counting before the top-up sheet goes down.
if (process.env.NODE_ENV !== "production") {
  if (AT.progress + PAYMENT_RUN > AT.done) {
    console.warn("[story-phone] the payment run outlasts the 'done' message");
  }
  if (TOP_UP_SHEET.done + 350 + TOP_UP_COUNT > TOP_UP_SHEET.down) {
    console.warn("[story-phone] the top-up sheet goes down before the credits finish counting");
  }
}

const LABEL = `An iPhone running the agent app: the user asks ${STORY.agent} to ${STORY.ask.toLowerCase()}, the agent asks to use the wallet, an approval sheet slides up over the chat with the agent, the reason and what it can do, the user allows it and confirms with an email code, the agent asks for ${STORY.topUpBare} credits, a top-up sheet takes ${STORY.topUpCharge} by card with no ID check, the agent pays ${STORY.api} over x402 and a receipt for ${STORY.receipt.total} arrives with the brief`;

/** The hero phone. It plays while in view and starts over each time it comes back. */
export function StoryPhone({ className }: { className?: string }) {
  const { ref, cycle } = useStepLoop<HTMLDivElement>(1, { interval: LOOP });
  return (
    <div ref={ref} className={cn("flex", className)}>
      <LandingPhone label={LABEL}>
        <AgentAppRun script={SCRIPT} run={cycle} />
      </LandingPhone>
    </div>
  );
}
