"use client";

import { useState } from "react";
import { TopUp } from "@m2m-payments/ui";

/**
 * The top-up screen inside the phone, for the link an agent sends when the
 * wallet runs short. The page draws the frame, so the component runs
 * "plain". The keypad and the card sheets portal into the screen element,
 * so they stay inside the phone.
 */
export function TopUpScreen({ requestId }: { requestId: string }) {
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  return (
    <div ref={setScreen} className="relative flex flex-1 flex-col">
      <TopUp requestId={requestId} variant="plain" container={screen} />
    </div>
  );
}
