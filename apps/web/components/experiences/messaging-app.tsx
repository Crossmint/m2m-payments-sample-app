"use client";

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { ApproveAgentAccess, TopUp, type AccessOutcome, type TopUpOutcome } from "@m2m-payments/ui";
import { AGENT_DOMAIN, AGENT_NAME, AgentAvatar, AgentMark } from "@/components/brand";
import {
  findTopUpRequest,
  formatCreditsShort,
  isPaymentPart,
  paymentKindLabel,
  paymentOf,
  toAccessOutcome,
  toTopUpOutcome,
} from "@/components/chat/parts";
import { useScrollToBottom } from "@/components/chat/use-scroll-to-bottom";
import { DeviceFrame } from "@/components/frame/device-frame";
import { PAGE_SHEET_TRANSITION_MS, PhonePageSheet } from "@/components/frame/phone-sheet";
import { PhoneStatusBar } from "@/components/frame/phone-status-bar";
import type { MessagingApp as MessagingAppId } from "@/components/frame/views";
import { LoginForm } from "@/components/login-form";
import type { ChatMessage } from "@/lib/chat/types";
import { cn } from "@/lib/cn";
import {
  ArrowUpIcon,
  CameraIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DoubleCheckIcon,
  ImageIcon,
  LockIcon,
  MicIcon,
  PhoneIcon,
  PlusIcon,
  StickerIcon,
  VideoIcon,
} from "./messaging-icons";
import { brandAttr, loginNext, type ExperienceProps } from "./types";
import "./messaging.css";

const DONE_LINGER_MS = 800;
/** The first bubble of every thread. It stays when the conversation starts. */
const WELCOME = `Hi, I am ${AGENT_NAME}. Ask me for a brief or a paid inference and I will pay the machine from your wallet, once you approve.`;

/**
 * The app as a conversation in a chat app. The agent is a contact; what it
 * needs from the user arrives as links, and each link opens a page over the
 * thread the way the phone's browser would. Tool work stays out of sight.
 *
 * One thread, three chromes: iMessage, WhatsApp and Instagram Direct, picked
 * by `app`. The chrome imitates the real app and keeps its colours; the
 * pages that open over it are ours and wear the chosen brand.
 */
export function MessagingApp(props: ExperienceProps) {
  const Chrome = CHROMES[props.app];
  return (
    <DeviceFrame className="flex-1 md:flex-none" reserveTop={props.reserveTop}>
      <div
        className={cn(
          "msg relative flex h-full min-h-0 flex-col text-[15px] leading-[1.3]",
          `msg-${props.app}`,
        )}
      >
        <PhoneStatusBar />
        {props.signedIn ? (
          <SignedIn {...props} Chrome={Chrome} />
        ) : (
          <SignedOut {...props} Chrome={Chrome} />
        )}
      </div>
    </DeviceFrame>
  );
}

// ---------------------------------------------------------------------------
// The thread as bubbles
// ---------------------------------------------------------------------------

type Side = "sent" | "recv";

type Bubble =
  | { key: string; kind: "text"; side: Side; text: string }
  /**
   * A link to one of our pages. `path` is shown under the agent's domain and
   * the page itself opens in a sheet. With `href` set, the link is to another
   * site (the block explorer for a receipt) and opens in a new tab.
   */
  | {
      key: string;
      kind: "link";
      side: "recv";
      title: string;
      path: string;
      href?: string;
      done?: string;
      onOpen?: () => void;
    }
  | { key: string; kind: "status"; text: string };

type Approval = { toolCallId: string; requestId: string };
type TopUpAsk = { toolCallId: string; requestId: string };

