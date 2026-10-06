import { stytchEndpoints } from "@m2m-payments/auth";
import { tokenInfo, type PublicConfig } from "@m2m-payments/core";
import type { Ctx } from "../context.js";
import { json } from "../errors.js";

export function buildPublicConfig(ctx: Ctx): PublicConfig {
  const { config } = ctx;
  const ep = stytchEndpoints({
    projectId: config.auth.projectId,
    environment: config.auth.environment,
    projectDomain: config.auth.projectDomain ?? config.auth.customDomain,
    authorizationUrl: config.auth.authorizationUrl ?? `${config.webBaseUrl}/oauth/authorize`,
  });
  const oauth: PublicConfig["auth"]["oauth"] = {
    authorizationEndpoint: ep.authorize,
    tokenEndpoint: ep.token,
    // full_access lets the server exchange the agent's access token for a Stytch session.
    scopes: ["openid", "email", "profile", "offline_access", "full_access"],
  };
  if (config.auth.cliClientId) oauth.cliClientId = config.auth.cliClientId;
  if (config.auth.mcpClientId) oauth.mcpClientId = config.auth.mcpClientId;
  const out: PublicConfig = {
    name: config.name ?? "M2M Payments",
    apiBaseUrl: config.apiBaseUrl,
    webBaseUrl: config.webBaseUrl,
    crossmintEnvironment: config.crossmint.environment,
    token: tokenInfo(config.crossmint.environment),
    auth: {
      provider: "stytch",
      projectId: config.auth.projectId,
      environment: config.auth.environment,
      authorizationServer: ep.projectDomain,
      oauth,
    },
  };
  if (config.demo) out.demo = config.demo;
  return out;
}

/** GET /v1/config. No auth. */
export async function getConfig(_req: Request, ctx: Ctx): Promise<Response> {
  return json(buildPublicConfig(ctx));
}
