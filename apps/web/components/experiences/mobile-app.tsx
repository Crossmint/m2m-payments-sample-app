"use client";

import {
  useCallback,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  LogOut,
  Plus,
  Square,
  Wallet,
} from "lucide-react";
import {
  ApproveAgentAccess,
  Badge,
  Button,
  CardMark,
  PaymentsTable,
  SaveCard,
  Skeleton,
  Spinner,
  TopUp,
  WalletCard,
  errorMessage,
  formatDate,
  paymentMethodLabel,
  usePaymentMethods,
  usePayments,
  useWallet,
  type AccessOutcome,
  type TopUpOutcome,
} from "@m2m-payments/ui";
import { AGENT_NAME, AgentAvatar } from "@/components/brand";
import { DeviceFrame } from "@/components/frame/device-frame";
import {
  PAGE_SHEET_TRANSITION_MS,
  PhonePageSheet,
  PhoneSheet,
} from "@/components/frame/phone-sheet";
import { PhoneStatusBar } from "@/components/frame/phone-status-bar";
import { LoginForm } from "@/components/login-form";
import {
  accessLabel,
  findTopUpRequest,
  formatCreditsShort,
  isPaymentPart,
  messageText,
  paymentOf,
  toAccessOutcome,
  toTopUpOutcome,
  toolBusy,
  toolTitle,
  topUpLabel,
} from "@/components/chat/parts";
import { PaymentCardCompact } from "@/components/chat/payment-card";
import { Text } from "@/components/chat/text";
import { SUGGESTIONS, type AgentChat } from "@/components/chat/use-agent-chat";
import { useScrollToBottom } from "@/components/chat/use-scroll-to-bottom";
import type { AccessOutcomeOutput, TopUpOutcomeOutput } from "@/lib/chat/tools";
import type { ChatMessage, ChatMessagePart } from "@/lib/chat/types";
import { cn } from "@/lib/cn";
import { brandAttr, initialOf, loginNext, type ExperienceProps } from "./types";

/** How long an ending stays on screen before its sheet slides away. */
const DONE_LINGER_MS = 800;

/**
 * The app as a phone: one chat screen with two round buttons, Wallet and
 * Account, that open bottom sheets. An access request opens as a sheet over
 * the chat; a top-up opens as a full page that slides up, the way the
 * onramp's deposit sheet does. Everything stays inside the phone.
 */
export function MobileApp(props: ExperienceProps) {
  // The sheets portal into the screen so they stay inside the frame.
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  return (
    <DeviceFrame className="flex-1 md:flex-none" reserveTop={props.reserveTop}>
      {/* The brand wraps the screen, not the phone: the chrome stays, the app re-themes. */}
      <div
        ref={setScreen}
        data-brand={brandAttr(props.brand)}
        className="relative flex h-full min-h-0 flex-1 flex-col bg-background text-foreground"
      >
        <PhoneStatusBar />
        {props.signedIn ? (
          <Home {...props} screen={screen} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-10 pb-8 scrollbar-none">
            <LoginForm next={loginNext(props)} onSignedIn={props.onSignedIn} />
          </div>
        )}
      </div>
    </DeviceFrame>
  );
}

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

type Approval = { toolCallId: string; requestId: string };

/** A top-up page: from the agent's request, or from the Wallet sheet's Add credits. */
type TopUpPage = { toolCallId?: string; requestId?: string };