/** The thread as a flat list of bubbles. A message with two text parts is two bubbles; a tool call is none, a payment is a receipt. */
function toBubbles(
  messages: ChatMessage[],
  onReview: (a: Approval) => void,
  onReviewTopUp: (a: TopUpAsk) => void,
): Bubble[] {
  const out: Bubble[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      const text = m.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n")
        .trim();
      if (text) out.push({ key: m.id, kind: "text", side: "sent", text });
      continue;
    }
    if (m.role !== "assistant") continue;
    m.parts.forEach((part, i) => {
      const key = `${m.id}-${i}`;
      if (part.type === "text") {
        if (part.text.trim()) out.push({ key, kind: "text", side: "recv", text: part.text.trim() });
        return;
      }
      if (
        part.type === "tool-await_wallet_access" &&
        (part.state === "input-available" || part.state === "output-available")
      ) {
        const done =
          part.state === "output-available"
            ? part.output.status === "active"
              ? "Approved"
              : part.output.status === "denied"
                ? "Denied"
                : part.output.status === "expired"
                  ? "Expired"
                  : "Failed"
            : undefined;
        out.push({
          key,
          kind: "link",
          side: "recv",
          title: "Let me use your wallet",
          path: `/approve/${part.input.requestId}`,
          done,
          onOpen: done
            ? undefined
            : () => onReview({ toolCallId: part.toolCallId, requestId: part.input.requestId }),
        });
        return;
      }
      if (
        part.type === "tool-await_top_up" &&
        (part.state === "input-available" || part.state === "output-available")
      ) {
        const request = findTopUpRequest(m, part.input.requestId);
        const done =
          part.state === "output-available"
            ? part.output.status === "completed"
              ? `Added ${formatCreditsShort(part.output.received)}`.trim()
              : part.output.status === "denied"
                ? "Declined"
                : part.output.status === "expired"
                  ? "Expired"
                  : "Failed"
            : undefined;
        out.push({
          key,
          kind: "link",
          side: "recv",
          title: request ? `Add ${formatCreditsShort(request.amount)}` : "Add credits",
          path: `/top-up/${part.input.requestId}`,
          done,
          onOpen: done
            ? undefined
            : () => onReviewTopUp({ toolCallId: part.toolCallId, requestId: part.input.requestId }),
        });
        return;
      }
      if (isPaymentPart(part)) {
        const summary = paymentOf(part);
        if (!summary) return;
        // A receipt: what was paid, to whom, and the transaction on the explorer.
        const amount = summary.amount
          ? formatCreditsShort(summary.amount)
          : paymentKindLabel(summary.kind);
        const title = summary.status === "failed" ? `Payment failed` : `Paid ${amount}`;
        const sub = summary.counterparty
          ? `${paymentKindLabel(summary.kind)} · ${summary.counterparty}`
          : paymentKindLabel(summary.kind);
        out.push({
          key,
          kind: "link",
          side: "recv",
          title: sub,
          path: summary.hash ? `/tx/${summary.hash.slice(0, 10)}…` : "/payments",
          href: summary.explorerUrl,
          done: title,
          onOpen: summary.explorerUrl
            ? () => window.open(summary.explorerUrl, "_blank", "noopener")
            : undefined,
        });
      }
    });
  }
  return out;
}

function sideOf(b: Bubble | undefined): Side | undefined {
  return b && b.kind !== "status" ? b.side : undefined;
}

/** A bubble with its place in the thread: first or last of a run from one side, when it arrived, and whether it is the newest sent one. */
interface Placed {
  bubble: Exclude<Bubble, { kind: "status" }>;
  first: boolean;
  last: boolean;
  time: string;
  seen: boolean;
}

