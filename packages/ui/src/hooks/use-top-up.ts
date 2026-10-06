"use client";

import * as React from "react";
import type { TopUpView } from "@m2m-payments/core";
import { errorMessage } from "../api/client.js";
import { useM2mPayments } from "../provider.js";

export type TopUpFlowPhase =
  "idle" | "creating" | "preview" | "paying" | "confirming" | "success" | "error";

export interface TopUpState {
  phase: TopUpFlowPhase;
  /** The order, from creation on. Carries the quote and the order id. */
  view?: TopUpView;
  error?: string;
  /** Payment accepted, delivery still in flight when polling gave up. Only with `success`. */
  pending: boolean;
}

export interface UseTopUpResult extends TopUpState {
  /** Creates the order for `amount` credits. With `requestId` the request moves to `paying`. */
  create: (amount: string, requestId?: string) => Promise<TopUpState>;
  /** Pays the order with a saved card, then polls until delivered. */
  pay: (paymentMethodId: string) => Promise<TopUpState>;
  reset: () => void;
}

const POLL_MS = 3_000;
const MAX_POLLS = 10;

const IDLE: TopUpState = { phase: "idle", pending: false };

/**
 * The onramp order state machine, ported from the onramp sample app's
 * `useOnrampOrder`. `create` makes the order and lands on the preview with the
 * quote; `pay` charges the saved card and polls `getTopUp` every 3 s until
 * `completed` or `failed`, at most ten times, then treats a still-processing
 * order as success with `pending: true`.
 */
export function useTopUp(): UseTopUpResult {
  const { api } = useM2mPayments();
  const [state, setState] = React.useState<TopUpState>(IDLE);
  const viewRef = React.useRef<TopUpView | undefined>(undefined);
  // Bumped on reset so a poll from a previous order cannot write into the next.
  const generation = React.useRef(0);

  const commit = React.useCallback((next: TopUpState, gen: number) => {
    if (gen === generation.current) setState(next);
    return next;
  }, []);

  const reset = React.useCallback(() => {
    generation.current++;
    viewRef.current = undefined;
    setState(IDLE);
  }, []);

  const create = React.useCallback(
    async (amount: string, requestId?: string): Promise<TopUpState> => {
      const gen = ++generation.current;
      viewRef.current = undefined;
      setState({ phase: "creating", pending: false });
      try {
        const view = await api.createTopUp(requestId ? { amount, requestId } : { amount });
        viewRef.current = view;
        return commit({ phase: "preview", view, pending: false }, gen);
      } catch (e) {
        return commit(
          {
            phase: "error",
            error: errorMessage(e, "The order could not be created."),
            pending: false,
          },
          gen,
        );
      }
    },
    [api, commit],
  );

  const confirm = React.useCallback(
    async (orderId: string, gen: number): Promise<TopUpState> => {
      let view = viewRef.current;
      commit({ phase: "confirming", view, pending: false }, gen);
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (gen !== generation.current) return { phase: "idle", pending: false };
        try {
          view = await api.getTopUp(orderId);
          viewRef.current = view;
        } catch {
          continue;
        }
        if (view.phase === "completed")
          return commit({ phase: "success", view, pending: false }, gen);
        if (view.phase === "failed") {
          return commit(
            {
              phase: "error",
              view,
              error: view.failureReason ?? "The payment did not go through.",
              pending: false,
            },
            gen,
          );
        }
      }
      // Payment accepted, delivery still in flight.
      return commit({ phase: "success", view, pending: true }, gen);
    },
    [api, commit],
  );

  const pay = React.useCallback(
    async (paymentMethodId: string): Promise<TopUpState> => {
      const gen = generation.current;
      const view = viewRef.current;
      if (!view) {
        return commit({ phase: "error", error: "There is no order to pay.", pending: false }, gen);
      }
      commit({ phase: "paying", view, pending: false }, gen);
      try {
        const paid = await api.payTopUp(view.orderId, paymentMethodId);
        viewRef.current = paid;
        if (paid.phase === "completed")
          return commit({ phase: "success", view: paid, pending: false }, gen);
        if (paid.phase === "failed") {
          return commit(
            {
              phase: "error",
              view: paid,
              error: paid.failureReason ?? "The payment did not go through.",
              pending: false,
            },
            gen,
          );
        }
      } catch (e) {
        return commit(
          {
            phase: "error",
            view,
            error: errorMessage(e, "The payment did not go through."),
            pending: false,
          },
          gen,
        );
      }
      return confirm(view.orderId, gen);
    },
    [api, commit, confirm],
  );

  return { ...state, create, pay, reset };
}
