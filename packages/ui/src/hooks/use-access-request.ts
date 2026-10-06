"use client";

import * as React from "react";
import type { AccessRequest } from "@m2m-payments/core";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UseAccessRequestOptions {
  /** Poll interval while the request is `pending` or `approved`. Default 2000ms. 0 disables polling. */
  pollMs?: number;
}

/** True while the agent is still waiting for an answer or for the signer to land. */
export function isOpenAccessRequest(req: AccessRequest | undefined): boolean {
  return req?.status === "pending" || req?.status === "approved";
}

/** True once the user's time to answer has passed. */
export function isAccessRequestPastDeadline(
  req: AccessRequest | undefined,
  now = Date.now(),
): boolean {
  if (!req) return false;
  return req.status === "pending" && new Date(req.requestExpiresAt).getTime() < now;
}

export function useAccessRequest(
  requestId: string | undefined,
  { pollMs = 2000 }: UseAccessRequestOptions = {},
): Resource<AccessRequest> {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(
    () => api.getAccessRequest(requestId as string),
    [api, requestId],
  );
  return useResource(fetcher, [requestId], {
    enabled: Boolean(requestId),
    pollMs: pollMs || undefined,
    shouldPoll: isOpenAccessRequest,
  });
}
