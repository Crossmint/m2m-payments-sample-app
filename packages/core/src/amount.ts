import { CLOSED_LOOP_TOKEN, CREDITS } from "./token.js";
import type { Amount } from "./types.js";

/** Format a decimal string amount for humans: "25.00" + "USD" → "$25.00". Credits read "25.00 CRED". */
export function formatAmount(value: string | number, currency: string, locale = "en-US"): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(n)) return `${value} ${currency}`;
  if (currency.toUpperCase() === CREDITS) return formatCredits(n);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/**
 * Credits for humans: "12.50 CRED". Two decimals unless the amount is under a
 * cent, when the price of one API call would otherwise round to nothing.
 */
export function formatCredits(value: string | number, opts: { symbol?: boolean } = {}): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (Number.isNaN(n)) return `${value} ${CREDITS}`;
  const decimals = n !== 0 && Math.abs(n) < 0.01 ? Math.min(6, CLOSED_LOOP_TOKEN.decimals) : 2;
  const text = n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
  return opts.symbol === false ? text : `${text} ${CREDITS}`;
}

/** An `Amount` in credits from a bare decimal. */
export function credits(value: string | number): Amount {
  return { value: toDecimalString(value, CLOSED_LOOP_TOKEN.decimals), currency: CREDITS };
}

/** Normalize user input like "50", "50.5", "$50" into a decimal string with at most `decimals` places. */
export function toDecimalString(input: string | number, decimals = 2): string {
  const cleaned = typeof input === "number" ? String(input) : input.replace(/[^0-9.-]/g, "");
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount: ${input}`);
  // Trim trailing zeros past two places: "0.050000" → "0.05", "10.000000" → "10.00".
  const fixed = n.toFixed(decimals);
  const [whole, frac = ""] = fixed.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(2, "0");
  return `${whole}.${trimmed}`;
}

/** "0.05" credits → 50000n base units, at the token's decimals. */
export function creditsToUnits(
  value: string | number,
  decimals: number = CLOSED_LOOP_TOKEN.decimals,
): bigint {
  const text = typeof value === "number" ? value.toFixed(decimals) : value;
  const [whole = "0", frac = ""] = text.replace(/[^0-9.]/g, "").split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0");
}

/** 50000n base units → "0.05" credits. */
export function unitsToCredits(
  units: bigint | string,
  decimals: number = CLOSED_LOOP_TOKEN.decimals,
): string {
  const n = typeof units === "bigint" ? units : BigInt(units);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const whole = abs / 10n ** BigInt(decimals);
  const frac = (abs % 10n ** BigInt(decimals)).toString().padStart(decimals, "0");
  return `${negative ? "-" : ""}${whole}.${frac.replace(/0+$/, "").padEnd(2, "0")}`;
}

/** Compare two decimal strings. Negative when a < b. */
export function compareDecimal(
  a: string,
  b: string,
  decimals: number = CLOSED_LOOP_TOKEN.decimals,
): number {
  const x = creditsToUnits(a, decimals);
  const y = creditsToUnits(b, decimals);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** ISO timestamp `hours` from now. */
export function expiresInHours(hours: number, from = new Date()): string {
  return new Date(from.getTime() + hours * 3_600_000).toISOString();
}

/** ISO timestamp `minutes` from now. */
export function expiresInMinutes(minutes: number, from = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}
