import { describe, expect, it } from "vitest";
import { buildPayBody } from "../src/commands/pay.js";
import { parseHeaders } from "../src/commands/shared.js";
import { runCli } from "../src/program.js";
import { EXIT } from "../src/output.js";
import { fakeFetch, json, testContext } from "./helpers.js";

const ctx = { env: { CLAUDECODE: "1" }, hostname: () => "testbox" };

describe("buildPayBody", () => {
  it("turns the flags into the POST body", () => {
    const body = buildPayBody(
      "https://api.test/v1/search",
      {
        method: "post",
        body: '{"q":"x"}',
        header: ["Content-Type: application/json", "x-api-version=2"],
        max: 0.1,
        memo: "market brief",
      },
      ctx,
    );
    expect(body).toEqual({
      url: "https://api.test/v1/search",
      method: "POST",
      headers: { "content-type": "application/json", "x-api-version": "2" },
      body: '{"q":"x"}',
      maxAmount: "0.10",
      memo: "market brief",
      requester: "Claude Code",
    });
  });

  it("defaults to GET, or POST when a body is given, and leaves optional fields out", () => {
    expect(buildPayBody("https://api.test", {}, ctx)).toEqual({
      url: "https://api.test",
      requester: "Claude Code",
    });
    expect(buildPayBody("https://api.test", { body: "{}" }, ctx)).toMatchObject({ method: "POST" });
  });

  it("rejects a header without a name", () => {
    expect(() => parseHeaders([": nope"])).toThrow(/--header/);
    expect(parseHeaders(undefined)).toBeUndefined();
  });
});

describe("m2m-payments pay", () => {
  const paid = {
    payment: {
      id: "pay_1",
      userId: "u1",
      kind: "x402",
      status: "succeeded",
      amount: { value: "0.05", currency: "CRED" },
      counterparty: "api.test",
      hash: "0xabc",
      explorerUrl: "https://sepolia.basescan.org/tx/0xabc",
      createdAt: "2030-01-01T00:00:00.000Z",
    },
    paid: true,
    amount: { value: "0.05", currency: "CRED" },
    settlement: { transaction: "0xabc", network: "eip155:84532" },
    response: {
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"completion":"hello"}',
      truncated: false,
    },
  };

  it("x402 posts the body and prints amount, settlement, status and the response body", async () => {
    const { fetch, calls } = fakeFetch({ "POST /v1/payments/x402": () => json(paid, 201) });
    const t = testContext({ fetch });
    const code = await runCli(
      [
        "pay",
        "x402",
        "https://api.test/v1/search",
        "--body",
        '{"q":"x"}',
        "--header",
        "content-type: application/json",
        "--max",
        "0.10",
        "--memo",
        "brief",
      ],
      t.overrides,
    );
    expect(code).toBe(EXIT.OK);
    expect(calls[0]?.url).toBe("https://wallet.test/api/m2m-payments/v1/payments/x402");
    expect(calls[0]?.body).toEqual({
      url: "https://api.test/v1/search",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"q":"x"}',
      maxAmount: "0.10",
      memo: "brief",
      requester: "m2m-payments CLI on testbox",
    });
    const out = t.stdout.join("\n");
    expect(out).toContain("Paid 0.05 CRED to api.test over x402");
    expect(out).toContain("0xabc");
    expect(out).toContain("https://sepolia.basescan.org/tx/0xabc");
    expect(out).toContain("200");
    expect(out).toContain('{"completion":"hello"}');
  });

  it("mpp prints raw JSON with --json", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/payments/mpp": () =>
        json({ ...paid, payment: { ...paid.payment, kind: "mpp" } }, 201),
    });
    const t = testContext({ fetch });
    const code = await runCli(["pay", "mpp", "https://api.test/v1/infer", "--json"], t.overrides);
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(t.stdout.join("\n"))).toMatchObject({ paid: true, payment: { kind: "mpp" } });
  });

  it("exits 2 and prints the approval URL on access_required", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/payments/x402": () =>
        json(
          {
            error: {
              code: "access_required",
              message: "This agent is not allowed to use the wallet yet.",
              details: { requestId: "acs_9", approvalUrl: "https://wallet.test/approve/acs_9" },
            },
          },
          403,
        ),
    });
    const t = testContext({ fetch });
    const code = await runCli(["pay", "x402", "https://api.test/v1/search"], t.overrides);
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    const err = t.stderr.join("\n");
    expect(err).toContain("access_required");
    expect(err).toContain("https://wallet.test/approve/acs_9");
    expect(err).toContain("m2m-payments access status acs_9 --wait");
  });

  it("exits 2 with balance, required and the top-up hint on insufficient_funds", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/payments/x402": () =>
        json(
          {
            error: {
              code: "insufficient_funds",
              message: "The wallet holds 0.01 CRED and this needs 0.05 CRED.",
              details: {
                balance: { value: "0.01", currency: "CRED" },
                required: { value: "0.05", currency: "CRED" },
              },
            },
          },
          402,
        ),
    });
    const t = testContext({ fetch });
    const code = await runCli(["pay", "x402", "https://api.test/v1/search"], t.overrides);
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    const err = t.stderr.join("\n");
    expect(err).toContain("Balance:  0.01 CRED");
    expect(err).toContain("Required: 0.05 CRED");
    expect(err).toContain("m2m-payments top-up request --amount 0.05");
  });

  it("keeps --json errors as one JSON document, still exit 2", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/payments/mpp": () =>
        json(
          {
            error: {
              code: "access_required",
              message: "nope",
              details: { requestId: "acs_9", approvalUrl: "https://wallet.test/approve/acs_9" },
            },
          },
          403,
        ),
    });
    const t = testContext({ fetch });
    const code = await runCli(["pay", "mpp", "https://api.test", "--json"], t.overrides);
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    expect(JSON.parse(t.stderr.join("\n"))).toMatchObject({
      error: {
        code: "access_required",
        details: { approvalUrl: "https://wallet.test/approve/acs_9" },
      },
    });
  });

  it("exits 3 when there is no session", async () => {
    const { fetch, calls } = fakeFetch({});
    const t = testContext({ fetch, config: null });
    expect(await runCli(["pay", "x402", "https://api.test"], t.overrides)).toBe(EXIT.NOT_LOGGED_IN);
    expect(calls).toHaveLength(0);
    expect(t.stderr.join("\n")).toContain("m2m-payments login");
  });
});
