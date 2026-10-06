"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { useCountUp } from "../../hooks/use-count-up.js";
import type { TopUpFlowPhase } from "../../hooks/use-top-up.js";
import { Button } from "../primitives/button.js";
import { Spinner } from "../primitives/spinner.js";

const PROGRESS_LABEL: Partial<Record<TopUpFlowPhase, string>> = {
  creating: "Creating your order",
  paying: "Charging your card",
  confirming: "Delivering your credits",
};

const COUNT_MS = 900;
const DONE_DELAY_MS = COUNT_MS + 250;

export interface TopUpStatusProps {
  phase: TopUpFlowPhase;
  error: string | undefined;
  /** Credits delivered, as a decimal string. */
  received: string | undefined;
  /** Payment accepted, delivery still in flight. */
  pending: boolean;
  onDone: () => void;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * Step three of the top-up. Success counts the credits up in the display
 * face, then offers Done; an error says what happened with Try again and
 * Back; anything else is a spinner with one line.
 */
export function TopUpStatus({
  phase,
  error,
  received,
  pending,
  onDone,
  onRetry,
  onBack,
}: TopUpStatusProps) {
  if (phase === "success") {
    return <Completed pending={pending} received={received} onDone={onDone} />;
  }

  if (phase === "error") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 py-10 text-center">
          <AlertCircle aria-hidden className="size-14 text-destructive" />
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-medium">Payment failed</h1>
            <p className="mx-auto max-w-[18rem] text-sm text-muted-foreground">
              {error ?? "Something went wrong."}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" size="xl" className="w-full" onClick={onRetry}>
            Try again
          </Button>
          <Button type="button" variant="secondary" size="xl" className="w-full" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 py-16 text-center">
      <Spinner className="size-14 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{PROGRESS_LABEL[phase] ?? "Working"}</p>
    </div>
  );
}

function Completed({
  pending,
  received,
  onDone,
}: {
  pending: boolean;
  received: string | undefined;
  onDone: () => void;
}) {
  const target = Number(received) || 0;
  const value = useCountUp(target, COUNT_MS, 0);
  const [showDone, setShowDone] = React.useState(false);

  React.useEffect(() => {
    const id = setTimeout(() => setShowDone(true), DONE_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="enter-up enter-up-far flex-1 pt-8">
        <p className="text-sm font-medium">{pending ? "Credits on their way" : "Credits added"}</p>
        <p className="mt-2 font-display text-5xl font-semibold tracking-tight tabular-nums">
          <span className="text-primary">+{value.toFixed(2)}</span>{" "}
          <span className="text-primary/30">credits</span>
        </p>
        {pending ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Your card was charged. The credits land in your wallet in a moment.
          </p>
        ) : null}
      </div>
      {showDone ? (
        <Button type="button" size="xl" className="enter-up mt-8 w-full" onClick={onDone}>
          Done
        </Button>
      ) : (
        <div className="mt-8 h-14" />
      )}
    </div>
  );
}
