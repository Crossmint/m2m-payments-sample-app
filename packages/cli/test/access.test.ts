import { describe, expect, it } from "vitest";
import type { AccessRequest, TopUpRequest, WalletView } from "@m2m-payments/core";
import { runCli } from "../src/program.js";
import { EXIT } from "../src/output.js";
import { fakeFetch, json, testContext } from "./helpers.js";

function request(overrides: Partial<AccessRequest> = {}): AccessRequest {
  const now = new Date();
  return {
    id: "acs_123",
    userId: "u1",
    requester: "Claude Code",
    reason: "Research API calls",
    requestExpiresAt: new Date(now.getTime() + 900_000).toISOString(),
    status: "pending",
    approvalUrl: "https://wallet.test/approve/acs_123",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

const token = {
  symbol: "CRED",
  name: "Credits",
  decimals: 6,
  chain: "base-sepolia",
  underlying: { symbol: "USDC", address: "0x036C", locator: "base-sepolia:0x036C" },
};

function wallet(overrides: Partial<WalletView> = {}): WalletView {
  return {
    address: "0x1111111111111111111111111111111111111111",
    chain: "base-sepolia",
    token,
    balance: { value: "12.50", currency: "CRED" },
    agentAccess: { status: "none" },
    explorerUrl: "https://sepolia.basescan.org/address/0x1111",
    ...overrides,
  };
}

describe("m2m-payments access request", () => {
  it("posts reason and requester and prints the approval URL, exit 2", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /v1/access-requests": (call) => json(request({ ...(call.body as object) }), 201),
    });
    const t = testContext({ fetch, env: { CLAUDECODE: "1" } });
    const code = await runCli(["access", "request", "--reason", "Research API calls"], t.overrides);
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    expect(calls[0]?.url).toBe("https://wallet.test/api/m2m-payments/v1/access-requests");
    expect(calls[0]?.headers.authorization).toBe("Bearer access-1");
    expect(calls[0]?.body).toEqual({ reason: "Research API calls", requester: "Claude Code" });
    const out = t.stdout.join("\n");
    expect(out).toContain("Open this link to approve:");
    expect(out).toContain("https://wallet.test/approve/acs_123");
  });

  it("exits 0 at once when access is already active", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/access-requests": () =>
        json(request({ status: "active", signerLocator: "server:0xabc" }), 200),
    });
    const t = testContext({ fetch });
    const code = await runCli(["access", "request", "--json"], t.overrides);
    expect(code).toBe(EXIT.OK);
    expect(JSON.parse(t.stdout.join("\n"))).toMatchObject({ status: "active" });
  });

  it("--wait polls every 2s until active", async () => {
    let polls = 0;
    const sleeps: number[] = [];
    const { fetch } = fakeFetch({
      "POST /v1/access-requests": () => json(request(), 201),
      "GET /v1/access-requests/acs_123": () => {
        polls += 1;
        return json(
          polls < 3
            ? request({ status: polls === 1 ? "pending" : "approved" })
            : request({ status: "active", signerLocator: "server:0xabc" }),
        );
      },
    });
    const t = testContext({ fetch });
    t.overrides.sleep = async (ms) => {
      sleeps.push(ms);
    };
    const code = await runCli(["access", "request", "--wait"], t.overrides);
    expect(code).toBe(EXIT.OK);
    expect(polls).toBe(3);
    expect(sleeps).toEqual([2000, 2000, 2000]);
    const out = t.stdout.join("\n");
    expect(out).toContain("https://wallet.test/approve/acs_123");
    expect(out).toContain("Approved.");
    expect(out).toContain("server:0xabc");
    expect(t.stderr.join("\n")).toContain("Status: approved");
  });

  it("--wait exits 1 when the user denies, and does not ask again", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /v1/access-requests": () => json(request(), 201),
      "GET /v1/access-requests/acs_123": () => json(request({ status: "denied" })),
    });
    const t = testContext({ fetch });
    expect(await runCli(["access", "request", "--wait"], t.overrides)).toBe(EXIT.ERROR);
    expect(t.stderr.join("\n")).toContain("denied");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("--wait --timeout exits 2 with the URL when the user has not answered", async () => {
    let now = 1_000_000;
    const { fetch } = fakeFetch({
      "POST /v1/access-requests": () => json(request(), 201),
      "GET /v1/access-requests/acs_123": () => json(request()),
    });
    const t = testContext({ fetch });
    t.overrides.now = () => now;
    t.overrides.sleep = async (ms) => {
      now += ms;
    };
    const code = await runCli(["access", "request", "--wait", "--timeout", "5"], t.overrides);
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    expect(t.stderr.join("\n")).toContain("m2m-payments access status acs_123 --wait");
  });
});

