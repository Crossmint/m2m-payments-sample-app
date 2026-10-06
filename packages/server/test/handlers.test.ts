import { describe, expect, it, vi } from "vitest";
import { call, makeServer, onrampOrder, SIGNER_LOCATOR, WALLET_ADDRESS } from "./helpers.js";

describe("auth", () => {
  it("rejects a missing bearer token", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "GET", "/v1/me", { auth: null });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
  });

  it("returns the user for a good token", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "GET", "/v1/me");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user-test-1", email: "a@b.c" });
  });
});

describe("GET /v1/config", () => {
  it("needs no auth and carries the token and the demo endpoints", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "GET", "/v1/config", { auth: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      name: "M2M Payments",
      apiBaseUrl: "https://wallet.test/api/m2m-payments",
      webBaseUrl: "https://wallet.test",
      crossmintEnvironment: "staging",
      token: { symbol: "CRED", name: "Credits", decimals: 6, chain: "base-sepolia" },
      demo: { x402Url: "https://wallet.test/api/demo/x402/inference" },
      auth: {
        provider: "stytch",
        projectId: "project-test-123",
        environment: "test",
        oauth: {
          authorizationEndpoint: "https://wallet.test/oauth/authorize",
          tokenEndpoint: "https://test.stytch.com/v1/public/project-test-123/oauth2/token",
          cliClientId: "connected-app-cli",
          scopes: ["openid", "email", "profile", "offline_access", "full_access"],
        },
      },
    });
    expect(body.token.underlying.symbol).toBe("USDC");
  });
});

describe("router", () => {
  it("404s unknown routes and paths without /v1/", async () => {
    const { handlers } = makeServer();
    const a = await call(handlers, "GET", "/v1/nope");
    expect(a.status).toBe(404);
    const b = await handlers.GET(new Request("https://wallet.test/api/m2m-payments/health"));
    expect(b.status).toBe(404);
  });

  it("405s a known path with the wrong method", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "DELETE", "/v1/me");
    expect(res.status).toBe(405);
  });
});

describe("GET /v1/wallet", () => {
  it("returns 404 wallet_not_found until the browser has created the wallet", async () => {
    const { handlers } = makeServer([], {}, { wallets: new Set() });
    const res = await call(handlers, "GET", "/v1/wallet");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("wallet_not_found");
  });

  it("shows agent access none with no request and no signer", async () => {
    const { handlers } = makeServer([], {}, { balance: "12.5" });
    const res = await call(handlers, "GET", "/v1/wallet");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      address: WALLET_ADDRESS,
      chain: "base-sepolia",
      token: expect.objectContaining({ symbol: "CRED" }),
      balance: { value: "12.50", currency: "CRED" },
      agentAccess: { status: "none" },
      explorerUrl: `https://sepolia.basescan.org/address/${WALLET_ADDRESS}`,
    });
  });

  it("shows pending with the open request while the user has not answered", async () => {
    const { handlers } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: { requester: "Claude Code" } })
    ).json();
    const body = await (await call(handlers, "GET", "/v1/wallet")).json();
    expect(body.agentAccess).toEqual({
      status: "pending",
      requestId: created.id,
      approvalUrl: `https://wallet.test/approve/${created.id}`,
    });
  });

  it("shows active once the signer is approved and recorded, and revoked after revocation", async () => {
    const { handlers, wallets } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: {} })
    ).json();
    await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    wallets.approved.add(SIGNER_LOCATOR);
    await call(handlers, "POST", `/v1/access-requests/${created.id}/confirm`);

    const active = await (await call(handlers, "GET", "/v1/wallet")).json();
    expect(active.agentAccess).toMatchObject({ status: "active", signerLocator: SIGNER_LOCATOR });
    expect(typeof active.agentAccess.grantedAt).toBe("string");

    const revoke = await call(handlers, "POST", "/v1/wallet/access/revoke");
    expect(await revoke.json()).toEqual({
      signerLocator: SIGNER_LOCATOR,
      transactionId: "tx_remove_1",
    });

    // Not done in the browser yet: the view is unchanged.
    const still = await (await call(handlers, "POST", "/v1/wallet/access/revoked")).json();
    expect(still.agentAccess.status).toBe("active");

    wallets.approved.delete(SIGNER_LOCATOR);
    const revoked = await (await call(handlers, "POST", "/v1/wallet/access/revoked")).json();
    expect(revoked.agentAccess).toMatchObject({ status: "revoked", signerLocator: SIGNER_LOCATOR });
    expect(typeof revoked.agentAccess.revokedAt).toBe("string");
  });

  it("serves the balance and the activity feed", async () => {
    const activity = [
      {
        id: "t1",
        direction: "in" as const,
        amount: { value: "5.00", currency: "CRED" },
        hash: "0xh",
        completedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const { handlers } = makeServer([], {}, { balance: "5", activity });
    const balance = await (await call(handlers, "GET", "/v1/wallet/balance")).json();
    expect(balance).toMatchObject({
      balance: { value: "5.00", currency: "CRED" },
      address: WALLET_ADDRESS,
      token: { symbol: "CRED" },
    });
    const feed = await (await call(handlers, "GET", "/v1/wallet/activity?limit=10")).json();
    expect(feed).toEqual({ activity });
  });
});

