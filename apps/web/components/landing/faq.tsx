"use client";

import { type ReactNode, useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { Section, SectionHeading } from "./section";

/*
 * Section `#faq`. Not `<details>`: a closed disclosure sets its panel to
 * `display: none`, and nothing animates from that. These are controlled, so
 * the panel opens and closes on the `.landing-fold` row transition, the same
 * one `how-it-works` uses, and the mark turns as it goes. Each question
 * toggles on its own: a reader comparing two answers should not lose one to
 * open the other.
 */

interface Question {
  q: string;
  /** The lead paragraph. */
  a: ReactNode;
  /** Reasons under the lead, when one paragraph would not carry them. */
  points?: string[];
}

const QUESTIONS: Question[] = [
  {
    q: "How can there be no KYC?",
    a: "Credits are a closed-loop token. They buy machine services from your agent, and nothing else.",
    points: [
      "Machine services only: inference, search, data. Credits do not cash out.",
      "Buying closed-loop value for digital services falls under the same merchant category as buying OpenAI or Anthropic credits, and Visa and Mastercard treat it that way.",
      "Crossmint runs the card checkout under that category, so the user is never asked for an identity document.",
    ],
  },
  {
    q: "Is the wallet custodial?",
    a: "No. The wallet is the user's, with a device signer made in the browser and an email signer as recovery.",
    points: [
      "The device signer's key never leaves the browser.",
      "The agent gets a server signer the user approves once, with an email code, and can revoke from the app at any time.",
      "The agent never holds a key, a card or a Crossmint credential.",
    ],
  },
  {
    q: "Which protocols does the agent pay with?",
    a: "x402 and the Machine Payments Protocol (MPP), both over HTTP. It can also send plain transfers and raw transactions on Base.",
  },
  {
    q: "Is it production ready?",
    a: "It is a sample app. It shows the flows end to end, and staging uses test credits on Base Sepolia. Review it before shipping it to your users.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<Record<number, boolean>>({});
  return (
    <Section id="faq">
      <SectionHeading title="Questions" />
      <div className="flex max-w-3xl flex-col gap-3">
        {QUESTIONS.map(({ q, a, points }, i) => {
          const isOpen = Boolean(open[i]);
          return (
            <div key={q} className="rounded-2xl bg-card ring-1 ring-foreground/10">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${i}`}
                onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}
                className="flex w-full cursor-pointer items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left text-[16px] leading-snug font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-6 sm:text-[17px]"
              >
                {q}
                <Plus
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0 text-muted-foreground transition-transform duration-300",
                    isOpen && "rotate-45",
                  )}
                  strokeWidth={2.2}
                />
              </button>
              <div
                id={`faq-answer-${i}`}
                className="landing-fold"
                data-open={isOpen}
                inert={!isOpen || undefined}
              >
                <div>
                  <div className="flex flex-col gap-3 px-5 pb-5 sm:px-6">
                    <p className="text-[15px] leading-relaxed text-muted-foreground">{a}</p>
                    {points ? (
                      <ul className="flex flex-col gap-2">
                        {points.map((p) => (
                          <li
                            key={p}
                            className="flex items-start gap-2.5 text-[15px] leading-relaxed text-muted-foreground"
                          >
                            <span
                              aria-hidden
                              className="mt-[9px] size-1.5 shrink-0 rounded-full bg-primary"
                            />
                            {p}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
