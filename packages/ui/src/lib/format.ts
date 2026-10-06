import type { Amount, PaymentKind, PaymentMethod } from "@m2m-payments/core";
import { formatAmount, formatCredits } from "@m2m-payments/core";

export { formatAmount, formatCredits };

/** "Visa" from "visa", "Mastercard" from "mastercard", "Amex" from "amex". */
export function cardBrandLabel(brand: string | undefined): string {
  if (!brand) return "Card";
  const b = brand.toLowerCase();
  const known: Record<string, string> = {
    visa: "Visa",
    mastercard: "Mastercard",
    master: "Mastercard",
    amex: "Amex",
    "american-express": "Amex",
    american_express: "Amex",
    discover: "Discover",
    diners: "Diners",
    jcb: "JCB",
    unionpay: "UnionPay",
    maestro: "Maestro",
  };
  return known[b] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** "Visa •••• 4242" */
export function paymentMethodLabel(pm: PaymentMethod): string {
  if (pm.card) return `${cardBrandLabel(pm.card.brand)} •••• ${pm.card.last4}`;
  return pm.displayName ?? pm.paymentMethodId;
}

/** Short date for expiry lines: "Sep 16, 2026, 3:04 PM". */
export function formatDateTime(iso: string | undefined, locale = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Date only: "Sep 16, 2026". */
export function formatDate(iso: string | undefined, locale = "en-US"): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * How far off a moment is, in words: "in 3 days", "5 hours ago", "2 days ago".
 * The unit is the largest one that still leaves a number at or above one.
 *
 * `now` is a parameter so a caller can pin it. The default reads the clock,
 * which would differ between a server render and the client one.
 */
export function formatRelativeTime(
  iso: string | undefined,
  locale = "en-US",
  now = Date.now(),
): string {
  if (!iso) return "";
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return iso;
  const diff = at - now;
  const size = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (size < MINUTE) return rtf.format(Math.round(diff / 1000), "second");
  if (size < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (size < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (size < WEEK) return rtf.format(Math.round(diff / DAY), "day");
  if (size < MONTH) return rtf.format(Math.round(diff / WEEK), "week");
  if (size < YEAR) return rtf.format(Math.round(diff / MONTH), "month");
  return rtf.format(Math.round(diff / YEAR), "year");
}

/** "0x1234…abcd" from a full address. Short strings pass through. */
export function shortAddress(address: string | undefined, head = 6, tail = 4): string {
  if (!address) return "";
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}

/** What each payment kind is called in a row or a badge. */
export function paymentKindLabel(kind: PaymentKind): string {
  switch (kind) {
    case "x402":
      return "x402";
    case "mpp":
      return "MPP";
    case "transfer":
      return "Transfer";
    case "transaction":
      return "Transaction";
    case "top-up":
      return "Top-up";
    default:
      return String(kind);
  }
}

/**
 * Credits with a sign, for a ledger column: top-ups "+10.00", everything else
 * "−0.05". Unknown amounts are an empty string so the cell can show a dash.
 */
export function formatSignedCredits(amount: Amount | undefined, kind: PaymentKind): string {
  if (!amount) return "";
  const text = formatCredits(amount.value, { symbol: false });
  return kind === "top-up" ? `+${text}` : `−${text}`;
}