describe("access requests", () => {
  it("creates a pending request with an approval url and a 15 minute window", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "POST", "/v1/access-requests", {
      body: { reason: "Pay research APIs", requester: "Claude Code" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^acs_[A-Za-z0-9_-]{21}$/);
    expect(body).toMatchObject({
      userId: "user-test-1",
      requester: "Claude Code",
      reason: "Pay research APIs",
      status: "pending",
      approvalUrl: `https://wallet.test/approve/${body.id}`,
    });
    expect(Date.parse(body.requestExpiresAt) - Date.parse(body.createdAt)).toBeCloseTo(
      15 * 60_000,
      -3,
    );
    const got = await (await call(handlers, "GET", `/v1/access-requests/${body.id}`)).json();
    expect(got.status).toBe("pending");
  });

  it("returns a pending request past its window as expired and refuses to approve it", async () => {
    const { handlers } = makeServer([], { requestTtlMinutes: 0 });
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: {} })
    ).json();
    const got = await (await call(handlers, "GET", `/v1/access-requests/${created.id}`)).json();
    expect(got.status).toBe("expired");
    const approve = await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    expect(approve.status).toBe(409);
    expect((await approve.json()).error.code).toBe("expired");
  });

  it("runs approve, then confirm once the email code went through", async () => {
    const { handlers, wallets, store } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: { requester: "Claude Code" } })
    ).json();

    const approve = await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    expect(approve.status).toBe(200);
    const approved = await approve.json();
    expect(approved).toEqual({
      request: expect.objectContaining({ status: "approved", signerLocator: SIGNER_LOCATOR }),
      signerLocator: SIGNER_LOCATOR,
      signatureId: "sig_1",
    });

    // The code has not been typed yet.
    const early = await call(handlers, "POST", `/v1/access-requests/${created.id}/confirm`);
    expect(early.status).toBe(409);
    const earlyBody = await early.json();
    expect(earlyBody.error.code).toBe("access_pending");
    expect(earlyBody.error.details).toEqual({
      requestId: created.id,
      approvalUrl: `https://wallet.test/approve/${created.id}`,
    });

    wallets.approved.add(SIGNER_LOCATOR);
    const confirm = await call(handlers, "POST", `/v1/access-requests/${created.id}/confirm`);
    expect(confirm.status).toBe(200);
    const confirmed = await confirm.json();
    expect(confirmed.request.status).toBe("active");
    expect(confirmed.wallet.agentAccess).toMatchObject({
      status: "active",
      signerLocator: SIGNER_LOCATOR,
    });
    expect(await store.getWalletAccess("user-test-1")).toMatchObject({
      signerLocator: SIGNER_LOCATOR,
    });

    // Approve again is refused once active.
    const again = await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    expect(again.status).toBe(409);
  });

  it("reconciles an approved request to active on the agent's poll", async () => {
    const { handlers, wallets } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: {} })
    ).json();
    await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    // The browser closed before calling confirm.
    wallets.approved.add(SIGNER_LOCATOR);
    const polled = await (await call(handlers, "GET", `/v1/access-requests/${created.id}`)).json();
    expect(polled.status).toBe("active");
    const wallet = await (await call(handlers, "GET", "/v1/wallet")).json();
    expect(wallet.agentAccess.status).toBe("active");
  });

  it("answers 200 with an active request when access is already active", async () => {
    const { handlers, wallets } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: {} })
    ).json();
    await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
    wallets.approved.add(SIGNER_LOCATOR);
    await call(handlers, "POST", `/v1/access-requests/${created.id}/confirm`);

    const res = await call(handlers, "POST", "/v1/access-requests", {
      body: { requester: "ChatGPT" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      status: "active",
      signerLocator: SIGNER_LOCATOR,
      requester: "ChatGPT",
    });
    expect(body.id).not.toBe(created.id);
    const got = await (await call(handlers, "GET", `/v1/access-requests/${body.id}`)).json();
    expect(got.status).toBe("active");
  });

  it("denies a pending request and refuses to deny it twice", async () => {
    const { handlers } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/access-requests", { body: {} })
    ).json();
    const denied = await (
      await call(handlers, "POST", `/v1/access-requests/${created.id}/deny`)
    ).json();
    expect(denied.status).toBe("denied");
    const again = await call(handlers, "POST", `/v1/access-requests/${created.id}/deny`);
    expect(again.status).toBe(409);
    expect((await again.json()).error.code).toBe("invalid_request");
  });

  it("hides another user's request", async () => {
    const { handlers, store } = makeServer();
    await store.createAccessRequest({
      id: "acs_other",
      userId: "user-test-2",
      requester: "Agent",
      requestExpiresAt: "2099-01-01T00:00:00.000Z",
      status: "pending",
      approvalUrl: "https://wallet.test/approve/acs_other",
    });
    const res = await call(handlers, "GET", "/v1/access-requests/acs_other");
    expect(res.status).toBe(403);
  });
});

