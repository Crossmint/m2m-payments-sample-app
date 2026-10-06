"use client";

import * as React from "react";
import type { TopUpRequest } from "@m2m-payments/core";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UseTopUpRequestOptions {
  /** Poll interval while the request is `pending` or `paying`. Default 3000ms. 0 disables polling. */
  pollMs?: number;
}

/** True while the user has not paid or declined yet. */
export function isOpenTopUpRequest(req: TopUpRequest | undefined): boolean {
  return req?.status === "pending" || req?.status === "paying";
}

/** True once the user's time to answer has passed. */
export function isTopUpRequestPastDeadline(
  req: TopUpRequest | undefined,
  now = Date.now(),
): boolean {
  if (!req) return false;
  return req.status === "pending" && new Date(req.requestExpiresAt).getTime() < now;
}

export function useTopUpRequest(
  requestId: string | undefined,
  { pollMs = 3000 }: UseTopUpRequestOptions = {},
): Resource<TopUpRequest> {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(
    () => api.getTopUpRequest(requestId as string),
    [api, requestId],
  );
  return useResource(fetcher, [requestId], {
    enabled: Boolean(requestId),
    pollMs: pollMs || undefined,
    shouldPoll: isOpenTopUpRequest,
  });
}
