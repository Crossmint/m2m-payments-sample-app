"use client";

import * as React from "react";
import type { Amount, PaymentMethod, TopUpRequest } from "@m2m-payments/core";
import { credits, formatCredits, toDecimalString } from "@m2m-payments/core";
import { AlertCircle, Clock } from "lucide-react";
import { errorMessage } from "../api/client.js";
import { usePaymentMethods } from "../hooks/use-payment-methods.js";
import { useTopUp } from "../hooks/use-top-up.js";
import { isTopUpRequestPastDeadline, useTopUpRequest } from "../hooks/use-top-up-request.js";
import { cn } from "../lib/utils.js";
import { useM2mPayments } from "../provider.js";
import { Header, Problem, Shell } from "./approve-agent-access.js";
import { Button } from "./primitives/button.js";
import { Skeleton } from "./primitives/skeleton.js";
import { PaymentMethodSheet } from "./top-up/payment-method-sheet.js";
import { TopUpAmount } from "./top-up/top-up-amount.js";
import { TopUpPreview } from "./top-up/top-up-preview.js";
import { TopUpStatus } from "./top-up/top-up-status.js";

/** What the top-up screen says. Exported so every surface words it the same way. */
export const TOP_UP_ASK = {
  title: "Add credits",
  sub: "By card. No ID check.",
} as const;

export type TopUpOutcomeStatus = "completed" | "denied" | "expired" | "failed";

export interface TopUpOutcome {
  status: TopUpOutcomeStatus;
  request?: TopUpRequest;
  /** Credits delivered, on `completed`. */
  received?: Amount;
  orderId?: string;
}

export interface TopUpProps {
  /** The agent's top-up request, when there is one. Prefills the amount and links the order. */
  requestId?: string;
  /** Credits to start with, as a decimal string. Ignored when a request sets the amount. */
  initialAmount?: string;
  /**
   * "card" stands the screen on its own white panel. "plain" drops the panel
   * so the page's own frame, a phone screen, can hold it. Default "card".
   */
  variant?: "card" | "plain";
  /** Portal target for the keypad and the card sheet: the phone screen. */
  container?: HTMLElement | null;
  /** Fires once, on Done or when the request reaches a final state. */
  onDone?: (outcome: TopUpOutcome) => void;
  /** The X on the amount step. */
  onClose?: () => void;
  className?: string;
}

type Step = "amount" | "preview" | "status";

/**
 * The onramp, as the onramp sample app draws it, in three steps inside one
 * column: the amount with the big figure and the keypad, the order preview
 * with the quote, and the status that counts the credits up. Says "credits"
 * and "no ID check" where the onramp app said USDC.
 */
