import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { M2mPaymentsApi } from "./api.js";
import { registerM2mPaymentsTools } from "./tools.js";

export const M2M_PAYMENTS_MCP_SERVER_NAME = "m2m-payments";
export const M2M_PAYMENTS_MCP_SERVER_VERSION = "0.1.0";

export interface M2mPaymentsMcpServerOptions {
  /** M2M Payments API base URL including the mount prefix, e.g. `https://wallet.example.com/api/m2m-payments`. */
  apiBaseUrl: string;
  /** The user's bearer token. Forwarded on every M2M Payments API call. */
  bearerToken: string;
  /** Label shown to the user on the approval screen. Default "Agent". */
  requester?: string;
  fetch?: typeof fetch;
}

/**
 * Build an `McpServer` with the M2M Payments tools bound to one user token.
 * Stateless: build one per request in HTTP mode, one per process in stdio mode.
 */
export function createM2mPaymentsMcpServer(opts: M2mPaymentsMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: M2M_PAYMENTS_MCP_SERVER_NAME,
      version: M2M_PAYMENTS_MCP_SERVER_VERSION,
      title: "M2M Payments wallet",
    },
    {
      instructions:
        "M2M Payments gives you a non-custodial wallet the user funds with credits (1 credit = 1 USD) and lets you pay machines from it: " +
        "x402 endpoints, MPP endpoints, transfers and raw transactions. You never hold a key or a card. " +
        "Flow: call get_wallet first. If a payment answers access_required, show the approvalUrl from the error to the user verbatim and poll get_access_request with its requestId until status is active, then retry. " +
        "If it answers insufficient_funds, call request_top_up for about details.required, show the top-up URL to the user, and poll get_top_up_request until completed, then retry. " +
        "Then pay with pay_x402 or pay_mpp, with maxAmount set to what the call is worth. transfer and send_transaction only when the user asked for them. " +
        "Never ask the user for private keys, seed phrases or card numbers, never pay more than the task needs, and never repeat a request after the user denied it.",
    },
  );
  const api = new M2mPaymentsApi({
    baseUrl: opts.apiBaseUrl,
    bearerToken: opts.bearerToken,
    fetch: opts.fetch,
  });
  registerM2mPaymentsTools(server, { api, requester: opts.requester });
  return server;
}

// ---------------------------------------------------------------------------
// OAuth 2.0 protected resource metadata (RFC 9728)
// ---------------------------------------------------------------------------

export interface ProtectedResourceMetadataOptions {
  /** The MCP endpoint URL, e.g. `https://wallet.example.com/api/mcp`. */
  resourceUrl: string;
  /** Authorization server issuer URLs. For Stytch Connected Apps: `https://test.stytch.com/v1/public/<projectId>`. */
  authorizationServers: string[];
  scopes?: string[];
  resourceName?: string;
  resourceDocumentation?: string;
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  bearer_methods_supported: string[];
  scopes_supported?: string[];
  resource_name?: string;
  resource_documentation?: string;
}

/** JSON body for `/.well-known/oauth-protected-resource`. */
export function protectedResourceMetadata(
  opts: ProtectedResourceMetadataOptions,
): ProtectedResourceMetadata {
  const metadata: ProtectedResourceMetadata = {
    resource: normalizeUrl(opts.resourceUrl),
    authorization_servers: opts.authorizationServers.map(normalizeUrl),
    bearer_methods_supported: ["header"],
    resource_name: opts.resourceName ?? "M2M Payments wallet",
  };
  if (opts.scopes?.length) metadata.scopes_supported = opts.scopes;
  if (opts.resourceDocumentation) metadata.resource_documentation = opts.resourceDocumentation;
  return metadata;
}

/**
 * Where clients fetch the protected resource metadata: the origin's
 * `/.well-known/oauth-protected-resource`. This is the URL sent in `WWW-Authenticate`.
 */
export function protectedResourceMetadataUrl(resourceUrl: string): string {
  return new URL("/.well-known/oauth-protected-resource", resourceUrl).href;
}

