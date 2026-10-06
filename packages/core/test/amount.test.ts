import { describe, expect, it } from "vitest";
import {
  compareDecimal,
  credits,
  creditsToUnits,
  formatAmount,
  formatCredits,
  toDecimalString,
  unitsToCredits,
} from "../src/amount.js";

describe("credits arithmetic", () => {
  it("converts credits to base units and back", () => {
    expect(creditsToUnits("0.05")).toBe(50_000n);
    expect(creditsToUnits("10")).toBe(10_000_000n);
    expect(creditsToUnits(1.5)).toBe(1_500_000n);
    expect(unitsToCredits(50_000n)).toBe("0.05");
    expect(unitsToCredits("10000000")).toBe("10.00");
    expect(unitsToCredits(1_234_567n)).toBe("1.234567");
  });

  it("compares decimals without float drift", () => {
    expect(compareDecimal("0.10", "0.1")).toBe(0);
    expect(compareDecimal("0.05", "1.00")).toBeLessThan(0);
    expect(compareDecimal("2", "1.999999")).toBeGreaterThan(0);
  });

  it("normalizes user input", () => {
    expect(toDecimalString("$50")).toBe("50.00");
    expect(toDecimalString("0.050000", 6)).toBe("0.05");
    expect(toDecimalString(10, 6)).toBe("10.00");
    expect(() => toDecimalString("-1")).toThrow();
    expect(() => toDecimalString("abc")).toThrow();
  });

  it("builds credit amounts", () => {
    expect(credits("10")).toEqual({ value: "10.00", currency: "CRED" });
    expect(credits(0.05)).toEqual({ value: "0.05", currency: "CRED" });
  });
});

describe("formatting", () => {
  it("shows credits with the symbol and small prices with enough places", () => {
    expect(formatCredits("12.5")).toBe("12.50 CRED");
    expect(formatCredits("0.005")).toBe("0.005 CRED");
    expect(formatCredits("0.05", { symbol: false })).toBe("0.05");
  });

  it("routes CRED through formatCredits and fiat through Intl", () => {
    expect(formatAmount("10", "CRED")).toBe("10.00 CRED");
    expect(formatAmount("10", "USD")).toBe("$10.00");
  });
});
