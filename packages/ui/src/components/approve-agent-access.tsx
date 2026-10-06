"use client";

import * as React from "react";
import type { AccessRequest } from "@m2m-payments/core";
import { AlertCircle, Clock, Lock } from "lucide-react";
import { M2mPaymentsApiError, errorMessage } from "../api/client.js";
import { isAccessRequestPastDeadline, useAccessRequest } from "../hooks/use-access-request.js";
import { useWallet } from "../hooks/use-wallet.js";
import { shortAddress } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { useM2mPayments, useSdkWallet } from "../provider.js";
import { Button } from "./primitives/button.js";
import { Skeleton } from "./primitives/skeleton.js";
import { Spinner } from "./primitives/spinner.js";

/**
 * What the approval screen says. Exported so every surface that shows the
 * step words it the same way.
 */
export const ACCESS_ASK = {
  title: "wants to use your wallet",
  sub: "Approve it once. After that it pays in the background.",
} as const;

/** What agent access lets the agent do. One line, the same everywhere. */
export const ACCESS_CAN_DO = "Pay x402 and MPP services, transfer credits, send transactions";

export type AccessOutcomeStatus = "active" | "denied" | "expired" | "failed";

export interface AccessOutcome {
  status: AccessOutcomeStatus;
  request: AccessRequest;
}

export interface ApproveAgentAccessProps {
  requestId: string;
  /**
   * "card" stands the screen on its own white panel, which is what a host
   * page usually wants. "plain" drops the panel so the page's own frame, a
   * phone screen, can hold it. Default "card".
   */
  variant?: "card" | "plain";
  /** Overrides the requester's name in the headline. */
  agentName?: string;
  /** Called once the request reaches a final state. */
  onDone?: (outcome: AccessOutcome) => void;
  className?: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "approving" }
  /** The SDK's email code prompt is up, or the signer is landing on chain. */
  | { kind: "confirming" }
  | { kind: "denying" };

/**
 * The approval screen. Structure is fixed:
 * 1. Headline: "<Agent> wants to use your wallet".
 * 2. What is being asked for: Agent, Reason when set, Can do, From.
 * 3. One reassurance line with a lock.
 * 4. Full-width Allow. A grey full-width Deny under it.
 *
 * Allow prepares the agent's signer on the server, then the wallet SDK signs
 * the approval with the email signer, which shows Crossmint's code prompt,
 * then the server confirms the signer landed. Every ending replaces the
 * screen, in the same vocabulary as the Agent Commerce approval card.
 */