function Home({
  screen,
  email,
  chat,
  thread,
  chatEnabled,
  onSignOut,
}: ExperienceProps & { screen: HTMLDivElement | null }) {
  const [walletOpen, setWalletOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [approval, setApproval] = useState<Approval | null>(null);
  // The top-up page keeps its request through the slide-out, so it does not go blank while leaving.
  const [topUp, setTopUp] = useState<TopUpPage | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);

  const openTopUp = useCallback((page: TopUpPage) => {
    setTopUp(page);
    setTopUpOpen(true);
  }, []);
  const closeTopUp = useCallback(() => {
    setTopUpOpen(false);
    setTimeout(() => setTopUp(null), PAGE_SHEET_TRANSITION_MS);
  }, []);

  const onApprovalDone = useCallback(
    (o: AccessOutcome) => {
      if (!approval) return;
      chat.onAccessOutcome(approval.toolCallId, toAccessOutcome(o));
      setTimeout(() => setApproval(null), DONE_LINGER_MS);
    },
    [approval, chat],
  );

  const onTopUpDone = useCallback(
    (o: TopUpOutcome) => {
      if (topUp?.toolCallId) chat.onTopUpOutcome(topUp.toolCallId, toTopUpOutcome(o));
      setTimeout(closeTopUp, DONE_LINGER_MS);
    },
    [topUp, chat, closeTopUp],
  );

  return (
    <>
      <div className="flex items-center gap-3 px-5 pt-6 md:pt-2">
        <h1 className="flex-1 text-[28px] leading-[1.2] font-medium tracking-[-0.02em]">Chat</h1>
        <RoundButton label="Wallet" onClick={() => setWalletOpen(true)}>
          <Wallet className="size-4.5" />
        </RoundButton>
        <RoundButton label="Account" onClick={() => setAccountOpen(true)}>
          <span className="text-sm font-semibold text-primary">{initialOf(email)}</span>
        </RoundButton>
      </div>

      <Thread
        chat={chat}
        loading={thread.loading}
        chatEnabled={chatEnabled}
        onReview={setApproval}
        onReviewTopUp={(page) => openTopUp(page)}
      />
      <Composer chat={chat} disabled={!chatEnabled} />

      <PhoneSheet open={walletOpen} onOpenChange={setWalletOpen} container={screen} title="Wallet">
        {walletOpen ? (
          <WalletSheetBody
            onAddCredits={() => {
              setWalletOpen(false);
              openTopUp({});
            }}
          />
        ) : null}
      </PhoneSheet>

      <PhoneSheet
        open={accountOpen}
        onOpenChange={setAccountOpen}
        container={screen}
        title="Account"
        height="h-[80%]"
      >
        <AccountSheetBody email={email} onSignOut={onSignOut} />
      </PhoneSheet>

      <PhoneSheet
        open={approval !== null}
        onOpenChange={(open) => !open && setApproval(null)}
        container={screen}
        title="Approve"
        hideTitle
      >
        {approval ? (
          <ApproveAgentAccess
            requestId={approval.requestId}
            variant="plain"
            agentName={AGENT_NAME}
            onDone={onApprovalDone}
          />
        ) : null}
      </PhoneSheet>

      <PhonePageSheet open={topUpOpen} ariaLabel="Add credits">
        <div className="flex items-center gap-3 px-5 pt-6 pb-2 md:pt-14">
          <RoundButton label="Back" onClick={closeTopUp}>
            <ArrowLeft className="size-4.5" />
          </RoundButton>
          <h2 className="text-lg font-medium tracking-[-0.02em]">Add credits</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 scrollbar-none">
          {topUp ? (
            <TopUp
              key={topUp.requestId ?? "free"}
              requestId={topUp.requestId}
              variant="plain"
              container={screen}
              onDone={onTopUpDone}
              onClose={closeTopUp}
            />
          ) : null}
        </div>
      </PhonePageSheet>
    </>
  );
}

function RoundButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-muted-strong"
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The thread
// ---------------------------------------------------------------------------

