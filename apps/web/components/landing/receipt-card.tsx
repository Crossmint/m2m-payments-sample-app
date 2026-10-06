import { FileText, Link2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { STORY } from "./story";

/*
 * The receipt the agent sends with the brief: what it made, the payments it
 * took, the total in credits, and the settlement on chain. Sized for the
 * phone: 11-12px text. A card in the theme's own terms: white, 16px corners,
 * a hairline ring.
 */

export function ReceiptCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-2xl bg-card px-3 py-2.5 text-left text-[11.5px] leading-tight text-card-foreground ring-1 ring-foreground/10",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="inline-flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <FileText className="size-[14px]" strokeWidth={2.2} />
        </span>
        <div className="flex min-w-0 flex-col gap-px">
          <span className="truncate text-[12px] font-semibold">{STORY.purpose}</span>
          <span className="truncate text-[10.5px] text-muted-foreground">
            EV charging in Europe · {STORY.sources} sources
          </span>
        </div>
      </div>
      <hr className="border-t border-border" />
      <div className="flex flex-col gap-1">
        {STORY.receipt.lines.map((l) => (
          <div key={l.label} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate">{l.label}</span>
            <span className="shrink-0 tabular-nums">{l.amount}</span>
          </div>
        ))}
      </div>
      <hr className="border-t border-border" />
      <div className="flex items-baseline justify-between gap-3 text-[12px] font-semibold">
        <span>Paid</span>
        <span className="font-display tabular-nums">{STORY.receipt.total}</span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Link2 className="size-[13px] shrink-0 text-muted-foreground" strokeWidth={2} />
          <span className="truncate font-mono text-[10.5px]">{STORY.txHash}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">Settled on {STORY.network}</span>
      </div>
    </div>
  );
}