/**
 * A `(req: Request) => Response` handler for the metadata route. Answers GET and
 * OPTIONS with CORS open, so browser-based MCP clients can read it.
 */
export function createProtectedResourceMetadataHandler(
  opts: ProtectedResourceMetadataOptions,
): (req: Request) => Response {
  const body = JSON.stringify(protectedResourceMetadata(opts));
  return (req) => {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders() });
    if (req.method !== "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, OPTIONS", ...corsHeaders() },
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders(),
      },
    });
  };
}

// ---------------------------------------------------------------------------
// Authorization server metadata (RFC 8414)
// ---------------------------------------------------------------------------

export interface AuthorizationServerMetadataOptions {
  /** This server's own origin. It is the `issuer`, so it must match where the document is served. */
  issuer: string;
  /** The hosted consent page. */
  authorizationEndpoint: string;
  /** Where codes are exchanged. */
  tokenEndpoint: string;
  /** Dynamic client registration, RFC 7591. Leaving it out is what stops a client auto-registering. */
  registrationEndpoint?: string;
  /** The identity provider's signing keys. */
  jwksUri?: string;
  revocationEndpoint?: string;
  userinfoEndpoint?: string;
  scopes?: string[];
  grantTypes?: string[];
}

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  token_endpoint_auth_methods_supported: string[];
}

/**
 * JSON body for `/.well-known/oauth-authorization-server`.
 *
 * Why this exists rather than pointing clients straight at the identity
 * provider: Stytch serves only `/.well-known/openid-configuration`, and that
 * document omits `registration_endpoint` even though the endpoint is live. A
 * client that discovers by the book therefore finds no way to register itself
 * and gives up. Stytch's `issuer` is also scheme-relative
 * (`stytch.com/project-...`), which strict clients reject.
 *
 * So the app stands in front as the authorization server: it advertises its
 * own https issuer, its own consent page, and endpoints it proxies, with
 * registration among them.
 */
export function authorizationServerMetadata(
  opts: AuthorizationServerMetadataOptions,
): AuthorizationServerMetadata {
  const metadata: AuthorizationServerMetadata = {
    issuer: normalizeUrl(opts.issuer),
    authorization_endpoint: opts.authorizationEndpoint,
    token_endpoint: opts.tokenEndpoint,
    response_types_supported: ["code"],
    grant_types_supported: opts.grantTypes ?? ["authorization_code", "refresh_token"],
    // PKCE is the only thing a public client can prove itself with.
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post", "none"],
  };
  if (opts.registrationEndpoint) metadata.registration_endpoint = opts.registrationEndpoint;
  if (opts.jwksUri) metadata.jwks_uri = opts.jwksUri;
  if (opts.revocationEndpoint) metadata.revocation_endpoint = opts.revocationEndpoint;
  if (opts.userinfoEndpoint) metadata.userinfo_endpoint = opts.userinfoEndpoint;
  if (opts.scopes?.length) metadata.scopes_supported = opts.scopes;
  return metadata;
}

/** A `(req: Request) => Response` handler for the metadata route. GET and OPTIONS, CORS open. */
export function createAuthorizationServerMetadataHandler(
  opts: AuthorizationServerMetadataOptions,
): (req: Request) => Response {
  const body = JSON.stringify(authorizationServerMetadata(opts));
  return (req) => {
    if (req.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders() });
    if (req.method !== "GET") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, OPTIONS", ...corsHeaders() },
      });
    }
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders(),
      },
    });
  };
}

/**
 * Derive the authorization server URL from an authorization endpoint, e.g. the
 * one `GET /v1/config` returns: `.../oauth2/authorize` → `...`.
 */
export function authorizationServerFromEndpoint(authorizationEndpoint: string): string {
  const url = new URL(authorizationEndpoint);
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/oauth2\/authorize\/?$/, "");
  return normalizeUrl(url.href);
}