describe("top-up requests", () => {
  it("creates a pending request from a bare amount, in credits", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "POST", "/v1/top-up-requests", {
      body: { amount: "10", reason: "40 research calls", requester: "Claude Code" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^tup_[A-Za-z0-9_-]{21}$/);
    expect(body).toMatchObject({
      amount: { value: "10.00", currency: "CRED" },
      reason: "40 research calls",
      requester: "Claude Code",
      status: "pending",
      approvalUrl: `https://wallet.test/top-up/${body.id}`,
    });
  });

  it("accepts an Amount object and rejects zero", async () => {
    const { handlers } = makeServer();
    const ok = await call(handlers, "POST", "/v1/top-up-requests", {
      body: { amount: { value: "2.50", currency: "CRED" } },
    });
    expect((await ok.json()).amount).toEqual({ value: "2.50", currency: "CRED" });
    const bad = await call(handlers, "POST", "/v1/top-up-requests", { body: { amount: "0" } });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("invalid_request");
  });

  it("denies while pending", async () => {
    const { handlers } = makeServer();
    const created = await (
      await call(handlers, "POST", "/v1/top-up-requests", { body: { amount: "5" } })
    ).json();
    const denied = await (
      await call(handlers, "POST", `/v1/top-up-requests/${created.id}/deny`)
    ).json();
    expect(denied.status).toBe("denied");
  });
});

