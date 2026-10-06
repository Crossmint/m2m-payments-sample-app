import * as React from "react";
import { Lock } from "lucide-react";
import { shortAddress } from "../lib/format.js";
import { cn } from "../lib/utils.js";
import { ACCESS_ASK, ACCESS_CAN_DO } from "./approve-agent-access.js";
import { Button } from "./primitives/button.js";

export interface ApproveAgentAccessPreviewProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  /** Name of the agent in the headline. Default "Acme Agent". */
  agentName?: string;
  /** Reason line. Hidden when empty. Default "Pay research APIs for your market brief". */
  reason?: string;
  /** The wallet address in the From row. Default a sample address. */
  address?: string;
  allowLabel?: string;
  denyLabel?: string;
  /** Heading font. Default: inherit. Use it for brand demos. */
  headingFontFamily?: string;
}

/**
 * A static replica of the approval screen for the landing page and brand
 * demos. Same structure as `ApproveAgentAccess`, no data and no API calls.
 *
 * It reads the shadcn theme tokens (`--background`, `--card`, `--primary`,
 * `--radius`, ...) so a wrapper that sets those variables restyles it.
 */
export function ApproveAgentAccessPreview({
  agentName = "Acme Agent",
  reason = "Pay research APIs for your market brief",
  address = "0x8f3C1a4b2D9e7F60c5B1a2E3d4F5061728394a5B",
  allowLabel = "Allow",
  denyLabel = "Deny",
  headingFontFamily,
  className,
  ...props
}: ApproveAgentAccessPreviewProps) {
  return (
    <div
      data-slot="approve-preview"
      aria-label={`Preview: ${agentName} ${ACCESS_ASK.title}`}
      className={cn(
        "mx-auto flex w-full max-w-md flex-col gap-6 rounded-2xl bg-card p-6 text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
      {...props}
    >
      <div className="flex flex-col gap-2">
        <p
          className="text-xl font-medium text-balance"
          style={headingFontFamily ? { fontFamily: headingFontFamily } : undefined}
        >
          {agentName} {ACCESS_ASK.title}
        </p>
        <p className="text-sm text-muted-foreground">{ACCESS_ASK.sub}</p>
      </div>

      <dl className="flex flex-col rounded-2xl border border-border px-5">
        <Row label="Agent" strong>
          {agentName}
        </Row>
        {reason ? <Row label="Reason">{reason}</Row> : null}
        <Row label="Can do">{ACCESS_CAN_DO}</Row>
        <Row label="From">
          <span className="font-mono tabular-nums">{shortAddress(address)}</span>
        </Row>
      </dl>

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Lock className="mt-0.5 size-4 shrink-0" />
        You confirm with a code sent to your email. You can revoke access any time from the app.
      </p>

      <div className="flex flex-col gap-2">
        <Button type="button" size="xl" tabIndex={-1} aria-hidden className="w-full cursor-default">
          {allowLabel}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xl"
          tabIndex={-1}
          aria-hidden
          className="w-full cursor-default"
        >
          {denyLabel}
        </Button>
      </div>
    </div>
  );
}

/** One line of the request, as on the live screen. */
function Row({
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
