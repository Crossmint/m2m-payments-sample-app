import { vi } from "vitest";

export type FetchMock = ReturnType<typeof vi.fn> & typeof fetch;

type RouteValue = { status?: number; body?: unknown } | ((init?: RequestInit) => unknown);

/**
 * A fetch mock that routes on `METHOD /path` (path relative to the API mount,
 * query string dropped) and returns JSON. A function route returns the body
 * for a 200; an object route sets status and body.
 */
export function mockM2mPaymentsFetch(routes: Record<string, RouteValue>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const key = `${(init?.method ?? "GET").toUpperCase()} ${url.pathname.replace(/^\/api\/m2m-payments/, "")}`;
    const route = routes[key];
    if (!route)
      return new Response(
        JSON.stringify({ error: { code: "not_found", message: `no route ${key}` } }),
        { status: 404 },
      );
    const value = typeof route === "function" ? { body: route(init) } : route;
    return new Response(value.body === undefined ? null : JSON.stringify(value.body), {
      status: value.status ?? (value.body === undefined ? 204 : 200),
      headers: { "content-type": "application/json" },
    });
  }) as unknown as FetchMock;
}

export const TOKEN = {
  symbol: "CRED",
  name: "Credits",
  decimals: 6,
  chain: "base-sepolia",
  underlying: {
    symbol: "USDC",
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    locator: "base-sepolia:0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};
