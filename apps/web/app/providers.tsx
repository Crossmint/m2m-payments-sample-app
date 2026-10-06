"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { StytchProvider, useStytchUser } from "@stytch/nextjs";
import { M2mPaymentsProvider, TooltipProvider } from "@m2m-payments/ui";
import { stytch } from "@/lib/stytch-client";
import { useSessionJwt } from "@/lib/use-session-jwt";

export interface ProvidersProps {
  crossmintClientApiKey: string | undefined;
  crossmintEnvironment: "staging" | "production";
  children: ReactNode;
}

/**
 * Stytch owns the session. The API client reads the session JWT from Stytch
 * and hands it to the M2M Payments API and to Crossmint's wallet SDK. One
 * login, one identity, one wallet.
 */
export function Providers({
  crossmintClientApiKey,
  crossmintEnvironment,
  children,
}: ProvidersProps) {
  const pathname = usePathname();
  if (!stytch) {
    // The landing page needs no auth. Everything else does.
    if (pathname === "/") return <TooltipProvider>{children}</TooltipProvider>;
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center">
        <div className="max-w-md space-y-2">
          <p className="text-xl font-semibold">Auth is not set up</p>
          <p className="text-sm text-muted-foreground">
            Set <code className="font-mono">NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN</code> in your env. See
            .env.example.
          </p>
        </div>
      </div>
    );
  }
  return (
    <StytchProvider stytch={stytch}>
      <ApiBridge
        crossmintClientApiKey={crossmintClientApiKey}
        crossmintEnvironment={crossmintEnvironment}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </ApiBridge>
    </StytchProvider>
  );
}

/**
 * The email goes to the SDK so the wallet is created with email recovery on
 * the first sign-in. It comes from the Stytch user on the client, so a login
 * inside a frame reaches the wallet provider without a reload.
 */
function ApiBridge({ crossmintClientApiKey, crossmintEnvironment, children }: ProvidersProps) {
  const { getJwt } = useSessionJwt();
  const { user } = useStytchUser();
  const userEmail = user?.emails?.[0]?.email;
  return (
    <M2mPaymentsProvider
      apiBaseUrl="/api/m2m-payments"
      getJwt={getJwt}
      crossmintClientApiKey={crossmintClientApiKey}
      crossmintEnvironment={crossmintEnvironment}
      userEmail={userEmail}
      mascotSrc="/crossmint-mark.svg"
    >
      {children}
    </M2mPaymentsProvider>
  );
}
