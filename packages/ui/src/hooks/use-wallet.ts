"use client";

import * as React from "react";
import type { WalletView } from "@m2m-payments/core";
import { M2mPaymentsApiError } from "../api/client.js";
import { useM2mPayments } from "../provider.js";
import { useResource, type Resource } from "./use-resource.js";

export interface UseWalletOptions {
  /** Poll interval. Default 15000ms. 0 disables polling. */
  pollMs?: number;
  enabled?: boolean;
}

export interface UseWalletResult extends Resource<WalletView> {
  /**
   * The API answered `wallet_not_found`: the user has no wallet yet. The SDK
   * creates it on first sign-in, so this is a wait, not a fault. `data` stays
   * undefined and `error` is not set.
   */
  notFound: boolean;
}

/** While the wallet is being created, look again sooner than the normal poll. */
const NOT_FOUND_POLL_MS = 3_000;

/**
 * The API's `WalletView`, polled. Internally the resource holds
 * `WalletView | null`, null meaning "not found", so `useResource` can keep
 * its one shape for data, error and loading.
 */
export function useWallet({
  pollMs = 15_000,
  enabled = true,
}: UseWalletOptions = {}): UseWalletResult {
  const { api } = useM2mPayments();
  const fetcher = React.useCallback(async (): Promise<WalletView | null> => {
    try {
      return await api.getWallet();
    } catch (e) {
      if (e instanceof M2mPaymentsApiError && e.isWalletNotFound) return null;
      throw e;
    }
  }, [api]);

  const [notFound, setNotFound] = React.useState(false);
  const resource = useResource<WalletView | null>(fetcher, [], {
    enabled,
    pollMs: notFound ? NOT_FOUND_POLL_MS : pollMs || undefined,
  });

  // Derived from the data, kept in state so the poll interval can read it.
  const isNull = resource.data === null;
  React.useEffect(() => {
    setNotFound(isNull);
  }, [isNull]);

  const { setData: setInner, refetch: refetchInner } = resource;
  const setData = React.useCallback<React.Dispatch<React.SetStateAction<WalletView | undefined>>>(
    (action) => {
      setInner((prev) =>
        typeof action === "function"
          ? (action as (p: WalletView | undefined) => WalletView | undefined)(prev ?? undefined)
          : action,
      );
    },
    [setInner],
  );

  const refetch = React.useCallback(
    async () => (await refetchInner()) ?? undefined,
    [refetchInner],
  );

  return {
    data: resource.data ?? undefined,
    error: resource.error,
    loading: resource.loading,
    refreshing: resource.refreshing,
    refetch,
    setData,
    notFound,
  };
}
