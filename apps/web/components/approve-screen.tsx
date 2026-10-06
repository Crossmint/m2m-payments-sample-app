"use client";

import { ApproveAgentAccess } from "@m2m-payments/ui";

/**
 * The approval screen inside the phone: the page draws the dot grid and the
 * device frame, so the component itself runs "plain". A panel inside the
 * screen would be a second frame around the same content. Every ending says
 * what happened and leaves the tab to be closed, so there is no button back
 * into the app.
 *
 * The requester's name comes from the request itself: this is the link any
 * agent sends, from Claude Code to an MCP host, so the screen names whoever
 * asked rather than this app's own agent.
 */
export function ApproveScreen({ requestId }: { requestId: string }) {
  return <ApproveAgentAccess requestId={requestId} variant="plain" />;
}