function Thread({
  chat,
  loading,
  chatEnabled,
  onReview,
  onReviewTopUp,
}: {
  chat: AgentChat;
  loading: boolean;
  chatEnabled: boolean;
  onReview: (approval: Approval) => void;
  onReviewTopUp: (page: Required<TopUpPage>) => void;
}) {
  const { containerRef } = useScrollToBottom();
  const last = chat.messages.at(-1);
  const waiting = chat.status === "submitted" && last?.role !== "assistant";

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Spinner />
      </div>
    );
  }

  if (!chatEnabled) {
    return (
      <div className="flex flex-1 flex-col justify-center px-5">
        <Notice>Chat is off. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to turn it on.</Notice>
      </div>
    );
  }

  if (chat.messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col justify-end gap-6 px-5 pb-4">
        <div className="flex flex-col gap-3">
          <AgentAvatar size={40} />
          <p className="text-[24px] leading-[1.2] font-medium tracking-[-0.02em] text-balance">
            Hi, I am {AGENT_NAME}. What should I look up for you?
          </p>
          <p className="text-sm text-muted-foreground">
            Ask for a brief or a paid inference. I pay the machine from your wallet once you
            approve.
          </p>
        </div>
        <ul className="flex flex-col gap-2" aria-label="Suggestions">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => chat.send(s)}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-muted px-4 py-3 text-left text-sm transition-colors hover:bg-muted-strong"
              >
                <span className="min-w-0 truncate">{s}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={containerRef} className="absolute inset-0 overflow-y-auto scrollbar-none">
        <div className="flex flex-col gap-3 px-5 py-4">
          {chat.messages.map((m, i) => (
            <CompactMessage
              key={m.id}
              message={m}
              streaming={chat.status === "streaming" && i === chat.messages.length - 1}
              onReview={onReview}
              onReviewTopUp={onReviewTopUp}
            />
          ))}
          {waiting ? <ActivityLine busy>Thinking</ActivityLine> : null}
          {chat.error ? (
            <Notice tone="error" onDismiss={chat.dismissError}>
              {chat.error}
            </Notice>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CompactMessage({
  message,
  streaming,
  onReview,
  onReviewTopUp,
}: {
  message: ChatMessage;
  streaming: boolean;
  onReview: (a: Approval) => void;
  onReviewTopUp: (page: Required<TopUpPage>) => void;
}) {
  if (message.role === "user") {
    const text = messageText(message);
    return text ? (
      <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-snug break-words whitespace-pre-wrap text-primary-foreground">
        {text}
      </div>
    ) : null;
  }
  if (message.role !== "assistant") return null;
  const parts = message.parts.map((part, i) => (
    <CompactPart
      key={`${message.id}-${i}`}
      part={part}
      message={message}
      onReview={onReview}
      onReviewTopUp={onReviewTopUp}
    />
  ));
  const empty = parts.every((p) => p === null) && streaming;
  return (
    <div className="flex flex-col gap-2">
      {empty ? <ActivityLine busy>Thinking</ActivityLine> : null}
      {parts}
    </div>
  );
}

function CompactPart({
  part,
  message,
  onReview,
  onReviewTopUp,
}: {
  part: ChatMessagePart;
  message: ChatMessage;
  onReview: (a: Approval) => void;
  onReviewTopUp: (page: Required<TopUpPage>) => void;
}) {
  switch (part.type) {
    case "text":
      return part.text.trim() ? (
        <Text text={part.text} className="max-w-[92%] text-[15px] leading-snug" />
      ) : null;

    case "tool-await_wallet_access": {
      if (part.state === "input-available") {
        return (
          <ApprovalCard
            title="Your agent wants to use your wallet"
            action={
              <Button
                type="button"
                size="xl"
                className="w-full"
                onClick={() =>
                  onReview({ toolCallId: part.toolCallId, requestId: part.input.requestId })
                }
              >
                Review
              </Button>
            }
          />
        );
      }
      if (part.state === "output-available") {
        return <ApprovalCard title="Wallet access" outcome={part.output} />;
      }
      return (
        <ActivityLine busy={toolBusy(part.state)} failed={part.state === "output-error"}>
          {toolTitle(part.type)}
        </ActivityLine>
      );
    }

    case "tool-await_top_up": {
      const request = findTopUpRequest(message, part.input?.requestId ?? "");
      const asked = request ? formatCreditsShort(request.amount) : "credits";
      if (part.state === "input-available") {
        return (
          <TopUpCard
            title={`Your agent asks for ${asked}`}
            action={
              <Button
                type="button"
                size="xl"
                className="w-full"
                onClick={() =>
                  onReviewTopUp({ toolCallId: part.toolCallId, requestId: part.input.requestId })
                }
              >
                Review
              </Button>
            }
          />
        );
      }
      if (part.state === "output-available") {
        return <TopUpCard title={`Top-up of ${asked}`} outcome={part.output} />;
      }
      return (
        <ActivityLine busy={toolBusy(part.state)} failed={part.state === "output-error"}>
          {toolTitle(part.type)}
        </ActivityLine>
      );
    }

    default: {
      if (isPaymentPart(part)) {
        const summary = paymentOf(part);
        if (summary) return <PaymentCardCompact summary={summary} />;
        const failed =
          part.state === "output-error" ||
          (part.state === "output-available" &&
            Boolean((part.output as { error?: unknown } | undefined)?.error));
        return (
          <ActivityLine busy={toolBusy(part.state)} failed={failed}>
            {toolTitle(part.type)}
          </ActivityLine>
        );
      }
      if (part.type.startsWith("tool-")) {
        const tool = part as { type: string; state: string; output?: unknown };
        const failed =
          tool.state === "output-error" ||
          (tool.state === "output-available" &&
            Boolean((tool.output as { error?: unknown } | undefined)?.error));
        return (
          <ActivityLine busy={toolBusy(tool.state)} failed={failed}>
            {toolTitle(tool.type)}
          </ActivityLine>
        );
      }
      return null;
    }
  }
}

/** "Checking your wallet", with a spinner while it runs and a check when it is done. */
function ActivityLine({
  busy,
  failed,
  children,
}: {
  busy?: boolean;
  failed?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground",
        failed && "text-destructive",
      )}
    >
      {busy ? (
        <Spinner className="size-3" />
      ) : failed ? (
        <CircleAlert className="size-3.5" />
      ) : (
        <CircleCheck className="size-3.5 text-success" />
      )}
      <span className="truncate">{children}</span>
    </div>
  );
}

