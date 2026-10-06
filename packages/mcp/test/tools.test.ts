import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TOOL_DOCS } from "@m2m-payments/core";
import { createM2mPaymentsMcpServer, M2M_PAYMENTS_TOOL_NAMES } from "../src/index.js";
import { mockM2mPaymentsFetch, TOKEN } from "./helpers.js";

const API = "https://wallet.example.com/api/m2m-payments";

async function connect(fetchImpl: typeof fetch) {
  const server = createM2mPaymentsMcpServer({
    apiBaseUrl: API,
    bearerToken: "tok_1",
    requester: "Test agent",
    fetch: fetchImpl,
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ type: string; text: string }> }).content[0]!.text;
}

const wallet = {
  address: "0x1111111111111111111111111111111111111111",
  chain: "base-sepolia",
  token: TOKEN,
  balance: { value: "12.50", currency: "CRED" },
  agentAccess: { status: "none" },
  explorerUrl: "https://sepolia.basescan.org/address/0x1111111111111111111111111111111111111111",
};

describe("M2M Payments tools", () => {
  it("registers exactly the MCP-surface tools, described from core", async () => {
    const { client } = await connect(mockM2mPaymentsFetch({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...M2M_PAYMENTS_TOOL_NAMES].sort());
    expect(tools.map((t) => t.name)).not.toContain("await_wallet_access");
    // Every description opens with the summary shared with the chat agent (core TOOL_DOCS).
    for (const tool of tools) {
      const doc = TOOL_DOCS[tool.name as keyof typeof TOOL_DOCS];
      expect(tool.description, tool.name).toMatch(
        new RegExp(`^${doc.summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
      );
      expect(tool.title).toBe(doc.title);
    }
  });

  it("get_wallet reads the wallet and tells the agent to ask for access", async () => {
    const { client } = await connect(mockM2mPaymentsFetch({ "GET /v1/wallet": { body: wallet } }));
    const result = await client.callTool({ name: "get_wallet", arguments: {} });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("12.50 CRED");
    expect(text).toContain("request_wallet_access");
    expect(result.structuredContent).toMatchObject({ wallet: { address: wallet.address } });
  });

  it("request_wallet_access posts the request and returns the approval URL", async () => {
    const fetchMock = mockM2mPaymentsFetch({
      "POST /v1/access-requests": (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return {
          id: "acs_123",
          userId: "user-1",
          requester: body.requester,
          reason: body.reason,
          requestExpiresAt: "2030-01-01T00:15:00.000Z",
          status: "pending",
          approvalUrl: "https://wallet.example.com/approve/acs_123",
          createdAt: "2030-01-01T00:00:00.000Z",
          updatedAt: "2030-01-01T00:00:00.000Z",
        };
      },
    });
    const { client } = await connect(fetchMock);
    const result = await client.callTool({
      name: "request_wallet_access",
      arguments: { reason: "Research API calls" },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${API}/v1/access-requests`);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok_1");
    expect(JSON.parse(String(init.body))).toEqual({
      reason: "Research API calls",
      requester: "Test agent",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      requestId: "acs_123",
      approvalUrl: "https://wallet.example.com/approve/acs_123",
      status: "pending",
    });
    const text = textOf(result);
    expect(text).toContain("https://wallet.example.com/approve/acs_123");
    expect(text).toContain("get_access_request");
  });

  it("request_top_up sends the amount as a decimal string in credits", async () => {
    const fetchMock = mockM2mPaymentsFetch({
      "POST /v1/top-up-requests": (init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return {
          id: "tup_1",
          userId: "user-1",
          requester: body.requester,
          amount: { value: body.amount, currency: "CRED" },
          reason: body.reason,
          requestExpiresAt: "2030-01-01T00:15:00.000Z",
          status: "pending",
          approvalUrl: "https://wallet.example.com/top-up/tup_1",
          createdAt: "2030-01-01T00:00:00.000Z",
          updatedAt: "2030-01-01T00:00:00.000Z",
        };
      },
    });
    const { client } = await connect(fetchMock);
    const result = await client.callTool({ name: "request_top_up", arguments: { amount: 10 } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      amount: "10.00",
      requester: "Test agent",
    });
    expect(textOf(result)).toContain("https://wallet.example.com/top-up/tup_1");
    expect(textOf(result)).toContain("get_top_up_request");
  });

  it("pay_x402 on access_required yields an isError result with the approval URL", async () => {
    const { client } = await connect(
      mockM2mPaymentsFetch({
        "POST /v1/payments/x402": {
          status: 403,
          body: {
            error: {
              code: "access_required",
              message: "This agent is not allowed to use the wallet yet.",
              details: {
                requestId: "acs_9",
                approvalUrl: "https://wallet.example.com/approve/acs_9",
              },
            },
          },
        },
      }),
    );
    const result = await client.callTool({
      name: "pay_x402",
      arguments: { url: "https://api.example.com/v1/search", method: "POST", body: "{}" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("access_required");
    expect(text).toContain("https://wallet.example.com/approve/acs_9");
    expect(text).toContain('get_access_request with requestId "acs_9"');
    expect(result.structuredContent).toMatchObject({
      error: { code: "access_required", status: 403, details: { requestId: "acs_9" } },
    });
  });

  it("pay_x402 on insufficient_funds points at request_top_up with the required amount", async () => {
    const { client } = await connect(
      mockM2mPaymentsFetch({
        "POST /v1/payments/x402": {
          status: 402,
          body: {
            error: {
              code: "insufficient_funds",
              message: "The wallet holds 0.01 CRED and this needs 0.05 CRED.",
              details: {
                balance: { value: "0.01", currency: "CRED" },
                required: { value: "0.05", currency: "CRED" },
              },
            },
          },
        },
      }),
    );
    const result = await client.callTool({
      name: "pay_x402",
      arguments: { url: "https://api.example.com/v1/search" },
    });
    expect(result.isError).toBe(true);
    const text = textOf(result);
    expect(text).toContain("request_top_up");
    expect(text).toContain("0.05");
  });

  it("pay_mpp reports what was paid, the settlement and the body", async () => {
    const fetchMock = mockM2mPaymentsFetch({
      "POST /v1/payments/mpp": {
        status: 201,
        body: {
          payment: {
            id: "pay_1",
            userId: "user-1",
            kind: "mpp",
            status: "succeeded",
            amount: { value: "0.05", currency: "CRED" },
            counterparty: "api.example.com",
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
        },
      },
    });
    const { client } = await connect(fetchMock);
    const result = await client.callTool({
      name: "pay_mpp",
      arguments: { url: "https://api.example.com/v1/infer", maxAmount: "0.1", memo: "brief" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      url: "https://api.example.com/v1/infer",
      maxAmount: "0.10",
      memo: "brief",
      requester: "Test agent",
    });
    expect(result.isError).toBeFalsy();
    const text = textOf(result);
    expect(text).toContain("Paid 0.05 CRED");
    expect(text).toContain("0xabc");
    expect(text).toContain("Response status 200");
    expect(text).toContain('{"completion":"hello"}');
    expect(result.structuredContent).toMatchObject({ paid: true, payment: { id: "pay_1" } });
  });

  it("list_payments passes limit and kind and summarizes rows", async () => {
    const fetchMock = mockM2mPaymentsFetch({
      "GET /v1/payments": {
        body: {
          payments: [
            {
              id: "pay_2",
              userId: "user-1",
              kind: "transfer",
              status: "succeeded",
              amount: { value: "5.00", currency: "CRED" },
              counterparty: "0x2222222222222222222222222222222222222222",
              hash: "0xdef",
              createdAt: "2030-01-01T00:00:00.000Z",
            },
          ],
        },
      },
    });
    const { client } = await connect(fetchMock);
    const result = await client.callTool({
      name: "list_payments",
      arguments: { limit: 5, kind: "transfer" },
    });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(`${API}/v1/payments?limit=5&kind=transfer`);
    expect(textOf(result)).toContain("pay_2 transfer succeeded: 5.00 CRED");
  });

  it("turns other API errors into isError results", async () => {
    const { client } = await connect(
      mockM2mPaymentsFetch({
        "GET /v1/wallet": {
          status: 404,
          body: { error: { code: "wallet_not_found", message: "No wallet for user u1." } },
        },
      }),
    );
    const result = await client.callTool({ name: "get_wallet", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("wallet_not_found");
    expect(textOf(result)).toContain("open the app once");
  });
});
