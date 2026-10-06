"use client";

import { Lock } from "lucide-react";
import { CardBadge, CheckBurst, delay, FauxButton, RunMark, RunStep } from "./bits";
import { CountUp } from "./count-up";
import { ReceiptCard } from "./receipt-card";
import { Approved, RequestForm } from "./screen-approve";
import type { AppEntry } from "./screen-agent-app";
import { STORY } from "./story";

/*
 * The story as the agent app tells it, in the pieces both phones need: the
 * hero plays the whole run, and `how-it-works` shows the access approval and
 * the payments on their own. One file, so the two never drift apart.
 *
 * Every timing a piece takes is ms from that piece mounting, not from the
 * start of a run: cards mount with their entry, so a caller that lands an
 * entry late passes delays relative to the landing.
 */

/** The five payment steps, ms from the progress card landing. */
export const PAYMENT_STEPS = [600, 1200, 1800, 2400, 3000];
/** When the last payment step lands, ms from the progress card landing. */
export const PAYMENT_RUN = PAYMENT_STEPS[PAYMENT_STEPS.length - 1] ?? 3000;
/** How long the credits take to count in, ms from the top-up being paid. */
export const TOP_UP_COUNT = 900;

/* ---------- The entries ---------- */

export const askEntry = (): AppEntry => ({ kind: "user", key: "ask", text: STORY.ask });

export const checkedWalletEntry = (): AppEntry => ({
  kind: "activity",
  key: "wallet",
  label: "Checked your wallet",
});

export const replyEntry = (): AppEntry => ({
  kind: "agent",
  key: "reply",
  text: (
    <>
      I can do that. I need to pay a research API for the sources, so I need to use your wallet.
      Approve it below.
    </>
  ),
});

export const requestEntry = (opts: { settleAt?: number; reviewPress?: number }): AppEntry => ({
  kind: "card",
  key: "request",
  node: <AccessThreadCard {...opts} />,
});

export const grantedEntry = (): AppEntry => ({
  kind: "activity",
  key: "granted",
  label: <>Wallet access granted · {STORY.address}</>,
});

export const topUpAskEntry = (): AppEntry => ({
  kind: "agent",
  key: "top-up-ask",
  text: (
    <>
      Your wallet has {STORY.balanceBefore} credits. This needs about {STORY.needs} credits. Add{" "}
      {STORY.topUpBare}?
    </>
  ),
});

export const topUpEntry = (opts: { settleAt?: number; addPress?: number }): AppEntry => ({
  kind: "card",
  key: "top-up",
  node: <TopUpThreadCard {...opts} />,
});

export const toppedUpEntry = (): AppEntry => ({
  kind: "activity",
  key: "topped-up",
  label: (
    <>
      +{STORY.topUpCredits} credits added · {STORY.card}
    </>
  ),
});

export const payingEntry = (): AppEntry => ({
  kind: "agent",
  key: "paying",
  text: <>Paying {STORY.api} over x402…</>,
});

export const progressEntry = (): AppEntry => ({
  kind: "card",
  key: "progress",
  node: <ProgressCard from={0} steps={PAYMENT_STEPS} />,
});

export const doneEntry = (): AppEntry => ({
  kind: "agent",
  key: "done",
  text: <>Done. Here is the brief.</>,
});

export const receiptEntry = (): AppEntry => ({
  kind: "card",
  key: "receipt",
  node: <ReceiptCard />,
});

/* ---------- The pieces the entries are made of ---------- */

/**
 * The access request in the thread, as the real app's approval card shows
 * it: the ask in one line, then Review. With `settleAt` the card settles into
 * its outcome in place, same card, new state, rather than a second one
 * landing under it. Without it the card stays on Review.
 */
export function AccessThreadCard({
  settleAt,
  reviewPress,
}: {
  settleAt?: number;
  reviewPress?: number;
}) {
  return (
    <ThreadCard
      ask={
        <>
          {STORY.agent} wants to use your wallet for {STORY.reason.toLowerCase()}
        </>
      }
      button="Review"
      press={reviewPress}
      settleAt={settleAt}
      badge="active"
      outcome={
        <>
          {STORY.canDo} · {STORY.address}
        </>
      }
    />
  );
}

/**
 * The top-up request in the thread: how many credits, by card, no ID check,
 * then Add credits. Settles into the credits added, like the access card.
 */
export function TopUpThreadCard({ settleAt, addPress }: { settleAt?: number; addPress?: number }) {
  return (
    <ThreadCard
      ask={
        <>
          Add <span className="font-display tabular-nums">{STORY.topUpBare}</span> credits ·{" "}
          {STORY.topUp} by card · no ID check
        </>
      }
      button="Add credits"
      press={addPress}
      settleAt={settleAt}
      badge="paid"
      outcome={
        <>
          +{STORY.topUpCredits} credits · {STORY.card}
        </>
      }
    />
  );
}

