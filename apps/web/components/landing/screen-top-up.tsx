"use client";

import type { CSSProperties, ReactNode } from "react";
import { ChevronLeft, Lock } from "lucide-react";
import { CardBadge, delay, FauxButton, Typed, typedFor } from "./bits";
import { CountUp } from "./count-up";
import { STORY } from "./story";

/*
 * The wallet, topped up by card. The page opens on a low balance, "Add
 * credits" presses, the card form slides up as a sheet with the figure and a
 * card form that fills itself in, Pay presses, the sheet leaves, and the
 * credits count into the balance. No identity fields anywhere: the one line
 * about it says "No ID check". One CSS timeline from mount, about seven
 * seconds.
 */

const NUMBER = "5555 4444 3333 4444";
const EXPIRY = "12/29";
const CVC = "•••";
const NAME = "Alex Rivera";

const T = (() => {
  const addPress = 300;
  const sheet = 650;
  const number = sheet + 500;
  const expiry = number + typedFor(NUMBER, 58) + 200;
  const cvc = expiry + typedFor(EXPIRY, 70) + 220;
  const name = cvc + typedFor(CVC, 80) + 220;
  const pay = name + typedFor(NAME, 46) + 320;
  const leave = pay + 450;
  const received = leave + 350;
  const count = 900;
  return { addPress, sheet, number, expiry, cvc, name, pay, leave, received, count };
})();

/** When the credits have finished counting in, ms from mount. */
export const TOP_UP_END = T.received + T.count + 400;

export function TopUpScreen() {
  const sheetTiming = { ...delay(T.sheet), "--leave": `${T.leave}ms` } as CSSProperties;
  return (
    <div className="relative flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center gap-1 px-3 pt-11 pb-1">
        <ChevronLeft className="size-5" strokeWidth={2} />
        <span className="text-[12.5px] font-medium">Chat</span>
      </div>
      <div className="flex flex-col gap-1 px-5 pt-3">
        <h2 className="text-[22px] leading-[1.2] font-medium tracking-[-0.02em]">Wallet</h2>
        <p className="font-mono text-[11px] text-muted-foreground">{STORY.address}</p>
      </div>

      {/* The balance: the low figure until the credits land, then the new one counting in. */}
      <div className="relative mt-4 flex flex-col gap-1 px-5">
        <span className="text-[10.5px] font-medium tracking-wide text-muted-foreground uppercase">
          Balance
        </span>
        <div className="relative h-11">
          <span
            className="landing-vanish absolute inset-x-0 top-0 font-display text-[36px] leading-[1.1] font-medium tracking-[-0.03em] tabular-nums"
            style={delay(T.received)}
          >
            {STORY.balanceBefore} <span className="text-[16px] text-muted-foreground">credits</span>
          </span>
          <span
            className="landing-fade absolute inset-x-0 top-0 font-display text-[36px] leading-[1.1] font-medium tracking-[-0.03em]"
            style={delay(T.received)}
          >
            <CountUp to={Number(STORY.balanceAfter)} at={T.received} dur={T.count} />{" "}
            <span className="text-[16px] text-muted-foreground">credits</span>
          </span>
        </div>
        <span
          className="landing-fade inline-flex w-fit items-center rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success"
          style={delay(T.received + 200)}
        >
          +{STORY.topUpCredits} credits · {STORY.card}
        </span>
      </div>

      <div className="mt-auto flex flex-col gap-2 px-5 pb-9">
        <FauxButton press={T.addPress} className="w-full">
          Add credits
        </FauxButton>
        <p className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
          <Lock className="size-2.5" strokeWidth={2.5} />
          Card checkout by Crossmint. No ID check.
        </p>
      </div>

      {/* The card form, as a sheet that comes and goes. */}
      <div
        aria-hidden
        className="landing-scrim-leave absolute inset-0 z-30 bg-black/10"
        style={sheetTiming}
      />
      <div
        className="landing-sheet-leave absolute inset-x-0 bottom-0 z-40 flex flex-col gap-3 rounded-t-[calc(var(--radius)+18px)] bg-background px-5 pt-3 pb-7"
        style={sheetTiming}
      >
        <span aria-hidden className="mx-auto h-1 w-9 rounded-full bg-muted-strong" />
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-[17px] leading-tight font-semibold tracking-[-0.02em]">
              Add credits
            </p>
            <p className="text-[11px] text-muted-foreground">
              {STORY.topUpBare} credits to receive · no ID check
            </p>
          </div>
          <span className="font-display text-[28px] leading-none font-medium tracking-[-0.03em] tabular-nums">
            {STORY.topUp}
          </span>
        </div>
        <Field
          label="Card number"
          from={T.number - 150}
          to={T.expiry}
          trailing={<CardBadge at={T.expiry - 150} />}
        >
          <Typed text={NUMBER} at={T.number} speed={58} className="tabular-nums" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Expiry" from={T.expiry} to={T.cvc} placeholder="MM/YY">
            <Typed text={EXPIRY} at={T.expiry + 60} speed={70} className="tabular-nums" />
          </Field>
          <Field label="CVC" from={T.cvc} to={T.name} placeholder="123">
            <Typed text={CVC} at={T.cvc + 60} speed={80} />
          </Field>
        </div>
        <Field label="Name on card" from={T.name} to={T.pay}>
          <Typed text={NAME} at={T.name + 60} speed={46} />
        </Field>
        <FauxButton press={T.pay} className="mt-1 h-11 w-full gap-1.5">
          <Lock className="size-3.5" strokeWidth={2.5} />
          Pay {STORY.topUpCharge}
        </FauxButton>
      </div>
    </div>
  );
}

/**
 * One field. The focus ring shows from `from` to `to`. A placeholder sits in
 * the box until typing starts; a caret blinks at the end while focused.
 */
function Field({
  label,
  from,
  to,
  placeholder,
  trailing,
  children,
}: {
  label: string;
  from: number;
  to: number;
  placeholder?: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  const focus = { ...delay(from), "--dur": `${Math.max(to - from, 1)}ms` } as CSSProperties;
  return (
    <span className="flex flex-col gap-1">
      <span className="text-[10.5px] leading-tight font-medium text-muted-foreground">{label}</span>
      <span
        className="landing-focus relative flex h-9 items-center rounded-xl border border-border bg-background px-3 text-[12px]"
        style={focus}
      >
        {placeholder ? (
          <span
            aria-hidden
            className="landing-vanish absolute left-3 text-muted-foreground"
            style={delay(from + 40)}
          >
            {placeholder}
          </span>
        ) : null}
        <span className="flex min-w-0 flex-1 items-center overflow-hidden">
          {children}
          <span className="landing-caret" style={focus} />
        </span>
        {trailing ? <span className="ml-2 shrink-0">{trailing}</span> : null}
      </span>
    </span>
  );
}
