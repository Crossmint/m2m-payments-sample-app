/*
 * Pure helpers for `useAmountField`, ported from the onramp sample app. The
 * amount is a raw string of digits with at most one dot; these format it for
 * the display face and clean what the keypad or the native keyboard types.
 */

export const MAX_INT_DIGITS = 6;
export const MAX_DECIMALS = 2;

export const countDigits = (s: string): number => (s.match(/\d/g) ?? []).length;

/** "1200.5" → "1,200.5". Keeps a trailing dot as typed. Empty → "0". */
export function formatAmountInput(raw: string): string {
  if (!raw) return "0";
  const hasDot = raw.includes(".");
  const [int, dec = ""] = raw.split(".");
  const groupedInt = (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return hasDot ? `${groupedInt}.${dec}` : groupedInt;
}

/** The positions of the last `count` digits in a display string, for the pop-in. */
export function trailingDigitIndices(display: string, count: number): Set<number> {
  const indices = new Set<number>();
  let found = 0;
  for (let i = display.length - 1; i >= 0 && found < count; i--) {
    if (/\d/.test(display[i] ?? "")) {
      indices.add(i);
      found++;
    }
  }
  return indices;
}

/** Stable keys per character so shifting commas do not re-animate settled digits. */
export function amountCharKeys(display: string): string[] {
  const keys: string[] = [];
  let digitCount = 0;
  for (const char of display) {
    if (/\d/.test(char)) {
      keys.push(`d${digitCount}`);
      digitCount++;
    } else if (char === ".") {
      keys.push("dot");
    } else {
      keys.push(`sep-${digitCount}`);
    }
  }
  return keys;
}

/** Cleans typed input. `shake` is true when something was clamped or rejected. */
export function sanitizeAmount(input: string): { next: string; shake: boolean } {
  let shake = false;
  const cleaned = input.replace(/[^0-9.]/g, "");
  if ((cleaned.match(/\./g) ?? []).length > 1) shake = true;

  const firstDot = cleaned.indexOf(".");
  const collapsed =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");

  const hasDot = collapsed.includes(".");
  let [int = "", dec = ""] = collapsed.split(".");
  int = int.replace(/^0+(?=\d)/, "");

  if (int.length > MAX_INT_DIGITS) {
    int = int.slice(0, MAX_INT_DIGITS);
    shake = true;
  }
  if (dec.length > MAX_DECIMALS) {
    dec = dec.slice(0, MAX_DECIMALS);
    shake = true;
  }

  return { next: hasDot ? `${int}.${dec}` : int, shake };
}
