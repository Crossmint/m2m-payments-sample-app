"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  type ChatStatus,
} from "ai";
import type { AccessOutcomeOutput, TopUpOutcomeOutput } from "@/lib/chat/tools";
import type { Attachment, ChatMessage } from "@/lib/chat/types";

export interface UseAgentChatOptions {
  id: string;
  initialMessages: ChatMessage[];
  /** True when DATABASE_URL is set: the id goes into the URL and the history list refreshes. */
  persist: boolean;
}

export interface AgentChat {
  messages: ChatMessage[];
  status: ChatStatus;
  /** True while a turn is in flight. */
  busy: boolean;
  send: (text: string, attachments?: Attachment[]) => void;
  stop: () => void;
  /** Hand the approval screen's answer back to the `await_wallet_access` tool call. */
  onAccessOutcome: (toolCallId: string, outcome: AccessOutcomeOutput) => void;
  /** Hand the top-up screen's ending back to the `await_top_up` tool call. */
  onTopUpOutcome: (toolCallId: string, outcome: TopUpOutcomeOutput) => void;
  error: string | null;
  dismissError: () => void;
  /** Show an error that came from outside the model turn, such as a failed upload. */
  reportError: (message: string) => void;
}

/**
 * One chat, without a face. `useChat` owns the messages; this hook wires the
 * pieces every frame needs the same way:
 * - the transport posts the whole conversation to /api/chat,
 * - `sendAutomaticallyWhen` resubmits once every tool call in the last
 *   assistant message has an output, which is how the client-side
 *   `await_wallet_access` and `await_top_up` tools hand control back to the model,
 * - `onAccessOutcome` and `onTopUpOutcome` are what a screen calls when the user answers.
 *
 * With persistence on, the first message of a new chat writes `?chat=<id>`
 * into the URL so a reload finds the history, and each finished turn asks the
 * server for a fresh chat list.
 */
export function useAgentChat({ id, initialMessages, persist }: UseAgentChatOptions): AgentChat {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat" }), []);

  const { messages, sendMessage, status, stop, addToolOutput } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError: (e) => setError(e.message || "Something went wrong."),
    onFinish: () => {
      if (persist) router.refresh();
    },
  });

  const urlSet = useRef(initialMessages.length > 0);
  const send = useCallback(
    (text: string, attachments: Attachment[] = []) => {
      setError(null);
      if (persist && !urlSet.current) {
        urlSet.current = true;
        // Keep the frame in the URL; only the chat changes.
        const url = new URL(window.location.href);
        url.searchParams.set("chat", id);
        window.history.replaceState(null, "", url);
      }
      void sendMessage({
        role: "user",
        parts: [
          ...attachments.map((a) => ({
            type: "file" as const,
            url: a.url,
            mediaType: a.contentType,
            filename: a.name,
          })),
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      });
    },
    [id, persist, sendMessage],
  );

  const onAccessOutcome = useCallback(
    (toolCallId: string, output: AccessOutcomeOutput) => {
      void addToolOutput({ tool: "await_wallet_access", toolCallId, output });
    },
    [addToolOutput],
  );

  const onTopUpOutcome = useCallback(
    (toolCallId: string, output: TopUpOutcomeOutput) => {
      void addToolOutput({ tool: "await_top_up", toolCallId, output });
    },
    [addToolOutput],
  );

  return {
    messages,
    status,
    busy: status === "submitted" || status === "streaming",
    send,
    stop: () => void stop(),
    onAccessOutcome,
    onTopUpOutcome,
    error,
    dismissError: () => setError(null),
    reportError: setError,
  };
}

/** The openers a new chat offers. */
export const SUGGESTIONS = [
  "Run a paid inference for me",
  "How many credits do I have?",
  "What have you spent today?",
  "Pay the research API over MPP",
];
