"use client";

import * as React from "react";

/**
 * Eases toward `target` when it changes. Starts at `from` when given, else
 * at the target with no first-render animation. Ported from the onramp
 * sample app; the success screen counts the credits up with it.
 */
export function useCountUp(target: number, duration = 500, from?: number): number {
  const [value, setValue] = React.useState(from ?? target);
  const valueRef = React.useRef(from ?? target);

  React.useEffect(() => {
    const start = valueRef.current;
    if (start === target) return;

    let frame: number;
    const began = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - began) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + (target - start) * eased;
      valueRef.current = next;
      setValue(next);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
