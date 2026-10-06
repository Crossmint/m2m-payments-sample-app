import { describe, expect, it } from "vitest";
import { chainFor, CLOSED_LOOP_TOKEN, explorerUrl, tokenInfo, x402Network } from "../src/token.js";

describe("the credits token", () => {
  it("never names the underlying asset in the user-facing fields", () => {
    const t = tokenInfo("staging");
    expect(t.symbol).toBe("CRED");
    expect(t.name).toBe("Credits");
    expect(t.symbol).not.toMatch(/usdc/i);
    expect(t.name).not.toMatch(/usdc/i);
  });

  it("puts staging on Base Sepolia and production on Base", () => {
    expect(chainFor("staging")).toBe("base-sepolia");
    expect(chainFor("production")).toBe("base");
    expect(tokenInfo("staging").underlying.locator).toBe(
      "base-sepolia:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    );
    expect(tokenInfo("production").underlying.symbol).toBe("USDC");
  });

  it("derives the x402 network id and explorer links from the environment", () => {
    expect(x402Network("staging")).toBe("eip155:84532");
    expect(x402Network("production")).toBe("eip155:8453");
    expect(explorerUrl("staging", "tx", "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
    expect(explorerUrl("production", "address", "0xabc")).toBe(
      "https://basescan.org/address/0xabc",
    );
  });

  it("has six decimals, like the asset behind it", () => {
    expect(CLOSED_LOOP_TOKEN.decimals).toBe(6);
  });
});