describe("m2m-payments access status", () => {
  it("exits 2 while pending, 0 when active, 1 when expired", async () => {
    const { fetch } = fakeFetch({
      "GET /v1/access-requests/p": () => json(request({ id: "p" })),
      "GET /v1/access-requests/a": () => json(request({ id: "a", status: "active" })),
      "GET /v1/access-requests/e": () => json(request({ id: "e", status: "expired" })),
    });
    expect(await runCli(["access", "status", "p"], testContext({ fetch }).overrides)).toBe(
      EXIT.NEEDS_USER_ACTION,
    );
    expect(await runCli(["access", "status", "a"], testContext({ fetch }).overrides)).toBe(EXIT.OK);
    expect(await runCli(["access", "status", "e"], testContext({ fetch }).overrides)).toBe(
      EXIT.ERROR,
    );
  });
});

describe("m2m-payments wallet", () => {
  it("prints address, balance and access, exit 0 when there is nothing to approve", async () => {
    const { fetch } = fakeFetch({ "GET /v1/wallet": () => json(wallet()) });
    const t = testContext({ fetch });
    expect(await runCli(["wallet"], t.overrides)).toBe(EXIT.OK);
    const out = t.stdout.join("\n");
    expect(out).toContain("0x1111111111111111111111111111111111111111");
    expect(out).toContain("12.50 CRED");
    expect(out).toContain("none");
    expect(out).toContain("m2m-payments access request");
  });

  it("exits 2 with the approval URL when access is pending", async () => {
    const { fetch } = fakeFetch({
      "GET /v1/wallet": () =>
        json(
          wallet({
            agentAccess: {
              status: "pending",
              requestId: "acs_5",
              approvalUrl: "https://wallet.test/approve/acs_5",
            },
          }),
        ),
    });
    const t = testContext({ fetch });
    expect(await runCli(["wallet"], t.overrides)).toBe(EXIT.NEEDS_USER_ACTION);
    expect(t.stdout.join("\n")).toContain("https://wallet.test/approve/acs_5");
  });

  it("tells the user to open the app when there is no wallet", async () => {
    const { fetch } = fakeFetch({
      "GET /v1/wallet": () =>
        json({ error: { code: "wallet_not_found", message: "No wallet." } }, 404),
    });
    const t = testContext({ fetch });
    expect(await runCli(["wallet"], t.overrides)).toBe(EXIT.ERROR);
    expect(t.stderr.join("\n")).toContain("open the app once");
  });
});

describe("m2m-payments top-up", () => {
  function topUp(overrides: Partial<TopUpRequest> = {}): TopUpRequest {
    const now = new Date();
    return {
      id: "tup_1",
      userId: "u1",
      requester: "Claude Code",
      amount: { value: "10.00", currency: "CRED" },
      requestExpiresAt: new Date(now.getTime() + 900_000).toISOString(),
      status: "pending",
      approvalUrl: "https://wallet.test/top-up/tup_1",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      ...overrides,
    };
  }

  it("request sends the amount as a decimal string and exits 2 with the URL", async () => {
    const { fetch, calls } = fakeFetch({
      "POST /v1/top-up-requests": (call) =>
        json(topUp({ reason: (call.body as { reason?: string }).reason }), 201),
    });
    const t = testContext({ fetch });
    const code = await runCli(
      ["top-up", "request", "--amount", "$10", "--reason", "40 calls"],
      t.overrides,
    );
    expect(code).toBe(EXIT.NEEDS_USER_ACTION);
    expect(calls[0]?.body).toEqual({
      amount: "10.00",
      reason: "40 calls",
      requester: "m2m-payments CLI on testbox",
    });
    expect(t.stdout.join("\n")).toContain("https://wallet.test/top-up/tup_1");
  });

  it("status --wait prints the credits received on completed", async () => {
    let polls = 0;
    const { fetch } = fakeFetch({
      "GET /v1/top-up-requests/tup_1": () => {
        polls += 1;
        return json(
          polls < 2
            ? topUp({ status: "paying", orderId: "ord_1" })
            : topUp({
                status: "completed",
                orderId: "ord_1",
                received: { value: "10.00", currency: "CRED" },
              }),
        );
      },
    });
    const t = testContext({ fetch });
    expect(await runCli(["top-up", "status", "tup_1", "--wait"], t.overrides)).toBe(EXIT.OK);
    expect(t.stdout.join("\n")).toContain("Completed. 10.00 CRED landed in the wallet.");
  });

  it("rejects a bad amount without calling the API", async () => {
    const { fetch, calls } = fakeFetch({});
    const t = testContext({ fetch });
    expect(await runCli(["top-up", "request", "--amount", "-1"], t.overrides)).toBe(EXIT.ERROR);
    expect(calls).toHaveLength(0);
  });
});
