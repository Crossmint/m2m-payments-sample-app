import type { ChatMessage } from "../chat/model";
import { ReceiptCard } from "../receipt-card";
import { STORY } from "../story";

/*
 * The story over a messaging app, shared by the iMessage, WhatsApp and
 * Instagram mocks: the agent has no screen of its own, so it sends the
 * approval link, then the top-up link, and the receipt as messages. Replays
 * on a loop while in view.
 */

export const MESSAGING_T = {
  ask: 300,
  reply: 1300,
  link: 2000,
  approved: 3700,
  topUpAsk: 4500,
  topUpLink: 5200,
  added: 6900,
  done: 7700,
  receipt: 8400,
  loop: 13000,
} as const;

export function messagingThread(): ChatMessage[] {
  return [
    { key: "ask", from: "user", at: MESSAGING_T.ask, node: STORY.ask },
    {
      key: "reply",
      from: "agent",
      at: MESSAGING_T.reply,
      node: <>Sure. I need to pay a research API for the sources. Let me use your wallet:</>,
    },
    {
      key: "link",
      from: "agent",
      at: MESSAGING_T.link,
      link: {
        domain: STORY.agentDomain,
        title: `Let ${STORY.agent} use your wallet`,
        description: `${STORY.reason} · approve with an email code`,
        url: STORY.approveUrl,
      },
    },
    {
      key: "approved",
      from: "status",
      at: MESSAGING_T.approved,
      node: <>Approved · {STORY.agent} can pay from your wallet</>,
    },
    {
      key: "top-up-ask",
      from: "agent",
      at: MESSAGING_T.topUpAsk,
      node: (
        <>
          Your wallet has {STORY.balanceBefore} credits. This needs about {STORY.needs}. Add{" "}
          {STORY.topUpBare} here:
        </>
      ),
    },
    {
      key: "top-up-link",
      from: "agent",
      at: MESSAGING_T.topUpLink,
      link: {
        domain: STORY.agentDomain,
        title: `Add ${STORY.topUpBare} credits`,
        description: `${STORY.topUp} by card · no ID check`,
        url: STORY.topUpUrl,
      },
    },
    {
      key: "added",
      from: "status",
      at: MESSAGING_T.added,
      node: (
        <>
          +{STORY.topUpBare} credits added · {STORY.card}
        </>
      ),
    },
    {
      key: "done",
      from: "agent",
      at: MESSAGING_T.done,
      node: <>Done. Here is the brief.</>,
    },
    { key: "receipt", from: "agent", at: MESSAGING_T.receipt, bare: true, card: <ReceiptCard /> },
  ];
}

/** The phone's accessible description, for one app. */
export const messagingLabel = (app: string) =>
  `A ${app} thread: the user asks ${STORY.agent} to ${STORY.ask.toLowerCase()}, the agent sends a link on ${STORY.agentDomain} to approve wallet access, the user approves, the agent sends a link to add ${STORY.topUpBare} credits by card, the credits land, and the brief arrives with a receipt for ${STORY.receipt.total}`;
