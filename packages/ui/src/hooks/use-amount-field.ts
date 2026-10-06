"use client";

import * as React from "react";
import {
  amountCharKeys,
  countDigits,
  formatAmountInput,
  sanitizeAmount,
  trailingDigitIndices,
} from "../lib/amount-input.js";

const POP_MS = 200;

export interface UseAmountFieldOptions {
  /** The raw amount: digits and at most one dot. */
  amount: string;
  onAmountChange: (amount: string) => void;
  /** Where the keypad portals to. Null on the server and when there is no frame. */
  container: HTMLElement | null;
  /** False while the screen is hidden, so the keypad and the native keyboard stay down. */
  enabled: boolean;
}

export type AmountField = ReturnType<typeof useAmountField>;

/**
 * The state of the big amount field, ported from the onramp sample app. The
 * keypad and the hidden input share one commit path. On a touch device the
 * native keyboard types into the hidden input; elsewhere the keypad does.
 */
export function useAmountField({
  amount,
  onAmountChange,
  container,
  enabled,
}: UseAmountFieldOptions) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const keypadRef = React.useRef<HTMLDivElement>(null);
  const amountBtnRef = React.useRef<HTMLButtonElement>(null);
  const clearTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [focused, setFocused] = React.useState(false);
  const [shakeKey, setShakeKey] = React.useState(0);
  const [keypadRequested, setKeypadRequested] = React.useState(false);
  const [keypadHeight, setKeypadHeight] = React.useState(0);
  const [isTouch, setIsTouch] = React.useState(false);
  const [enteringIndices, setEnteringIndices] = React.useState<Set<number>>(new Set());

  const keypadOpen = keypadRequested && enabled;
  const active = enabled && (focused || keypadOpen);
  const isZero = !amount || (Number.parseFloat(amount) || 0) === 0;
  const display = formatAmountInput(amount);
  const charKeys = React.useMemo(() => amountCharKeys(display), [display]);

  React.useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const sync = () => setIsTouch(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // The content above shifts up by exactly the keypad's height.
  React.useEffect(() => {
    const el = keypadRef.current;
    if (!el) return;
    const measure = () => setKeypadHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [container, isTouch, enabled]);

  // Stops the native keyboard from lingering over the next screen.
  React.useEffect(() => {
    if (!enabled) inputRef.current?.blur();
  }, [enabled]);

  // Click, not pointerdown, so the clicked control fires before layout moves.
  React.useEffect(() => {
    if (!keypadOpen) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (keypadRef.current?.contains(t) || amountBtnRef.current?.contains(t)) return;
      setKeypadRequested(false);
      inputRef.current?.blur();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [keypadOpen]);

  React.useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const activate = () => {
    if (!enabled) return;
    // Scrolling the sr-only input into view jerks the header.
    inputRef.current?.focus({ preventScroll: true });
    if (!isTouch) setKeypadRequested(true);
  };

  const deactivate = () => {
    setKeypadRequested(false);
    inputRef.current?.blur();
  };

  const shake = () => setShakeKey((k) => k + 1);

  const commit = (next: string, shouldShake: boolean) => {
    if (shouldShake) setShakeKey((k) => k + 1);

    const added = countDigits(next) - countDigits(amount);
    if (added > 0) {
      setEnteringIndices(trailingDigitIndices(formatAmountInput(next), added));
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setEnteringIndices(new Set()), POP_MS);
    }

    onAmountChange(next);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { next, shake: s } = sanitizeAmount(e.target.value);
    commit(next, s);
  };

  const applyKey = (key: string) => {
    if (key === "back") {
      commit(amount.slice(0, -1), false);
      return;
    }
    const { next, shake: s } = sanitizeAmount(amount + key);
    commit(next, s);
  };

  return {
    inputRef,
    keypadRef,
    amountBtnRef,
    setFocused,
    active,
    isTouch,
    keypadOpen,
    keypadHeight,
    display,
    charKeys,
    isZero,
    enteringIndices,
    shakeKey,
    activate,
    deactivate,
    shake,
    handleChange,
    applyKey,
  };
}
