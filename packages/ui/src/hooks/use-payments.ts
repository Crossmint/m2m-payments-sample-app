"use client";

import * as React from "react";
import type { Payment, PaymentKind } from "@m2m-payments/core";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UsePaymentsOptions {
  /** Default 100. */
  limit?: number;
  kind?: PaymentKind;
  /** Poll interval. Default 0, no polling. */
  pollMs?: number;
  enabled?: boolean;
}

/** The ledger: every x402 call, MPP call, transfer, transaction and top-up. Newest first. */
export function usePayments({
  limit = 100,
  kind,
  pollMs = 0,
  enabled = true,
}: UsePaymentsOptions = {}): Resource<Payment[]> {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(() => api.listPayments({ limit, kind }), [api, limit, kind]);
  return useResource(fetcher, [limit, kind], { enabled, pollMs: pollMs || undefined });
}