// ---------------------------------------------------------------------------
// HTTP handler for Next.js route handlers and any Web-standard runtime
// ---------------------------------------------------------------------------

export interface M2mPaymentsMcpHandlerOptions {
  /** M2M Payments API base URL including the mount prefix, e.g. `https://wallet.example.com/api/m2m-payments`. */
  apiBaseUrl: string;
  /** The public URL of this MCP endpoint, e.g. `https://wallet.example.com/api/mcp`. */
  resourceUrl: string;
  /** Authorization server issuer URLs for the `WWW-Authenticate` challenge and the metadata. */
  authorizationServers: string[];
  /** Scopes to advertise. Sent in the challenge too. */
  scopes?: string[];
  /** Override the metadata URL sent in `WWW-Authenticate`. Default: origin `/.well-known/oauth-protected-resource`. */
  resourceMetadataUrl?: string;
  /** Label shown to the user on the approval screen. Default "Agent". */
  requester?: string;
  fetch?: typeof fetch;
}

/**
 * Stateless MCP over streamable HTTP. Every request gets a fresh server bound to
 * the request's bearer token. No sessions, JSON responses (no SSE), so it runs
 * in serverless route handlers.
 */
export function createM2mPaymentsMcpHandler(
  opts: M2mPaymentsMcpHandlerOptions,
): (req: Request) => Promise<Response> {
  const metadataUrl = opts.resourceMetadataUrl ?? protectedResourceMetadataUrl(opts.resourceUrl);

  return async (req) => {
    const token = readBearerToken(req);
    if (!token) return unauthorized(metadataUrl, opts.scopes, "Missing bearer token");

    const server = createM2mPaymentsMcpServer({
      apiBaseUrl: opts.apiBaseUrl,
      bearerToken: token,
      requester: opts.requester,
      fetch: opts.fetch,
    });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(req, { authInfo: authInfoFromToken(token) });
    } catch (err) {
      await server.close().catch(() => undefined);
      throw err;
    }
  };
}

export function readBearerToken(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

function unauthorized(
  metadataUrl: string,
  scopes: string[] | undefined,
  description: string,
): Response {
  let challenge = `Bearer error="invalid_token", error_description="${description}"`;
  if (scopes?.length) challenge += `, scope="${scopes.join(" ")}"`;
  challenge += `, resource_metadata="${metadataUrl}"`;
  return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "WWW-Authenticate": challenge,
      ...corsHeaders(),
    },
  });
}

/**
 * Best-effort `AuthInfo` for tool handlers. The token is decoded, not verified.
 * The M2M Payments API verifies it on every call.
 */
function authInfoFromToken(token: string): AuthInfo {
  const claims = decodeJwtClaims(token);
  const scope = typeof claims?.scope === "string" ? claims.scope.split(" ").filter(Boolean) : [];
  const clientId =
    (typeof claims?.client_id === "string" && claims.client_id) ||
    (typeof claims?.azp === "string" && claims.azp) ||
    (typeof claims?.aud === "string" && claims.aud) ||
    "unknown";
  const info: AuthInfo = { token, clientId, scopes: scope };
  if (typeof claims?.exp === "number") info.expiresAt = claims.exp;
  if (typeof claims?.sub === "string") info.extra = { userId: claims.sub };
  return info;
}

function decodeJwtClaims(token: string): Record<string, unknown> | undefined {
  const part = token.split(".")[1];
  if (!part) return undefined;
  try {
    const json = atob(part.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID",
    "Access-Control-Expose-Headers": "WWW-Authenticate, mcp-session-id, mcp-protocol-version",
  };
}

function normalizeUrl(url: string): string {
  const u = new URL(url);
  // RFC 8707 resource identifiers have no fragment. Keep the path as given, minus a trailing slash.
  u.hash = "";
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
  // `href` puts the slash back on a bare origin, and an issuer has to match
  // the string the client discovered it by, character for character
  // (RFC 8414 §3.3). A stray slash there is enough to fail validation.
  return u.pathname === "/" ? u.origin : u.href;
}
