import { credits, type Amount } from "@m2m-payments/core";
import { z } from "zod";

/** A decimal string in major units, up to the token's six places. */
export const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'Use a decimal string like "10.00"');

const positiveDecimal = decimalString.refine((v) => Number.parseFloat(v) > 0, {
  message: "Amount must be above zero",
});

export const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/, "Use a 0x-prefixed EVM address");

const hexData = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, "Use 0x-prefixed hex");

const requester = z.string().min(1).max(100).optional();
const memo = z.string().min(1).max(500).optional();

/**
 * Credits, as `{ value, currency }` or a bare decimal string. Either way the
 * result is an `Amount` in credits: the currency is always credits here.
 */
export const amountSchema = z
  .union([
    z.object({ value: positiveDecimal, currency: z.string().min(1).max(10) }),
    positiveDecimal,
  ])
  .transform((v): Amount => credits(typeof v === "string" ? v : v.value));

/** Body of POST /v1/access-requests. */
export const createAccessRequestSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
  requester,
});

/** Body of POST /v1/top-up-requests. */
export const createTopUpRequestSchema = z.object({
  amount: amountSchema,
  reason: z.string().min(1).max(500).optional(),
  requester,
});

/** Body of POST /v1/top-ups. */
export const createTopUpSchema = z.object({
  amount: positiveDecimal,
  requestId: z.string().min(1).optional(),
});

/** Body of POST /v1/top-ups/:orderId/pay. */
export const payTopUpSchema = z.object({
  paymentMethodId: z.string().min(1),
});

/** Body of POST /v1/payments/x402 and /v1/payments/mpp. */
export const protocolPaymentSchema = z.object({
  url: z.string().url(),
  method: z.string().min(1).max(10).optional(),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  maxAmount: positiveDecimal.optional(),
  memo,
  requester,
});

/** Body of POST /v1/transfers. */
export const transferSchema = z.object({
  to: evmAddress,
  amount: positiveDecimal,
  memo,
  requester,
});

/** Body of POST /v1/transactions. `value` is wei as a decimal string. */
export const transactionSchema = z.object({
  to: evmAddress,
  data: hexData.optional(),
  value: z.string().regex(/^\d+$/, "Use wei as a decimal string").optional(),
  memo,
  requester,
});