describe("top-ups", () => {
  /** A fake order whose statuses flip once it is paid. */
  function orderRoutes() {
    let paid = false;
    return {
      routes: [
        {
          method: "POST",
          path: /\/2022-06-09\/orders$/,
          reply: { status: 201, body: onrampOrder() },
        },
        {
          method: "POST",
          path: "/2022-06-09/orders/order_1/payment",
          reply: () => {
            paid = true;
            return { body: { status: "ok" } };
          },
        },
        {
          method: "GET",
          path: "/2022-06-09/orders/order_1",
          reply: () => ({
            body: paid
              ? onrampOrder({
                  phase: "completed",
                  paymentStatus: "completed",
                  deliveryStatus: "completed",
                })
              : onrampOrder(),
          }),
        },
      ],
    };
  }

  it("creates the order for the wallet, pays it with the user JWT, and completes the request once", async () => {
    const { handlers, calls } = makeServer(orderRoutes().routes);
    const request = await (
      await call(handlers, "POST", "/v1/top-up-requests", {
        body: { amount: "10", reason: "Calls" },
      })
    ).json();

    const created = await call(handlers, "POST", "/v1/top-ups", {
      body: { amount: "10.00", requestId: request.id },
    });
    expect(created.status).toBe(201);
    const view = await created.json();
    expect(view).toMatchObject({
      orderId: "order_1",
      requestId: request.id,
      phase: "awaiting-payment",
      quote: {
        receive: { value: "10.00", currency: "CRED" },
        fees: "0.50",
        total: "10.50",
        currency: "USD",
      },
      clientSecret: "cs_1",
    });
    const create = calls.find((c) => c.method === "POST")!;
    expect(create.headers).toEqual({
      Accept: "application/json",
      "X-API-KEY": "sk_test",
      "Content-Type": "application/json",
    });
    expect(create.body).toMatchObject({
      recipient: { walletAddress: WALLET_ADDRESS },
      lineItems: { executionParameters: { mode: "exact-out", amount: "10.00" } },
      payment: { method: "card", receiptEmail: "a@b.c" },
    });
    const linked = await (await call(handlers, "GET", `/v1/top-up-requests/${request.id}`)).json();
    expect(linked).toMatchObject({ status: "paying", orderId: "order_1" });

    const paid = await call(handlers, "POST", "/v1/top-ups/order_1/pay", {
      body: { paymentMethodId: "pm_1" },
    });
    expect(paid.status).toBe(200);
    expect((await paid.json()).phase).toBe("completed");
    const pay = calls.find((c) => c.path.endsWith("/payment"))!;
    expect(pay.headers).toMatchObject({ "X-API-KEY": "ck_test", Authorization: "Bearer good" });
    expect(pay.body).toEqual({ type: "crossmint-payment-method", id: "pm_1" });

    const polled = await (await call(handlers, "GET", "/v1/top-ups/order_1")).json();
    expect(polled.phase).toBe("completed");
    await call(handlers, "GET", "/v1/top-ups/order_1");

    const done = await (await call(handlers, "GET", `/v1/top-up-requests/${request.id}`)).json();
    expect(done).toMatchObject({
      status: "completed",
      received: { value: "10.00", currency: "CRED" },
    });

    const { payments } = await (await call(handlers, "GET", "/v1/payments")).json();
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({
      kind: "top-up",
      status: "succeeded",
      amount: { value: "10.00", currency: "CRED" },
      counterparty: "pm_1",
      description: "Calls",
    });
  });

  it("hides another user's order and 404s unknown ones", async () => {
    const { handlers, store } = makeServer();
    await store.linkTopUpOrder({
      orderId: "order_x",
      userId: "user-test-2",
      amount: { value: "1.00", currency: "CRED" },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    expect((await call(handlers, "GET", "/v1/top-ups/order_x")).status).toBe(403);
    expect((await call(handlers, "GET", "/v1/top-ups/order_nope")).status).toBe(404);
  });

  it("seeds the staging identity once per user before the first order", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const { handlers, calls } = makeServer(
      [
        { method: "PUT", path: "/legal-documents", reply: { body: {} } },
        { method: "PUT", path: "/identity-verification", reply: { body: {} } },
        { method: "PUT", path: "/2025-06-09/users/", reply: { body: {} } },
        {
          method: "GET",
          path: "/identity-verification",
          reply: { body: { eligibility: [{ type: "onramp-light", status: "approved" }] } },
        },
        { method: "POST", path: /\/orders$/, reply: { status: 201, body: onrampOrder() } },
      ],
      { stagingIdentityFixture: true },
    );
    await call(handlers, "POST", "/v1/top-ups", { body: { amount: "10" } });
    await call(handlers, "POST", "/v1/top-ups", { body: { amount: "10" } });
    const identity = calls.filter((c) => c.path.includes("/2025-06-09/users/"));
    expect(identity).toHaveLength(4);
    expect(
      identity.find((c) => c.path.endsWith("/users/userId%3Auser-test-1"))?.body,
    ).toMatchObject({
      kycData: { email: "a@b.c" },
    });
    expect(calls.filter((c) => c.path.endsWith("/orders"))).toHaveLength(2);
    vi.restoreAllMocks();
  });
});

describe("agent payments", () => {
  it("x402 answers 403 access_required with a fresh approval url when the agent has no access", async () => {
    const { handlers } = makeServer();
    const res = await call(handlers, "POST", "/v1/payments/x402", {
      body: { url: "https://api.example.com/search", requester: "Claude Code" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("access_required");
    expect(body.error.details.requestId).toMatch(/^acs_/);
    expect(body.error.details.approvalUrl).toBe(
      `https://wallet.test/approve/${body.error.details.requestId}`,
    );

    // The same pending request is reused on the next call, and the wallet shows it.
    const again = await (
      await call(handlers, "POST", "/v1/payments/mpp", {
        body: { url: "https://api.example.com/x" },
      })
    ).json();
    expect(again.error.details.requestId).toBe(body.error.details.requestId);
    const wallet = await (await call(handlers, "GET", "/v1/wallet")).json();
    expect(wallet.agentAccess).toMatchObject({
      status: "pending",
      requestId: body.error.details.requestId,
    });
    const request = await (
      await call(handlers, "GET", `/v1/access-requests/${body.error.details.requestId}`)
    ).json();
    expect(request.requester).toBe("Claude Code");
  });

  it("x402 answers 402 insufficient_funds on an empty wallet before touching the endpoint", async () => {
    const { handlers, wallets } = makeServer([], {}, { approved: new Set([SIGNER_LOCATOR]) });
    await grantAccess(handlers, wallets);
    const res = await call(handlers, "POST", "/v1/payments/x402", {
      body: { url: "https://api.example.com/search", maxAmount: "0.10" },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe("insufficient_funds");
    expect(body.error.details).toEqual({
      balance: { value: "0.00", currency: "CRED" },
      required: { value: "0.10", currency: "CRED" },
    });
  });

  it("transfer sends credits with the agent signer and records a payment", async () => {
    const { handlers, wallets } = makeServer(
      [],
      {},
      { balance: "20", approved: new Set([SIGNER_LOCATOR]) },
    );
    await grantAccess(handlers, wallets);
    const to = "0x2222222222222222222222222222222222222222";
    const res = await call(handlers, "POST", "/v1/transfers", {
      body: { to, amount: "5.00", memo: "Refund", requester: "Claude Code" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      hash: "0xsendhash",
      explorerUrl: "https://sepolia.basescan.org/tx/0xsendhash",
      transactionId: "tx_send_1",
      payment: {
        kind: "transfer",
        status: "succeeded",
        amount: { value: "5.00", currency: "CRED" },
        counterparty: to,
        description: "Refund",
        hash: "0xsendhash",
        requester: "Claude Code",
      },
    });
    expect(body.payment.id).toMatch(/^pay_/);
    expect(wallets.sends).toEqual([{ to, amount: "5.00" }]);
    expect(wallets.calls).toContain("asAgent");

    const { payments } = await (await call(handlers, "GET", "/v1/payments?kind=transfer")).json();
    expect(payments).toHaveLength(1);
    expect(payments[0].id).toBe(body.payment.id);
    const none = await (await call(handlers, "GET", "/v1/payments?kind=x402")).json();
    expect(none.payments).toEqual([]);
  });

  it("transfer validates the address and the amount", async () => {
    const { handlers } = makeServer();
    const bad = await call(handlers, "POST", "/v1/transfers", {
      body: { to: "nope", amount: "0" },
    });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.details.issues.length).toBeGreaterThan(0);
  });

  it("transaction sends raw calldata and records a payment without an amount", async () => {
    const { handlers, wallets } = makeServer([], {}, { approved: new Set([SIGNER_LOCATOR]) });
    await grantAccess(handlers, wallets);
    const to = "0x3333333333333333333333333333333333333333";
    const res = await call(handlers, "POST", "/v1/transactions", {
      body: { to, data: "0xdeadbeef", value: "1000" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      hash: "0xtxhash",
      transactionId: "tx_raw_1",
      payment: { kind: "transaction", counterparty: to },
    });
    expect(body.payment.amount).toBeUndefined();
    expect(wallets.transactions).toEqual([{ to, data: "0xdeadbeef", value: 1000n }]);
  });
});

describe("payment methods", () => {
  it("lists the user's saved cards with the client key and the user JWT", async () => {
    const cardsBody = [
      {
        paymentMethodId: "pm_1",
        type: "card",
        card: { brand: "visa", last4: "4242" },
        default: true,
      },
    ];
    const { handlers, calls } = makeServer([
      { method: "GET", path: "/unstable/payment-methods", reply: { body: cardsBody } },
      { method: "DELETE", path: "/unstable/payment-methods/pm_1", reply: { status: 204 } },
    ]);
    const res = await call(handlers, "GET", "/v1/payment-methods");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ paymentMethods: cardsBody });
    expect(calls[0]!.headers).toMatchObject({
      "X-API-KEY": "ck_test",
      Authorization: "Bearer good",
      Origin: "https://wallet.test",
    });

    const del = await call(handlers, "DELETE", "/v1/payment-methods/pm_1");
    expect(del.status).toBe(204);
  });

  it("maps a Crossmint 401 to unauthorized and a 500 to crossmint_error", async () => {
    const { handlers } = makeServer([
      {
        method: "GET",
        path: "/unstable/payment-methods",
        reply: { status: 401, body: { message: "bad jwt" } },
      },
      {
        method: "DELETE",
        path: "/unstable/payment-methods",
        reply: { status: 500, body: { message: "boom" } },
      },
    ]);
    const res = await call(handlers, "GET", "/v1/payment-methods");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("unauthorized");
    const del = await call(handlers, "DELETE", "/v1/payment-methods/pm_1");
    expect(del.status).toBe(502);
    expect((await del.json()).error).toMatchObject({
      code: "crossmint_error",
      message: "boom",
      details: { status: 500, body: { message: "boom" } },
    });
  });
});

/** Run the approve and confirm flow so the wallet_access row exists. The fake already reports the signer approved. */
async function grantAccess(
  handlers: ReturnType<typeof makeServer>["handlers"],
  wallets: ReturnType<typeof makeServer>["wallets"],
) {
  wallets.approved.add(SIGNER_LOCATOR);
  const created = await (await call(handlers, "POST", "/v1/access-requests", { body: {} })).json();
  await call(handlers, "POST", `/v1/access-requests/${created.id}/approve`);
  const confirm = await call(handlers, "POST", `/v1/access-requests/${created.id}/confirm`);
  if (confirm.status !== 200) throw new Error(`grantAccess failed: ${await confirm.text()}`);
}
