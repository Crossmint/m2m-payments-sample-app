"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "./use-step-loop";

/*
 * A figure that counts up to `to`, the way the onramp app's success screen
 * counts the credits in. It starts `at` ms after mount and takes `dur` ms,
 * eased so the last digits settle. Under reduced motion the final figure is
 * there from the start. A caller that wants it hidden until `at` wraps it in
 * `landing-fade` with the same delay.
 */

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

export function CountUp({
  to,
  at = 0,
  dur = 900,
  decimals = 2,
  prefix = "",
  suffix = "",
  className,
}: {
  to: number;
  at?: number;
  dur?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    // Under reduced motion the final figure renders directly; nothing to animate.
    if (reduce) return;
    let frame = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min((now - start) / dur, 1);
      setValue(to * ease(t));
      if (t < 1) frame = window.requestAnimationFrame(tick);
    };
    const id = window.setTimeout(() => {
      frame = window.requestAnimationFrame(tick);
    }, at);
    return () => {
      window.clearTimeout(id);
      window.cancelAnimationFrame(frame);
    };
  }, [to, at, dur, reduce]);

  return (
    <span
      className={cn("tabular-nums", className)}
      aria-label={`${prefix}${to.toFixed(decimals)}${suffix}`}
    >
      <span aria-hidden>
        {prefix}
        {(reduce ? to : value).toFixed(decimals)}
        {suffix}
      </span>
    </span>
  );
}