function clock(): string {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * The scrolling thread, shared by the three chromes. Each chrome hands over
 * its canvas, its date line, its status line style and how to draw a bubble.
 */
function Thread({
  bubbles,
  working,
  className,
  dateLine,
  statusClassName,
  renderBubble,
}: {
  bubbles: Bubble[];
  working: boolean;
  className?: string;
  dateLine: (opened: string) => ReactNode;
  statusClassName: string;
  renderBubble: (placed: Placed) => ReactNode;
}) {
  const { containerRef } = useScrollToBottom();
  const [opened] = useState(clock);
  // Each bubble keeps the time it first appeared.
  const [times] = useState(() => new Map<string, string>());
  const timeFor = (key: string) => {
    let t = times.get(key);
    if (!t) {
      t = clock();
      times.set(key, t);
    }
    return t;
  };
  let lastSent = -1;
  bubbles.forEach((b, i) => {
    if (b.kind !== "status" && b.side === "sent") lastSent = i;
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className={cn("absolute inset-0 overflow-y-auto scrollbar-none", className)}
      >
        <div className="flex min-h-full flex-col justify-end px-3 pt-3 pb-1">
          {dateLine(opened)}
          {bubbles.map((b, i) => {
            if (b.kind === "status") {
              return (
                <p key={b.key} className={statusClassName}>
                  {b.text}
                </p>
              );
            }
            const first = sideOf(bubbles[i - 1]) !== b.side;
            const last = sideOf(bubbles[i + 1]) !== b.side;
            return (
              <div key={b.key} className={cn("flex flex-col", last ? "mb-2" : "mb-[3px]")}>
                {renderBubble({
                  bubble: b,
                  first,
                  last,
                  time: timeFor(b.key),
                  seen: i === lastSent,
                })}
              </div>
            );
          })}
          {working ? <p className={statusClassName}>{AGENT_NAME} is working…</p> : null}
        </div>
      </div>
    </div>
  );
}

/** A link bubble is a button while its page can still be opened. */
function LinkShell({
  onOpen,
  className,
  children,
}: {
  onOpen?: () => void;
  className: string;
  children: ReactNode;
}) {
  return onOpen ? (
    <button type="button" onClick={onOpen} className={className}>
      {children}
    </button>
  ) : (
    <div className={className}>{children}</div>
  );
}

/** The URL a link bubble shows. Display only: our pages open in a sheet over the thread; an explorer link opens in a new tab. */
function linkUrl(bubble: { path: string; href?: string }): string {
  return bubble.href ?? `https://${AGENT_DOMAIN}${bubble.path}`;
}

/** The host a link bubble names under its title. */
function linkHost(bubble: { href?: string }): string {
  if (!bubble.href) return AGENT_DOMAIN;
  try {
    return new URL(bubble.href).hostname;
  } catch {
    return AGENT_DOMAIN;
  }
}

// ---------------------------------------------------------------------------
// The composer's state, shared by the three bars
// ---------------------------------------------------------------------------

interface ComposerProps {
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}

function useComposer({ disabled, busy, onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !busy && text.trim().length > 0;

  function submit() {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
    inputRef.current?.focus();
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const inputProps = {
    ref: inputRef,
    value: text,
    onChange: (e: ChangeEvent<HTMLInputElement>) => setText(e.target.value),
    onKeyDown,
    disabled,
  };
  return { typing: text.length > 0, canSend, onSubmit, inputProps };
}

// ---------------------------------------------------------------------------
// The three chromes
// ---------------------------------------------------------------------------

interface ChromeProps {
  bubbles: Bubble[];
  working: boolean;
  composer: ComposerProps;
}

type Chrome = (props: ChromeProps) => ReactNode;

// iMessage -----------------------------------------------------------------

function IMessageChrome({ bubbles, working, composer }: ChromeProps) {
  return (
    <>
      {/* Three columns, so the contact sits in the true centre whatever the sides measure. */}
      <div className="im-bar grid grid-cols-[1fr_auto_1fr] items-end border-b px-3 pt-1 pb-2">
        <span className="im-blue mb-3 flex items-center justify-self-start text-[15px]">
          <ChevronLeftIcon width={28} height={28} strokeWidth={2.2} className="-ml-1" />
          Messages
        </span>
        <span className="flex flex-col items-center gap-1">
          <AgentAvatar size={44} />
          <span className="flex items-center text-[11px] leading-none">
            {AGENT_NAME}
            <ChevronRightIcon width={10} height={10} strokeWidth={3} className="im-gray ml-px" />
          </span>
        </span>
        <VideoIcon
          width={24}
          height={24}
          strokeWidth={1.8}
          className="im-blue mb-3 justify-self-end"
        />
      </div>

      <Thread
        bubbles={bubbles}
        working={working}
        dateLine={(opened) => (
          <p className="im-gray mb-3 text-center text-[11px]">
            <span className="font-semibold">Today</span> {opened}
          </p>
        )}
        statusClassName="im-gray my-1 text-center text-[11px] font-medium"
        renderBubble={(p) => <IMessageBubble {...p} />}
      />

      <IMessageComposer {...composer} />
    </>
  );
}

function IMessageBubble({ bubble, last }: Placed) {
  const sent = bubble.side === "sent";
  const skin = cn(
    "im-bubble rounded-[18px]",
    sent ? "im-sent-bubble ml-auto" : "im-recv-bubble mr-auto",
    last && (sent ? "im-tail-sent" : "im-tail-recv"),
  );

  if (bubble.kind === "link") {
    return (
      <LinkShell onOpen={bubble.onOpen} className={cn(skin, "w-[78%] overflow-hidden text-left")}>
        <div className="flex flex-col">
          <div className="im-preview-art flex h-[72px] items-center justify-center">
            <AgentMark size={40} />
          </div>
          <div className="flex flex-col gap-px px-3 py-2">
            <span className="truncate text-[13px] leading-tight font-semibold">
              {bubble.done ?? bubble.title}
            </span>
            <span className="im-gray truncate text-[11px]">
              {bubble.done ? bubble.title : linkHost(bubble)}
            </span>
          </div>
        </div>
      </LinkShell>
    );
  }

  return (
    <div className={cn(skin, "max-w-[78%] px-3 py-1.5 break-words whitespace-pre-wrap")}>
      {/* A span, so the text paints above the tail's blobs. */}
      <span>{bubble.text}</span>
    </div>
  );
}

function IMessageComposer(props: ComposerProps) {
  const { canSend, onSubmit, inputProps } = useComposer(props);
  return (
    <form className="flex shrink-0 items-center gap-2 px-3 pt-1.5 pb-7" onSubmit={onSubmit}>
      <span className="im-gray im-plus inline-flex size-8 shrink-0 items-center justify-center rounded-full">
        <PlusIcon width={18} height={18} strokeWidth={2.2} />
      </span>
      <div className="im-field flex h-9 min-w-0 flex-1 items-center rounded-full border pr-[3px] pl-3">
        <input
          {...inputProps}
          placeholder="iMessage"
          aria-label="iMessage"
          className="msg-input min-w-0 flex-1 bg-transparent text-[15px] outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className={cn(
            "inline-flex size-7 shrink-0 items-center justify-center rounded-full transition-colors",
            canSend ? "im-send" : "im-gray im-plus",
          )}
        >
          <ArrowUpIcon width={16} height={16} strokeWidth={3} />
        </button>
      </div>
    </form>
  );
}

// WhatsApp -----------------------------------------------------------------

function WhatsAppChrome({ bubbles, working, composer }: ChromeProps) {
  return (
    <>
      <div className="wa-bar flex items-center gap-2 border-b px-2 pt-1 pb-2">
        <ChevronLeftIcon width={28} height={28} strokeWidth={2.2} className="wa-blue shrink-0" />
        <AgentAvatar size={36} />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[16px] font-semibold">{AGENT_NAME}</p>
          <p className="wa-gray text-[12px]">online</p>
        </div>
        <VideoIcon width={26} height={26} strokeWidth={1.8} className="wa-blue shrink-0" />
        <PhoneIcon width={22} height={22} strokeWidth={1.8} className="wa-blue mx-1.5 shrink-0" />
      </div>

      <Thread
        bubbles={bubbles}
        working={working}
        className="wa-canvas"
        dateLine={() => (
          <div className="mb-3 flex justify-center">
            <span className="wa-date rounded-[8px] px-2.5 py-1 text-[12px] font-medium shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]">
              Today
            </span>
          </div>
        )}
        statusClassName="wa-date wa-status mx-auto my-1 rounded-[8px] px-2.5 py-1 text-center text-[12px] font-medium shadow-[0_1px_0.5px_rgba(0,0,0,0.13)]"
        renderBubble={(p) => <WhatsAppBubble {...p} />}
      />

      <WhatsAppComposer {...composer} />
    </>
  );
}

function WhatsAppBubble({ bubble, first, time }: Placed) {
  const sent = bubble.side === "sent";
  const skin = cn(
    "wa-bubble rounded-[8px]",
    sent ? "wa-sent ml-auto" : "wa-recv mr-auto",
    first && (sent ? "wa-tail-sent rounded-tr-none" : "wa-tail-recv rounded-tl-none"),
  );
  // Floats to the right of the last line when it fits, else onto a line of its own, as in WhatsApp.
  const meta = (
    <span className="wa-time float-right mt-[7px] ml-2 flex items-center gap-1 text-[11px] leading-none">
      {time}
      {sent ? <DoubleCheckIcon width={16} height={16} className="wa-ticks" /> : null}
    </span>
  );

  if (bubble.kind === "link") {
    return (
      <LinkShell onOpen={bubble.onOpen} className={cn(skin, "w-[80%] p-[3px] text-left")}>
        <div className="wa-preview flex flex-col gap-0.5 rounded-[6px] px-3 py-2.5">
          <span className="text-[14px] leading-tight font-semibold">
            {bubble.done ?? bubble.title}
          </span>
          <span className="wa-time text-[12px] leading-tight">
            {bubble.done ? bubble.title : `${AGENT_NAME} is waiting for your answer.`}
          </span>
          <span className="wa-time text-[12px]">{linkHost(bubble)}</span>
        </div>
        <div className="flow-root px-2 pt-1.5 pb-1">
          <span className="wa-link text-[15px] break-all underline">{linkUrl(bubble)}</span>
          {meta}
        </div>
      </LinkShell>
    );
  }

  return (
    <div className={cn(skin, "max-w-[80%] flow-root px-2 py-1.5")}>
      <span className="break-words whitespace-pre-wrap">{bubble.text}</span>
      {meta}
    </div>
  );
}

function WhatsAppComposer(props: ComposerProps) {
  const { typing, canSend, onSubmit, inputProps } = useComposer(props);
  return (
    <form
      className="wa-bar flex shrink-0 items-center gap-2 border-t px-2 pt-1.5 pb-7"
      onSubmit={onSubmit}
    >
      <PlusIcon width={26} height={26} strokeWidth={2} className="wa-blue shrink-0" />
      <div className="wa-field flex h-9 min-w-0 flex-1 items-center rounded-full border pr-2 pl-3">
        <input
          {...inputProps}
          placeholder="Message"
          aria-label="Message"
          className="msg-input min-w-0 flex-1 bg-transparent text-[16px] outline-none disabled:opacity-60"
        />
        <StickerIcon width={22} height={22} strokeWidth={1.8} className="wa-gray shrink-0" />
      </div>
      {typing ? (
        <button
          type="submit"
          aria-label="Send"
          disabled={!canSend}
          className="wa-send inline-flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-60"
        >
          <ArrowUpIcon width={18} height={18} strokeWidth={2.5} />
        </button>
      ) : (
        <>
          <CameraIcon width={24} height={24} strokeWidth={1.8} className="wa-blue shrink-0" />
          <MicIcon width={24} height={24} strokeWidth={1.8} className="wa-blue mr-0.5 shrink-0" />
        </>
      )}
    </form>
  );
}

// Instagram Direct ---------------------------------------------------------

function InstagramChrome({ bubbles, working, composer }: ChromeProps) {
  return (
    <>
      <div className="ig-hairline flex items-center gap-2 border-b px-2 pt-1 pb-2.5">
        <ChevronLeftIcon width={26} height={26} strokeWidth={2} className="shrink-0" />
        <AgentAvatar size={34} className="rounded-full ring-1 ring-black/10" />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[15px] font-semibold">{AGENT_NAME}</p>
          <p className="ig-gray text-[12px]">Active now</p>
        </div>
        <PhoneIcon width={24} height={24} strokeWidth={1.8} className="shrink-0" />
        <VideoIcon width={26} height={26} strokeWidth={1.8} className="mx-1.5 shrink-0" />
      </div>

      <Thread
        bubbles={bubbles}
        working={working}
        dateLine={(opened) => (
          <p className="ig-gray mb-3 text-center text-[11px] font-medium">Today {opened}</p>
        )}
        statusClassName="ig-gray my-1 text-center text-[11px] font-medium"
        renderBubble={(p) => <InstagramBubble {...p} />}
      />

      <InstagramComposer {...composer} />
    </>
  );
}

function InstagramBubble({ bubble, first, last, seen }: Placed) {
  const sent = bubble.side === "sent";
  // Bubbles in a run flatten the corners that face each other.
  const radius = sent
    ? cn("rounded-[18px]", !first && "rounded-tr-[5px]", !last && "rounded-br-[5px]")
    : cn("rounded-[18px]", !first && "rounded-tl-[5px]", !last && "rounded-bl-[5px]");
  const skin = sent ? "ig-sent" : "ig-recv";

  const body =
    bubble.kind === "link" ? (
      <LinkShell onOpen={bubble.onOpen} className={cn("w-[80%] p-1.5 text-left", radius, skin)}>
        <div className="ig-preview flex flex-col overflow-hidden rounded-[14px]">
          <div className="ig-preview-art flex h-[70px] items-center justify-center">
            <AgentMark size={40} />
          </div>
          <div className="flex flex-col gap-px px-3 py-2">
            <span className="truncate text-[13px] leading-tight font-semibold">
              {bubble.done ?? bubble.title}
            </span>
            <span className="ig-gray truncate text-[11px]">
              {bubble.done ? bubble.title : linkHost(bubble)}
            </span>
          </div>
        </div>
      </LinkShell>
    ) : (
      <div
        className={cn("max-w-[78%] px-3 py-[7px] break-words whitespace-pre-wrap", radius, skin)}
      >
        {bubble.text}
      </div>
    );

  if (sent) {
    return (
      <>
        <div className="flex justify-end">{body}</div>
        {seen ? <span className="ig-gray mt-[3px] pr-1 text-right text-[11px]">Seen</span> : null}
      </>
    );
  }
  return (
    <div className="flex items-end gap-1.5">
      {/* The avatar sits by the last bubble of a run; a spacer keeps the others aligned. */}
      {last ? (
        <AgentAvatar size={24} className="rounded-full ring-1 ring-black/10" />
      ) : (
        <span className="w-6 shrink-0" />
      )}
      {body}
    </div>
  );
}

function InstagramComposer(props: ComposerProps) {
  const { typing, canSend, onSubmit, inputProps } = useComposer(props);
  return (
    <form className="shrink-0 px-2.5 pt-1.5 pb-7" onSubmit={onSubmit}>
      <div className="ig-field flex h-11 items-center gap-2 rounded-full pr-3 pl-1">
        <span className="ig-sent inline-flex size-9 shrink-0 items-center justify-center rounded-full">
          <CameraIcon width={19} height={19} strokeWidth={2} />
        </span>
        <input
          {...inputProps}
          placeholder="Message..."
          aria-label="Message"
          className="msg-input min-w-0 flex-1 bg-transparent text-[15px] outline-none disabled:opacity-60"
        />
        {typing ? (
          <button
            type="submit"
            disabled={!canSend}
            className="ig-send shrink-0 text-[15px] font-semibold disabled:opacity-60"
          >
            Send
          </button>
        ) : (
          <>
            <MicIcon width={22} height={22} strokeWidth={1.8} className="shrink-0" />
            <ImageIcon width={22} height={22} strokeWidth={1.8} className="shrink-0" />
            <StickerIcon width={22} height={22} strokeWidth={1.8} className="shrink-0" />
          </>
        )}
      </div>
    </form>
  );
}

const CHROMES: Record<MessagingAppId, Chrome> = {
  imessage: IMessageChrome,
  whatsapp: WhatsAppChrome,
  instagram: InstagramChrome,
};

// ---------------------------------------------------------------------------
// Signed in
// ---------------------------------------------------------------------------

function SignedIn({
  chat,
  thread,
  chatEnabled,
  brand,
  Chrome,
}: ExperienceProps & { Chrome: Chrome }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [topUp, setTopUp] = useState<TopUpAsk | null>(null);
  const [topUpOpen, setTopUpOpen] = useState(false);
  // The top-up's keypad and sheets portal into the page over the thread.
  const [topUpPage, setTopUpPage] = useState<HTMLDivElement | null>(null);

  const onReview = useCallback((a: Approval) => {
    setApproval(a);
    setApprovalOpen(true);
  }, []);
  const closeApproval = useCallback(() => {
    setApprovalOpen(false);
    setTimeout(() => setApproval(null), PAGE_SHEET_TRANSITION_MS);
  }, []);
  const onApprovalDone = useCallback(
    (o: AccessOutcome) => {
      if (approval) chat.onAccessOutcome(approval.toolCallId, toAccessOutcome(o));
      setTimeout(closeApproval, DONE_LINGER_MS);
    },
    [approval, chat, closeApproval],
  );

  const onReviewTopUp = useCallback((a: TopUpAsk) => {
    setTopUp(a);
    setTopUpOpen(true);
  }, []);
  const closeTopUp = useCallback(() => {
    setTopUpOpen(false);
    setTimeout(() => setTopUp(null), PAGE_SHEET_TRANSITION_MS);
  }, []);
  const onTopUpDone = useCallback(
    (o: TopUpOutcome) => {
      if (topUp) chat.onTopUpOutcome(topUp.toolCallId, toTopUpOutcome(o));
      setTimeout(closeTopUp, DONE_LINGER_MS);
    },
    [topUp, chat, closeTopUp],
  );

  const bubbles: Bubble[] = [
    chatEnabled
      ? { key: "hello", kind: "text", side: "recv", text: WELCOME }
      : {
          key: "off",
          kind: "text",
          side: "recv",
          text: "Chat is off. Set ANTHROPIC_API_KEY or OPENAI_API_KEY to turn it on.",
        },
    ...toBubbles(chat.messages, onReview, onReviewTopUp),
  ];
  if (thread.loading) bubbles.push({ key: "loading", kind: "status", text: "Loading…" });
  if (chat.error) bubbles.push({ key: "error", kind: "status", text: chat.error });

  return (
    <>
      <Chrome
        bubbles={bubbles}
        working={chat.busy}
        composer={{ disabled: !chatEnabled, busy: chat.busy, onSend: chat.send }}
      />

      <BrowserSheet
        open={approvalOpen}
        path={`/approve/${approval?.requestId ?? ""}`}
        brand={brand}
        onDone={closeApproval}
        ariaLabel="Approve"
      >
        {approval ? (
          <ApproveAgentAccess
            key={approval.requestId}
            requestId={approval.requestId}
            variant="plain"
            agentName={AGENT_NAME}
            onDone={onApprovalDone}
          />
        ) : null}
      </BrowserSheet>

      <BrowserSheet
        open={topUpOpen}
        path={`/top-up/${topUp?.requestId ?? ""}`}
        brand={brand}
        onDone={closeTopUp}
        ariaLabel="Add credits"
        pageRef={setTopUpPage}
      >
        {topUp ? (
          <TopUp
            key={topUp.requestId}
            requestId={topUp.requestId}
            variant="plain"
            container={topUpPage}
            onDone={onTopUpDone}
            onClose={closeTopUp}
          />
        ) : null}
      </BrowserSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// Signed out
// ---------------------------------------------------------------------------

function SignedOut(props: ExperienceProps & { Chrome: Chrome }) {
  const { onSignedIn, brand, Chrome } = props;
  const [open, setOpen] = useState(false);
  const bubbles: Bubble[] = [
    {
      key: "hello",
      kind: "text",
      side: "recv",
      text: `Hi, I am ${AGENT_NAME}. Log in and ask me for a brief. I pay the research API from your wallet.`,
    },
    {
      key: "login",
      kind: "link",
      side: "recv",
      title: "Log in",
      path: "/login",
      onOpen: () => setOpen(true),
    },
  ];
  return (
    <>
      <Chrome
        bubbles={bubbles}
        working={false}
        composer={{ disabled: true, busy: false, onSend: () => undefined }}
      />
      <BrowserSheet
        open={open}
        path="/login"
        brand={brand}
        onDone={() => setOpen(false)}
        ariaLabel="Log in"
      >
        <LoginForm
          next={loginNext(props)}
          onSignedIn={() => {
            setOpen(false);
            onSignedIn();
          }}
        />
      </BrowserSheet>
    </>
  );
}

// ---------------------------------------------------------------------------
// A page over the thread, drawn like the phone's in-app browser: Done to
// leave, the address in the middle. The page under it is ours and wears the
// brand; the bar does not.
// ---------------------------------------------------------------------------

function BrowserSheet({
  open,
  path,
  brand,
  onDone,
  ariaLabel,
  pageRef,
  children,
}: {
  open: boolean;
  path: string;
  brand: ExperienceProps["brand"];
  onDone: () => void;
  ariaLabel: string;
  /** The page element, for content that portals its own sheets into it. */
  pageRef?: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  return (
    <PhonePageSheet open={open} ariaLabel={ariaLabel}>
      <div className="msg-browser-bar flex items-center gap-3 border-b px-3 pt-4 pb-2 md:pt-14">
        <button
          type="button"
          onClick={onDone}
          className="msg-browser-action w-11 shrink-0 text-left text-[15px] font-semibold"
        >
          Done
        </button>
        <span className="msg-browser-url flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px]">
          <LockIcon width={12} height={12} strokeWidth={2.4} className="shrink-0" />
          <span className="truncate">
            {AGENT_DOMAIN}
            {path}
          </span>
        </span>
        <span aria-hidden className="w-11 shrink-0" />
      </div>
      <div
        ref={pageRef}
        data-brand={brandAttr(brand)}
        className="relative flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground scrollbar-none"
      >
        <div className="px-6 py-6">{children}</div>
      </div>
    </PhonePageSheet>
  );
}
