import { x402Network } from "@m2m-payments/core";
import {
  HTTPFacilitatorClient,
  x402HTTPResourceServer,
  x402ResourceServer,
  type HTTPAdapter,
} from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { fakeInference, promptFrom } from "@/lib/demo/inference";
import { serverEnv } from "@/lib/env";

/**
 * POST /api/demo/x402/inference: a paid endpoint the demo pays over x402 v2.
 *
 * It is a resource server in the x402 sense: without a payment it answers
 * 402 with the requirements (the `exact` scheme on the app's chain, the demo
 * price in the underlying asset, the demo recipient); with a valid payment
 * header it runs the fake inference, settles through the facilitator and
 * returns the answer with the settlement headers. The agent's side of the
 * same handshake lives in `payWithX402` in `@m2m-payments/core/server`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTE_PATH = "/api/demo/x402/inference";
const DESCRIPTION = "Acme research inference";

let serverPromise: Promise<x402HTTPResourceServer> | undefined;

/** The resource server, built once per process. `initialize` asks the facilitator what it supports. */
function getServer(payTo: `0x${string}`): Promise<x402HTTPResourceServer> {
  serverPromise ??= (async () => {
    const env = serverEnv.crossmintEnvironment();
    const facilitator = new HTTPFacilitatorClient({ url: serverEnv.x402FacilitatorUrl() });
    const resourceServer = registerExactEvmScheme(new x402ResourceServer(facilitator));
    const httpServer = new x402HTTPResourceServer(resourceServer, {
      [`POST ${ROUTE_PATH}`]: {
        accepts: {
          scheme: "exact",
          network: x402Network(env),
          payTo,
          // The Money form: the scheme converts dollars to the chain's default
          // stablecoin, which is the same USDC the wallet holds as credits.
          price: `$${serverEnv.demoPrice()}`,
        },
        description: DESCRIPTION,
        mimeType: "application/json",
        unpaidResponseBody: () => ({
          contentType: "application/json",
          body: {
            error: "payment_required",
            message: `${DESCRIPTION}: pay ${serverEnv.demoPrice()} credits per call.`,
          },
        }),
      },
    });
    await httpServer.initialize();
    return httpServer;
  })();
  return serverPromise;
}

/** The Web `Request`, as the framework-agnostic server wants to read it. */
function adapterFor(req: Request, body: unknown): HTTPAdapter {
  const url = new URL(req.url);
  return {
    getHeader: (name) => req.headers.get(name) ?? undefined,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => req.url,
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
    getQueryParams: () => Object.fromEntries(url.searchParams),
    getQueryParam: (name) => url.searchParams.get(name) ?? undefined,
    getBody: () => body,
  };
}

function toResponse(instructions: {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  isHtml?: boolean;
}): Response {
  const headers = new Headers(instructions.headers);
  if (instructions.isHtml) {
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(String(instructions.body ?? ""), { status: instructions.status, headers });
  }
  if (instructions.body === undefined)
    return new Response(null, { status: instructions.status, headers });
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return new Response(
    typeof instructions.body === "string" ? instructions.body : JSON.stringify(instructions.body),
    {
      status: instructions.status,
      headers,
    },
  );
}

export async function POST(req: Request): Promise<Response> {
  const payTo = serverEnv.demoPayTo();
  if (!payTo) {
    return Response.json(
      {
        error: {
          code: "not_configured",
          message: "Set M2M_PAYMENTS_DEMO_PAY_TO to an EVM address to turn the demo endpoints on.",
        },
      },
      { status: 503 },
    );
  }

  let server: x402HTTPResourceServer;
  try {
    server = await getServer(payTo);
  } catch (e) {
    // A failed initialize should not poison every later request.
    serverPromise = undefined;
    console.error("[demo/x402] could not initialize", e);
    return Response.json(
      {
        error: { code: "facilitator_unavailable", message: "The x402 facilitator did not answer." },
      },
      { status: 502 },
    );
  }

  const body = await req
    .clone()
    .json()
    .catch(() => undefined);
  const adapter = adapterFor(req, body);
  // x402 v2 sends the payment in PAYMENT-SIGNATURE; v1 clients used X-PAYMENT.
  const paymentHeader =
    req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined;

  const result = await server.processHTTPRequest({
    adapter,
    path: adapter.getPath(),
    method: req.method,
    paymentHeader,
  });

  if (result.type === "payment-error") return toResponse(result.response);

  const answer = fakeInference(await promptFrom(req));

  // Answered without a 402 only when no route matched, which this file rules out.
  if (result.type === "no-payment-required") return Response.json(answer);

  const settled = await server.processSettlement(
    result.paymentPayload,
    result.paymentRequirements,
    result.declaredExtensions,
    { request: { adapter, path: adapter.getPath(), method: req.method, paymentHeader } },
    undefined,
    result.beforeHandlerSettlement,
  );
  if (!settled.success) return toResponse(settled.response);

  return Response.json(answer, { headers: settled.headers });
}