export function TopUp({
  requestId,
  initialAmount,
  variant = "card",
  container = null,
  onDone,
  onClose,
  className,
}: TopUpProps) {
  const { api } = useM2mPayments();
  const request = useTopUpRequest(requestId);
  const req = request.data;
  const topUp = useTopUp();
  const paymentMethods = usePaymentMethods();

  const [step, setStep] = React.useState<Step>("amount");
  const [amount, setAmount] = React.useState(() => (initialAmount ? rawAmount(initialAmount) : ""));
  const [selectedId, setSelectedId] = React.useState<string | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [declining, setDeclining] = React.useState(false);
  const [actionError, setActionError] = React.useState<unknown>(undefined);

  // The request sets the amount once, unless the host already did.
  const prefilled = React.useRef(Boolean(initialAmount));
  React.useEffect(() => {
    if (!req || prefilled.current) return;
    prefilled.current = true;
    setAmount(rawAmount(req.amount.value));
  }, [req]);

  // Pick the default card once cards load.
  React.useEffect(() => {
    if (selectedId || !paymentMethods.data?.length) return;
    const def = paymentMethods.data.find((pm) => pm.default) ?? paymentMethods.data[0];
    if (def) setSelectedId(def.paymentMethodId);
  }, [paymentMethods.data, selectedId]);

  const method = React.useMemo(
    () => paymentMethods.data?.find((pm) => pm.paymentMethodId === selectedId),
    [paymentMethods.data, selectedId],
  );

  // Report a final request state once. Done reports `completed` itself.
  const reported = React.useRef(false);
  const report = React.useCallback(
    (outcome: TopUpOutcome) => {
      if (reported.current) return;
      reported.current = true;
      onDone?.(outcome);
    },
    [onDone],
  );
  React.useEffect(() => {
    if (!req) return;
    if (req.status === "denied" || req.status === "failed")
      report({ status: req.status, request: req });
    else if (req.status === "expired" || isTopUpRequestPastDeadline(req))
      report({ status: "expired", request: req });
  }, [req, report]);

  async function preview() {
    setActionError(undefined);
    setStep("preview");
    const result = await topUp.create(toDecimalString(amount, 2), requestId);
    if (result.phase === "error") setStep("status");
  }

  async function pay() {
    if (!selectedId) return;
    setStep("status");
    await topUp.pay(selectedId);
    void request.refetch();
  }

  function backToAmount() {
    topUp.reset();
    setStep("amount");
  }

  function done() {
    const view = topUp.view;
    const received = view?.quote.receive ?? (amount ? credits(amount) : undefined);
    report({ status: "completed", request: req, received, orderId: view?.orderId });
  }

  async function decline() {
    if (!req) return;
    setDeclining(true);
    setActionError(undefined);
    try {
      request.setData(await api.denyTopUpRequest(req.id));
    } catch (e) {
      setActionError(e);
    } finally {
      setDeclining(false);
    }
  }

  // ----- Render -----

  const shell = { variant, className: cn("min-h-[32rem]", className) };
  const scale = variant === "plain" ? "page" : "panel";

  if (requestId && request.loading && !req) {
    return (
      <Shell {...shell}>
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-16 w-1/2" />
        <div className="flex-1" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-14 w-full" />
      </Shell>
    );
  }

  if (requestId && !req) {
    return (
      <Shell {...shell}>
        <Header
          scale={scale}
          title="We could not open this request."
          sub="The link may be old, or the request may be gone. Nothing was charged."
        />
        <Button type="button" size="xl" className="w-full" onClick={() => void request.refetch()}>
          Try again
        </Button>
      </Shell>
    );
  }

  // The request's own endings, when the order on this screen did not get there first.
  if (req && topUp.phase !== "success") {
    if (req.status === "completed") {
      return (
        <Shell {...shell}>
          <TopUpStatus
            phase="success"
            error={undefined}
            received={req.received?.value ?? req.amount.value}
            pending={false}
            onDone={() =>
              report({
                status: "completed",
                request: req,
                received: req.received,
                orderId: req.orderId,
              })
            }
            onRetry={backToAmount}
            onBack={backToAmount}
          />
        </Shell>
      );
    }
    if (req.status === "denied") {
      return (
        <Shell {...shell}>
          <Header
            scale={scale}
            title="Declined"
            sub={`${req.requester} will not get the credits it asked for.`}
          />
          <p className="text-sm text-muted-foreground">You can close this tab.</p>
        </Shell>
      );
    }
    if (req.status === "expired" || isTopUpRequestPastDeadline(req)) {
      return (
        <Shell {...shell}>
          <Clock aria-hidden className="size-12 text-muted-foreground" />
          <Header
            scale={scale}
            title="This request expired"
            sub={`Ask ${req.requester} to send a new one.`}
          />
        </Shell>
      );
    }
    if (req.status === "failed") {
      return (
        <Shell {...shell}>
          <AlertCircle aria-hidden className="size-12 text-destructive" />
          <Header
            scale={scale}
            title="Something went wrong"
            sub={req.failureReason ?? "The credits could not be added."}
          />
        </Shell>
      );
    }
  }

  const heading = TOP_UP_ASK.title;
  const sub = req
    ? req.reason
      ? `${req.requester} asks for ${formatCredits(req.amount.value, { symbol: false })} credits: ${req.reason}`
      : `${req.requester} asks for ${formatCredits(req.amount.value, { symbol: false })} credits.`
    : TOP_UP_ASK.sub;

  return (
    <Shell {...shell}>
      {step === "amount" ? (
        <>
          <TopUpAmount
            amount={amount}
            onAmountChange={setAmount}
            heading={heading}
            sub={sub}
            container={container}
            enabled={!pickerOpen}
            method={method}
            methodsLoading={paymentMethods.loading}
            error={actionError ? errorMessage(actionError) : undefined}
            onChangeMethod={() => setPickerOpen(true)}
            onPreview={() => void preview()}
            onClose={onClose}
            onDecline={req && req.status === "pending" ? () => void decline() : undefined}
            declining={declining}
          />
          <PaymentMethodSheet
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            container={container}
            paymentMethods={paymentMethods.data}
            loading={paymentMethods.loading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdded={(pm) => paymentMethods.setData((prev) => upsert(prev, pm))}
          />
        </>
      ) : step === "preview" ? (
        <TopUpPreview
          amount={amount}
          view={topUp.phase === "creating" ? undefined : topUp.view}
          method={method}
          busy={topUp.phase === "creating"}
          onBack={backToAmount}
          onPay={() => void pay()}
        />
      ) : (
        <TopUpStatus
          phase={topUp.phase}
          error={topUp.error}
          received={topUp.view?.quote.receive.value ?? amount}
          pending={topUp.pending}
          onDone={done}
          onRetry={backToAmount}
          onBack={() => (onClose ? onClose() : backToAmount())}
        />
      )}
      {actionError && step !== "amount" ? (
        <Problem title="That did not work" message={errorMessage(actionError)} />
      ) : null}
    </Shell>
  );
}

/** "10.00" → "10", "12.50" → "12.5": what the keypad would have typed. */
function rawAmount(value: string): string {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Number(n.toFixed(2)));
}

function upsert(prev: PaymentMethod[] | undefined, pm: PaymentMethod): PaymentMethod[] {
  const list = prev ?? [];
  if (list.some((x) => x.paymentMethodId === pm.paymentMethodId)) return list;
  return [...list, pm];
}
