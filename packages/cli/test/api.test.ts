import { describe, expect, it } from "vitest";
import { ApiError, M2mPaymentsApi } from "../src/api.js";
import { createConfigStore } from "../src/config.js";
import { CliExit, EXIT } from "../src/output.js";
import { fakeFetch, json, tempConfigDir } from "./helpers.js";

const base = {
  apiBaseUrl: "https://wallet.test/api/m2m-payments",
  accessToken: "access-1",
  refreshToken: "refresh-1",
  tokenEndpoint: "https://test.stytch.com/v1/public/p/oauth2/token",
  clientId: "cli-app",
  tokenFromEnv: false,
};

describe("M2mPaymentsApi", () => {
  it("adds the bearer header and parses bodies", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /v1/me": () => json({ userId: "u1", email: "a@b.c" }),
    });
    const api = new M2mPaymentsApi({
      config: { ...base, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
      fetch,
    });
    expect(await api.me()).toEqual({ userId: "u1", email: "a@b.c" });
    expect(calls[0]?.headers.authorization).toBe("Bearer access-1");
    expect(calls[0]?.headers.accept).toBe("application/json");
  });

  it("hits the routes from docs/API.md", async () => {
    const { fetch, calls } = fakeFetch({
      "GET /v1/wallet": () => json({ address: "0x1" }),
      "GET /v1/wallet/balance": () => json({ balance: { value: "1.00", currency: "CRED" } }),
      "POST /v1/access-requests": () => json({ id: "acs_1" }, 201),
      "GET /v1/access-requests/acs_1": () => json({ id: "acs_1" }),
      "POST /v1/top-up-requests": () => json({ id: "tup_1" }, 201),
      "GET /v1/top-up-requests/tup_1": () => json({ id: "tup_1" }),
      "POST /v1/payments/x402": () => json({ paid: true }, 201),
      "POST /v1/payments/mpp": () => json({ paid: true }, 201),
      "POST /v1/transfers": () => json({ hash: "0xa" }, 201),
      "POST /v1/transactions": () => json({ hash: "0xb" }, 201),
      "GET /v1/payments": () => json({ payments: [] }),
    });
    const api = new M2mPaymentsApi({ config: base, fetch });
    await api.getWallet();
    await api.getBalance();
    await api.createAccessRequest({ reason: "r" });
    await api.getAccessRequest("acs_1");
    await api.createTopUpRequest({ amount: "10.00" });
    await api.getTopUpRequest("tup_1");
    await api.payX402({ url: "https://a.test" });
    await api.payMpp({ url: "https://a.test" });
    await api.transfer({ to: "0x2", amount: "1.00" });
    await api.sendTransaction({ to: "0x2" });
    await api.listPayments({ limit: 5, kind: "x402" });
    expect(calls.map((c) => `${c.method} ${c.url.slice(c.url.indexOf("/v1/"))}`)).toEqual([
      "GET /v1/wallet",
      "GET /v1/wallet/balance",
      "POST /v1/access-requests",
      "GET /v1/access-requests/acs_1",
      "POST /v1/top-up-requests",
      "GET /v1/top-up-requests/tup_1",
      "POST /v1/payments/x402",
      "POST /v1/payments/mpp",
      "POST /v1/transfers",
      "POST /v1/transactions",
      "GET /v1/payments?limit=5&kind=x402",
    ]);
    expect(calls[4]?.body).toEqual({ amount: "10.00" });
  });

  it("maps the error envelope to ApiError with code, message and exit code", async () => {
    const { fetch } = fakeFetch({
      "POST /v1/payments/x402": () =>
        json(
          {
            error: {
              code: "access_required",
              message: "Not allowed yet",
              details: { requestId: "acs_1", approvalUrl: "https://wallet.test/approve/acs_1" },
            },
          },
          403,
        ),
      "POST /v1/payments/mpp": () =>
        json(
          {
            error: {
              code: "insufficient_funds",
              message: "Short",
              details: {
                balance: { value: "0.01", currency: "CRED" },
                required: { value: "0.05", currency: "CRED" },
              },
            },
          },
          402,
        ),
      "GET /v1/wallet": () => json({ error: { code: "unauthorized", message: "bad token" } }, 401),
      "GET /v1/wallet/balance": () =>
        new Response("<html>boom</html>", { status: 502, statusText: "Bad Gateway" }),
      "POST /v1/transfers": () =>
        json({ error: { code: "invalid_request", message: "bad address" } }, 400),
    });
    const api = new M2mPaymentsApi({ config: base, fetch });

    const access = (await api
      .payX402({ url: "https://a.test" })
      .catch((e: unknown) => e)) as ApiError;
    expect(access).toBeInstanceOf(ApiError);
    expect(access).toMatchObject({
      code: "access_required",
      message: "Not allowed yet",
      status: 403,
      exitCode: EXIT.NEEDS_USER_ACTION,
    });
    expect(access.access?.approvalUrl).toBe("https://wallet.test/approve/acs_1");
    expect(String(access)).toBe("access_required: Not allowed yet");

    const funds = (await api
      .payMpp({ url: "https://a.test" })
      .catch((e: unknown) => e)) as ApiError;
    expect(funds.exitCode).toBe(EXIT.NEEDS_USER_ACTION);
    expect(funds.funds?.required).toEqual({ value: "0.05", currency: "CRED" });

    const unauth = (await api.getWallet().catch((e: unknown) => e)) as ApiError;
    expect(unauth.exitCode).toBe(EXIT.NOT_LOGGED_IN);

    const html = (await api.getBalance().catch((e: unknown) => e)) as ApiError;
    expect(html.code).toBe("http_502");
    expect(html.message).toContain("boom");
    expect(html.exitCode).toBe(EXIT.ERROR);

    const invalid = (await api
      .transfer({ to: "x", amount: "1.00" })
      .catch((e: unknown) => e)) as ApiError;
    expect(invalid.exitCode).toBe(EXIT.ERROR);
  });

  it("refreshes the access token when it is about to expire and persists it", async () => {
    const store = createConfigStore({ M2M_PAYMENTS_CONFIG_DIR: tempConfigDir() });
    const now = Date.now();
    const config = { ...base, expiresAt: new Date(now + 30_000).toISOString() };
    store.write(config);
    const { fetch, calls } = fakeFetch({
      "POST /oauth2/token": () =>
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          token_type: "bearer",
          expires_in: 900,
        }),
      "GET /v1/me": () => json({ userId: "u1" }),
    });
    const api = new M2mPaymentsApi({ config, fetch, store, now: () => now });
    expect(api.needsRefresh()).toBe(true);
    await api.me();
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /v1/public/p/oauth2/token",
      "GET /api/m2m-payments/v1/me",
    ]);
    expect(calls[0]?.body).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-1",
      client_id: "cli-app",
    });
    expect(calls[1]?.headers.authorization).toBe("Bearer access-2");
    const saved = store.read();
    expect(saved).toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    expect(new Date(saved!.expiresAt!).getTime()).toBe(now + 900_000);
    expect(saved).not.toHaveProperty("tokenFromEnv");
    // A second call does not refresh again.
    await api.me();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("does not refresh env tokens, and exits 3 when refresh fails", async () => {
    const { fetch, calls } = fakeFetch({ "GET /v1/me": () => json({ userId: "u1" }) });
    const envApi = new M2mPaymentsApi({
      config: { ...base, tokenFromEnv: true, expiresAt: new Date(0).toISOString() },
      fetch,
    });
    await envApi.me();
    expect(calls).toHaveLength(1);

    const failing = fakeFetch({
      "POST /oauth2/token": () =>
        json({ error: "invalid_grant", error_description: "revoked" }, 400),
    });
    const api = new M2mPaymentsApi({
      config: { ...base, expiresAt: new Date(0).toISOString() },
      fetch: failing.fetch,
    });
    const err = await api.me().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliExit);
    expect((err as CliExit).exitCode).toBe(EXIT.NOT_LOGGED_IN);
    expect((err as CliExit).message).toContain("revoked");
  });

  it("throws not-logged-in without a token", async () => {
    const api = new M2mPaymentsApi({
      config: { apiBaseUrl: "https://x.test", tokenFromEnv: false },
      fetch: fakeFetch({}).fetch,
    });
    const err = await api.me().catch((e: unknown) => e);
    expect((err as CliExit).exitCode).toBe(EXIT.NOT_LOGGED_IN);
  });
});
