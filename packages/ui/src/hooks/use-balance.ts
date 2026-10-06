"use client";

import * as React from "react";
import type { WalletBalance } from "@m2m-payments/core";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UseBalanceOptions {
  /** Poll interval. Default 15000ms. 0 disables polling. */
  pollMs?: number;
  enabled?: boolean;
}

/** `GET /v1/wallet/balance`, the cheap call. Polled. */
export function useBalance({
  pollMs = 15_000,
  enabled = true,
}: UseBalanceOptions = {}): Resource<WalletBalance> {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(() => api.getBalance(), [api]);
  return useResource(fetcher, [], { enabled, pollMs: pollMs || undefined });
}