function ApprovalCard({
  title,
  action,
  outcome,
}: {
  title: string;
  action?: ReactNode;
  outcome?: AccessOutcomeOutput;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-snug font-medium text-balance">{title}</p>
        {outcome ? (
          <Badge
            variant={
              outcome.status === "active"
                ? "success"
                : outcome.status === "denied"
                  ? "destructive"
                  : "muted"
            }
          >
            {outcome.status}
          </Badge>
        ) : null}
      </div>
      {outcome ? <p className="text-xs text-muted-foreground">{accessLabel(outcome)}</p> : null}
      {action}
    </div>
  );
}

function TopUpCard({
  title,
  action,
  outcome,
}: {
  title: string;
  action?: ReactNode;
  outcome?: TopUpOutcomeOutput;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-snug font-medium text-balance">{title}</p>
        {outcome ? (
          <Badge
            variant={
              outcome.status === "completed"
                ? "success"
                : outcome.status === "denied"
                  ? "destructive"
                  : "muted"
            }
          >
            {outcome.status}
          </Badge>
        ) : null}
      </div>
      {outcome ? <p className="text-xs text-muted-foreground">{topUpLabel(outcome)}</p> : null}
      {action}
    </div>
  );
}

function Notice({
  tone = "muted",
  onDismiss,
  children,
}: {
  tone?: "muted" | "error";
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl px-4 py-3 text-sm",
        tone === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      <p className="min-w-0 flex-1">{children}</p>
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-xs font-medium underline-offset-4 hover:underline"
        >
          Dismiss
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The composer
// ---------------------------------------------------------------------------

function Composer({ chat, disabled }: { chat: AgentChat; disabled: boolean }) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canSend = !chat.busy && !disabled && text.trim().length > 0;

  function submit() {
    if (!canSend) return;
    chat.send(text.trim());
    setText("");
    inputRef.current?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      className="shrink-0 px-4 pt-2 pb-6"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex h-12 items-center gap-2 rounded-full bg-muted pr-1.5 pl-4">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder="Ask the agent for a brief"
          aria-label="Message"
          className="min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        {chat.busy ? (
          <button
            type="button"
            aria-label="Stop"
            onClick={chat.stop}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background"
          >
            <Square className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            aria-label="Send"
            disabled={!canSend}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
          >
            <ArrowUp className="size-4.5" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The Wallet sheet: the balance, the agent's access, the payments, the cards.
// ---------------------------------------------------------------------------

function WalletSheetBody({ onAddCredits }: { onAddCredits: () => void }) {
  const [panel, setPanel] = useState<"list" | "form">("list");
  const wallet = useWallet();
  const payments = usePayments({ limit: 20 });
  const paymentMethods = usePaymentMethods();
  const access = wallet.data?.agentAccess;

  if (panel === "form") {
    return (
      <Panel title="Add card" onBack={() => setPanel("list")}>
        <SaveCard
          showResult={false}
          onSaved={async () => {
            await paymentMethods.refetch();
            setPanel("list");
          }}
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-8 pt-2 animate-in fade-in duration-200">
      {/* The card runs the revoke itself and tells us when it is done. */}
      <WalletCard
        compact
        onAddCredits={onAddCredits}
        onRevokeAccess={() => void wallet.refetch()}
      />

      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Agent access</p>
        {wallet.loading && !wallet.data ? (
          <Skeleton className="h-12 rounded-xl" />
        ) : wallet.notFound ? (
          <p className="text-sm text-muted-foreground">Your wallet is being created.</p>
        ) : access ? (
          <div className="flex items-center gap-3">
            <Badge
              variant={
                access.status === "active"
                  ? "success"
                  : access.status === "pending"
                    ? "warning"
                    : "muted"
              }
            >
              {access.status}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-sm">
              {access.status === "active"
                ? `Active${access.grantedAt ? ` since ${formatDate(access.grantedAt)}` : ""}`
                : access.status === "pending"
                  ? "Waiting for your approval"
                  : access.status === "revoked"
                    ? "Revoked"
                    : "Not granted. The agent asks when it needs it."}
            </span>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">Payments</p>
        {payments.error && !payments.data ? (
          <p className="text-sm text-destructive">{errorMessage(payments.error)}</p>
        ) : (
          <PaymentsTable
            compact
            payments={payments.data}
            loading={payments.loading && !payments.data}
          />
        )}
      </section>

      <section className="flex flex-col gap-1">
        <p className="pb-1 text-sm text-muted-foreground">Saved cards</p>
        <SavedCardRows cards={paymentMethods} />
        <button
          type="button"
          onClick={() => setPanel("form")}
          className="flex w-full items-center gap-3 py-3.5 text-left"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <Plus className="size-4.5" />
          </span>
          <span className="flex-1">
            <span className="block text-sm font-medium">Add new card</span>
            <span className="block text-xs text-muted-foreground">Debit or credit card</span>
          </span>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </section>
    </div>
  );
}

/** A panel of the Wallet sheet behind a back button, in the sheet's own frame. */
function Panel({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex items-center gap-3">
        <RoundButton label="Back" onClick={onBack}>
          <ArrowLeft className="size-4.5" />
        </RoundButton>
        <p className="min-w-0 flex-1 truncate text-base font-medium">{title}</p>
      </div>
      {children}
    </div>
  );
}

function SavedCardRows({ cards }: { cards: ReturnType<typeof usePaymentMethods> }) {
  const { data, loading, error, remove } = cards;
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-2 py-2">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }
  if (error && !data) return <p className="py-2 text-sm text-destructive">{errorMessage(error)}</p>;
  if (!data?.length)
    return <p className="py-2 text-sm text-muted-foreground">No cards yet. Add one below.</p>;

  return (
    <ul className="flex flex-col">
      {data.map((pm) => (
        <li
          key={pm.paymentMethodId}
          className="flex items-center gap-3 border-b border-border/60 py-3.5"
        >
          <span className="flex w-9 shrink-0 justify-center">
            <CardMark paymentMethod={pm} size="md" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{paymentMethodLabel(pm)}</span>
            {pm.card?.expiration ? (
              <span className="block text-xs text-muted-foreground">
                Expires {pm.card.expiration.month}/{pm.card.expiration.year}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            disabled={busy === pm.paymentMethodId}
            onClick={async () => {
              if (!window.confirm(`Remove ${paymentMethodLabel(pm)}?`)) return;
              setBusy(pm.paymentMethodId);
              try {
                await remove(pm.paymentMethodId);
              } finally {
                setBusy(null);
              }
            }}
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            {busy === pm.paymentMethodId ? <Spinner className="size-3.5" /> : "Remove"}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The Account sheet
// ---------------------------------------------------------------------------

function AccountSheetBody({ email, onSignOut }: Pick<ExperienceProps, "email" | "onSignOut">) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-full flex-col gap-8 pt-2">
      <div className="flex flex-col items-center gap-3 pt-4">
        <span className="flex size-16 items-center justify-center rounded-full bg-muted text-2xl font-semibold text-primary">
          {initialOf(email)}
        </span>
        <p className="text-sm font-medium">{email ?? "Signed in"}</p>
      </div>
      <Button
        type="button"
        variant="secondary"
        size="xl"
        className="mt-auto w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onSignOut();
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <Spinner /> : <LogOut />}
        Log out
      </Button>
    </div>
  );
}
