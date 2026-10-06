"use client";

import * as React from "react";
import type { ActivityItem } from "@m2m-payments/core";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UseActivityOptions {
  /** How many transfers to load. Default 50. */
  limit?: number;
  /** Poll interval. Default 0, no polling. */
  pollMs?: number;
  enabled?: boolean;
}

/** On-chain transfers in and out of the wallet, newest first. */
export function useActivity({
  limit = 50,
  pollMs = 0,
  enabled = true,
}: UseActivityOptions = {}): Resource<ActivityItem[]> {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(() => api.getActivity(limit), [api, limit]);
  return useResource(fetcher, [limit], { enabled, pollMs: pollMs || undefined });
}
