import { getM2mPaymentsHandlers } from "@/lib/api-server";

/**
 * The M2M Payments API from @m2m-payments/server, mounted at /api/m2m-payments.
 * The router finds the mount prefix by locating "/v1/" in the URL.
 */
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  const handlers = await getM2mPaymentsHandlers();
  return handlers.handler(req);
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