export function ApproveAgentAccess({
  requestId,
  variant = "card",
  agentName,
  onDone,
  className,
}: ApproveAgentAccessProps) {
  const { api, userEmail } = useM2mPayments();
  const sdk = useSdkWallet();
  const request = useAccessRequest(requestId);
  const req = request.data;
  const isOpen = req?.status === "pending" || req?.status === "approved";
  const wallet = useWallet({ enabled: isOpen, pollMs: 0 });

  const [phase, setPhase] = React.useState<Phase>({ kind: "idle" });
  const [actionError, setActionError] = React.useState<unknown>(undefined);

  const name = agentName ?? req?.requester ?? "Your agent";

  // Report the final state once.
  const reported = React.useRef(false);
  React.useEffect(() => {
    if (!req || reported.current) return;
    const final: AccessOutcomeStatus | null =
      req.status === "active"
        ? "active"
        : req.status === "denied"
          ? "denied"
          : req.status === "expired" || isAccessRequestPastDeadline(req)
            ? "expired"
            : req.status === "failed"
              ? "failed"
              : null;
    if (final) {
      reported.current = true;
      onDone?.({ status: final, request: req });
    }
  }, [req, onDone]);

  const allow = React.useCallback(async () => {
    if (!req) return;
    setActionError(undefined);
    setPhase({ kind: "approving" });
    try {
      const sdkWallet = sdk.wallet;
      if (!sdkWallet) {
        throw new Error(
          "Your wallet is not ready in this browser yet. Wait a moment and try again.",
        );
      }
      const prepared = await api.approveAccessRequest(req.id);
      request.setData(prepared.request);

      // The email signer is the recovery signer. Approving with it makes the
      // SDK send a code to the user's email and show its own prompt.
      setPhase({ kind: "confirming" });
      const email = userEmail ?? (await api.me().catch(() => undefined))?.email;
      await sdkWallet.useSigner({ type: "email", email });
      if (prepared.signatureId) {
        await sdkWallet.approve({ signatureId: prepared.signatureId });
      } else if (prepared.transactionId) {
        await sdkWallet.approve({ transactionId: prepared.transactionId });
      }

      try {
        const confirmed = await api.confirmAccessRequest(req.id);
        request.setData(confirmed.request);
      } catch (e) {
        // Not on chain yet. The hook keeps polling while `approved`, and the
        // server moves the request to `active` when the signer is there.
        if (!(e instanceof M2mPaymentsApiError && e.code === "access_pending")) throw e;
      }
      setPhase({ kind: "idle" });
    } catch (e) {
      setActionError(e);
      setPhase({ kind: "idle" });
      void request.refetch();
    }
  }, [api, req, request, sdk.wallet, userEmail]);

  // Returning to an approved request: the signer is prepared but not signed.
  // Resume at the SDK step once the wallet is in hand, once per request.
  const resumedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!req || req.status !== "approved" || phase.kind !== "idle") return;
    if (!sdk.wallet || resumedFor.current === req.id) return;
    resumedFor.current = req.id;
    void allow();
  }, [req, sdk.wallet, phase.kind, allow]);

  async function deny() {
    if (!req) return;
    setActionError(undefined);
    setPhase({ kind: "denying" });
    try {
      const result = await api.denyAccessRequest(req.id);
      request.setData(result);
    } catch (e) {
      setActionError(e);
    } finally {
      setPhase({ kind: "idle" });
    }
  }

  // ----- Render -----

  const shell = { variant, className };
  // On its own page the headline carries the screen; inside a host panel it
  // has to sit among other type.
  const scale: HeaderScale = variant === "plain" ? "page" : "panel";

  if (request.loading && !req) {
    return (
      <Shell {...shell}>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-2/3" />
        </div>
        <Skeleton className="h-52 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </Shell>
    );
  }

  // Same shape as a not-found page: a line saying what happened, then the one
  // thing worth doing about it.
  if (!req) {
    return (
      <Shell {...shell}>
        <Header
          scale={scale}
          title="We could not open this request."
          sub="The link may be old, or the request may be gone. Nothing changed on your wallet."
        />
        <Button type="button" size="xl" className="w-full" onClick={() => void request.refetch()}>
          Try again
        </Button>
      </Shell>
    );
  }

  // The ending: the small word, the agent's name as the headline, what it can do now.
  if (req.status === "active") {
    return (
      <Shell {...shell}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">Approved</p>
          <p
            className={cn(
              "font-display font-semibold tracking-tight text-primary text-balance",
              scale === "page" ? "text-5xl" : "text-4xl",
            )}
          >
            {name}
          </p>
          <p className="text-base text-muted-foreground">
            It can now pay from your wallet. Revoke it any time from the app.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">You can close this tab.</p>
      </Shell>
    );
  }

  // A denial is a choice, not a fault, so it is not painted in the error colour.
  if (req.status === "denied") {
    return (
      <Shell {...shell}>
        <Header scale={scale} title="Denied" sub={`${name} cannot use your wallet.`} />
        <p className="text-sm text-muted-foreground">You can close this tab.</p>
      </Shell>
    );
  }

  if (req.status === "expired" || isAccessRequestPastDeadline(req)) {
    return (
      <Shell {...shell}>
        <Clock aria-hidden className="size-12 text-muted-foreground" />
        <Header scale={scale} title="This request expired" sub={`Ask ${name} to send a new one.`} />
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
          sub={req.failureReason ?? "The agent could not be added to your wallet."}
        />
      </Shell>
    );
  }

  // pending or approved
  const busy = phase.kind !== "idle";
  const walletReady = Boolean(wallet.data) && Boolean(sdk.wallet);
  const sdkFailed = sdk.status === "error";

  return (
    <Shell {...shell}>
      <Header scale={scale} title={`${name} ${ACCESS_ASK.title}`} sub={ACCESS_ASK.sub} />

      <dl className="flex flex-col rounded-2xl border border-border px-5">
        <Row label="Agent" strong>
          {req.requester}
        </Row>
        {req.reason ? <Row label="Reason">{req.reason}</Row> : null}
        <Row label="Can do">{ACCESS_CAN_DO}</Row>
        <Row label="From">
          {wallet.data ? (
            <span className="font-mono tabular-nums" title={wallet.data.address}>
              {shortAddress(wallet.data.address)}
            </span>
          ) : wallet.notFound ? (
            "Your new wallet"
          ) : (
            <Skeleton className="inline-block h-4 w-28 align-middle" />
          )}
        </Row>
      </dl>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
        You confirm with a code sent to your email. You can revoke access any time from the app.
      </p>

      {actionError ? (
        <Problem title="That did not work" message={errorMessage(actionError)} />
      ) : null}
      {sdkFailed ? (
        <Problem
          title="Your wallet is not available in this browser"
          message={
            sdk.error?.message ?? "The wallet SDK did not start. Reload the page and try again."
          }
        />
      ) : null}

      {phase.kind === "confirming" ? (
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-4 text-sm">
          <Spinner className="text-primary" />
          <span>Confirming with your email code</span>
        </div>
      ) : wallet.notFound ? (
        <div className="flex items-center gap-3 rounded-2xl bg-muted p-4 text-sm">
          <Spinner className="text-primary" />
          <span>Creating your wallet</span>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="xl"
            className="w-full"
            disabled={busy || !walletReady || sdkFailed}
            onClick={() => void allow()}
          >
            {phase.kind === "approving" || (!walletReady && !sdkFailed) ? <Spinner /> : null}
            {req.status === "approved" ? "Continue" : "Allow"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="xl"
            className="w-full"
            disabled={busy}
            onClick={() => void deny()}
          >
            {phase.kind === "denying" ? <Spinner /> : null}
            Deny
          </Button>
        </div>
      )}
    </Shell>
  );
}

