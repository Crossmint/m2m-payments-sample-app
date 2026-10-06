"use client";

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
  topUpAskEntry,
  topUpEntry,
  toppedUpEntry,
} from "./agent-app-story";

/*
 * Two slices of the hero's run, for the `how-it-works` phone: the access
 * approval on its own, and the payments on their own. Same screen and same
 * pieces as the hero, so the reader sees one app throughout. The thread each
 * one opens with is already settled (`at: 0`); only its own part plays.
 */

/* ---------- Step 2: the access approval ---------- */

/**
 * The beats of an approval, ms from mount. Shared, so the brand layouts in
 * `brand-app.tsx` can play the same story on their own shapes and every one
 * of them fits the same loop.
 */
export const APP_APPROVE_T = { up: 1250, ready: 1750, press: 2450, approved: 3000 } as const;

/** When the approval has shown its outcome for a moment. */
export const APP_APPROVE_END = APP_APPROVE_T.approved + 1800;

const APPROVE_SCRIPT: AppRunScript = {
  thread: [
    { at: 0, entry: askEntry() },
    { at: 0, entry: checkedWalletEntry() },
    { at: 0, entry: replyEntry() },
    {
      at: 0,
      entry: requestEntry({
        reviewPress: APP_APPROVE_T.up - 350,
        settleAt: APP_APPROVE_T.approved,
      }),
    },
  ],
  // The sheet stays up: this step is about the approval, so it ends on it.
  sheets: [{ kind: "access", ...APP_APPROVE_T, done: APP_APPROVE_T.approved }],
};

/** The chat with the approval sheet rising over it, allowed, then approved. */
export function AppApproveScreen() {
  return <AgentAppRun script={APPROVE_SCRIPT} />;
}

/* ---------- Step 3: the payments ---------- */

const PAYMENTS_AT = {
  paying: 400,
  progress: 900,
} as const;

const DONE_AT = PAYMENTS_AT.progress + PAYMENT_RUN + 500;
const RECEIPT_AT = DONE_AT + 550;

/** When the receipt has been on screen for a moment. */
export const APP_PAYMENTS_END = RECEIPT_AT + 1600;

const PAYMENTS_SCRIPT: AppRunScript = {
  thread: [
    { at: 0, entry: askEntry() },
    { at: 0, entry: checkedWalletEntry() },
    { at: 0, entry: replyEntry() },
    { at: 0, entry: requestEntry({ settleAt: 0 }) },
    { at: 0, entry: grantedEntry() },
    { at: 0, entry: topUpAskEntry() },
    { at: 0, entry: topUpEntry({ settleAt: 0 }) },
    { at: 0, entry: toppedUpEntry() },
    { at: PAYMENTS_AT.paying, entry: payingEntry() },
    { at: PAYMENTS_AT.progress, entry: progressEntry() },
    { at: DONE_AT, entry: doneEntry() },
    { at: RECEIPT_AT, entry: receiptEntry() },
  ],
};

/** Access granted and credits in: the agent pays the API in the thread and the receipt lands. */
export function AppPaymentsScreen() {
  return <AgentAppRun script={PAYMENTS_SCRIPT} />;
}
