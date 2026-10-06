import { requireUser, type Ctx } from "../context.js";
import { json, noContent } from "../errors.js";
import type { Params } from "../router.js";

/*
 * Saved cards. They are saved in the browser with Crossmint's PCI component;
 * the server only lists and deletes, with the client key and the user's JWT.
 */

/** GET /v1/payment-methods */
export async function listPaymentMethods(req: Request, ctx: Ctx): Promise<Response> {
  const user = await requireUser(req, ctx);
  const result = await ctx.crossmint.paymentMethods.list({ jwt: user.jwt });
  return json({ paymentMethods: result.paymentMethods });
}

/** DELETE /v1/payment-methods/:id */
export async function deletePaymentMethod(
  req: Request,
  ctx: Ctx,
  params: Params,
): Promise<Response> {
  const user = await requireUser(req, ctx);
  await ctx.crossmint.paymentMethods.delete({ jwt: user.jwt }, params.id!);
  return noContent();
}