/**
 * The column the screen lives in. `card` gives it its own panel; `plain`
 * leaves it to the page, which is what the sample app's pages do: the phone
 * screen is the frame.
 */
export function Shell({
  variant = "card",
  className,
  children,
}: {
  variant?: "card" | "plain";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full flex-col gap-6",
        variant === "card" &&
          "max-w-md rounded-2xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type HeaderScale = "page" | "panel";

/**
 * The headline and the line under it, set like the onramp sample app's
 * screens: on a page the step's name is 28px medium; inside a host panel it
 * steps down so it can sit among other type.
 */
export function Header({
  title,
  sub,
  scale = "panel",
}: {
  title: string;
  sub?: string;
  scale?: HeaderScale;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h1
        className={cn(
          "text-balance text-foreground",
          scale === "page"
            ? "text-[28px] leading-[1.2] font-medium tracking-[-0.02em]"
            : "text-xl font-medium",
        )}
      >
        {title}
      </h1>
      {sub ? (
        <p className={cn("text-muted-foreground", scale === "page" ? "text-base" : "text-sm")}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

/** A fault, said plainly: the icon, a title, one line. */
export function Problem({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="flex items-start gap-3">
      <AlertCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

/** One line of the request: what it is on the left, what it says on the right. */
export function Row({
  label,
  strong = false,
  children,
}: {
  label: string;
  strong?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border/60 py-4 last:border-0">
      <dt
        className={cn(
          "shrink-0 text-sm",
          strong ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </dt>
      <dd className={cn("min-w-0 text-right text-sm", strong ? "font-semibold" : "font-medium")}>
        {children}
      </dd>
    </div>
  );
}