function ThreadCard({
  ask,
  button,
  press,
  settleAt,
  badge,
  outcome,
}: {
  ask: React.ReactNode;
  button: string;
  press?: number;
  settleAt?: number;
  badge: string;
  outcome: React.ReactNode;
}) {
  const settles = settleAt !== undefined;
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-card p-3 text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[12px] leading-snug font-medium text-balance">{ask}</p>
        {settles ? (
          <span
            className="landing-fade inline-flex shrink-0 items-center rounded-full bg-success/10 px-2 py-0.5 text-[9.5px] font-medium text-success"
            style={delay(settleAt)}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="relative">
        <div
          className={settles ? "landing-vanish" : undefined}
          style={settles ? delay(settleAt) : undefined}
        >
          <FauxButton press={press} className="h-9 w-full rounded-full text-[12px]">
            {button}
          </FauxButton>
        </div>
        {settles ? (
          <p
            className="landing-fade absolute inset-x-0 top-0 text-[10.5px] text-muted-foreground"
            style={delay(settleAt + 120)}
          >
            {outcome}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * What the app's Approve sheet holds: the request, then the outcome in its
 * place. Timings are ms from the sheet's contents mounting.
 */
export function ApprovalSheetBody({
  ready,
  press,
  approved,
}: {
  ready: number;
  press: number;
  approved: number;
}) {
  return (
    <div className="relative">
      <div className="landing-vanish flex flex-col gap-3" style={delay(approved)}>
        <RequestForm ready={ready} press={press} />
      </div>
      <div className="absolute inset-x-0 top-0 flex flex-col gap-3">
        <Approved at={approved + 100} />
      </div>
    </div>
  );
}

/**
 * What the app's top-up sheet holds: the amount, the card, Pay, then the
 * credits counting in. Timings are ms from the sheet's contents mounting.
 */
export function TopUpSheetBody({
  ready,
  press,
  paid,
}: {
  ready: number;
  press: number;
  paid: number;
}) {
  return (
    <div className="relative">
      <div className="landing-vanish flex flex-col gap-3" style={delay(paid)}>
        <TopUpForm ready={ready} press={press} />
      </div>
      <div className="absolute inset-x-0 top-0 flex flex-col gap-3">
        <TopUpDone at={paid + 100} />
      </div>
    </div>
  );
}

/** The top-up sheet before payment: the figure, the card that pays, Pay. */
export function TopUpForm({ ready, press }: { ready: number; press: number }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="text-[17px] leading-[1.2] font-semibold tracking-[-0.02em]">Add credits</p>
        <p className="text-[11.5px] text-muted-foreground">
          {STORY.agent} asked for {STORY.topUpBare} credits for the {STORY.purpose.toLowerCase()}.
        </p>
      </div>
      <div className="flex flex-col items-start gap-0.5 py-1">
        <span className="font-display text-[40px] leading-[1.05] font-medium tracking-[-0.03em] tabular-nums">
          {STORY.topUp}
        </span>
        <span className="text-[11px] text-muted-foreground">credits to receive · no ID check</span>
      </div>
      <span
        aria-hidden
        className="flex h-10 items-center gap-2 rounded-xl border border-border bg-background px-2.5 text-[12px] font-medium"
      >
        <CardBadge />
        <span className="min-w-0 flex-1 truncate">Pay with {STORY.card}</span>
      </span>
      <FauxButton ready={ready} press={press} className="w-full gap-1.5">
        <Lock className="size-3.5" strokeWidth={2.5} />
        Pay {STORY.topUpCharge}
      </FauxButton>
    </>
  );
}

/** The top-up sheet after payment: the check, the credits counting in, where they went. */
export function TopUpDone({ at }: { at: number }) {
  return (
    <div className="flex flex-col items-start gap-3 pb-1">
      <CheckBurst at={at} size={48} />
      <div className="landing-fade flex flex-col gap-1" style={delay(at + 250)}>
        <CountUp
          to={Number(STORY.topUpCredits)}
          at={at + 250}
          dur={TOP_UP_COUNT}
          prefix="+"
          suffix=" credits"
          className="font-display text-[26px] leading-[1.15] font-medium tracking-[-0.02em]"
        />
        <p className="text-[12px] text-muted-foreground">Added to your wallet · {STORY.card}</p>
      </div>
      <p className="landing-fade text-[11px] text-muted-foreground" style={delay(at + 450)}>
        You can close this. {STORY.agent} carries on.
      </p>
    </div>
  );
}

/* ---------- The payment run ---------- */

/** The agent paying the API: the host, then five steps that check off one by one. */
export function ProgressCard({ from, steps }: { from: number; steps: number[] }) {
  const last = steps[steps.length - 1] ?? from;
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-2xl bg-card px-3 py-2.5 text-[11.5px] text-card-foreground ring-1 ring-foreground/10">
      <div className="flex items-center justify-between text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <span className="inline-flex items-center gap-1">
          <Lock className="size-2.5" strokeWidth={2.5} />
          {STORY.api}
        </span>
        <RunMark from={from} at={last} size="size-3" />
      </div>
      {STORY.paymentSteps.map((label, i) => (
        <RunStep
          key={`${i}-${label}`}
          label={label}
          from={i === 0 ? from : (steps[i - 1] ?? from)}
          at={steps[i] ?? last}
        />
      ))}
    </div>
  );
}
