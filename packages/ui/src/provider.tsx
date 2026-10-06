"use client";

import * as React from "react";
import {
  CrossmintProvider,
  CrossmintWalletProvider,
  useCrossmint,
  useWallet as useCrossmintWallet,
} from "@crossmint/client-sdk-react-ui";
import type { Chain, Wallet } from "@crossmint/client-sdk-react-ui";
import { chainFor, type CrossmintEnvironment } from "@m2m-payments/core";
import { createM2mPaymentsApi, type GetJwt, type M2mPaymentsApi } from "./api/client.js";

export interface M2mPaymentsContextValue {
  api: M2mPaymentsApi;
  apiBaseUrl: string;
  /** The latest JWT we resolved from `getJwt`. Null until it resolves or while signed out. */
  jwt: string | null;
  /** Ask `getJwt` again now. */
  refreshJwt: () => Promise<string | null>;
  crossmint: {
    clientApiKey: string | undefined;
    environment: CrossmintEnvironment;
    /** The chain the wallet lives on: `chainFor(environment)`. */
    chain: "base-sepolia" | "base";
  };
  /** The signed-in user's email. The email signer and wallet recovery need it. */
  userEmail: string | undefined;
  /** Where the mascot image lives. Components use it in empty and success states. */
  mascotSrc: string;
}

const M2mPaymentsContext = React.createContext<M2mPaymentsContextValue | null>(null);

// ---------------------------------------------------------------------------
// The Crossmint SDK wallet, read through our own context
// ---------------------------------------------------------------------------

export type SdkWalletStatus = "not-loaded" | "in-progress" | "loaded" | "error";

export interface SdkWalletError {
  code: string;
  message: string;
  status?: number;
}

export interface SdkWalletState {
  /** Crossmint's wallet object for the browser-only steps: `useSigner` and `approve`. */
  wallet: Wallet<Chain> | undefined;
  status: SdkWalletStatus;
  error: SdkWalletError | null;
}

const NOT_MOUNTED: SdkWalletState = { wallet: undefined, status: "not-loaded", error: null };

const SdkWalletContext = React.createContext<SdkWalletState>(NOT_MOUNTED);

/**
 * Crossmint's `useWallet()`, null-safe. Outside the provider, on the server,
 * before hydration, or with no client key, it reads
 * `{ wallet: undefined, status: "not-loaded", error: null }`.
 */
export function useSdkWallet(): SdkWalletState {
  return React.useContext(SdkWalletContext);
}

export interface M2mPaymentsProviderProps {
  /** Where the M2M Payments server is mounted. Default "/api/m2m-payments". */
  apiBaseUrl?: string;
  /** Returns the user's session JWT. Called on every API request, and polled for the Crossmint SDK. */
  getJwt: GetJwt;
  /** Crossmint client API key (`ck_...`). Needed for the wallet SDK and saving cards. */
  crossmintClientApiKey?: string;
  crossmintEnvironment?: CrossmintEnvironment;
  /**
   * The signed-in user's email. The wallet is created on login with email
   * recovery, and the approval screens sign with the email signer. Without it
   * the SDK only loads a wallet that already exists.
   */
  userEmail?: string;
  /** How often to re-read the JWT for the Crossmint SDK. Default 30s. */
  jwtRefreshMs?: number;
  /** Default "/crossmint-mark.svg". */
  mascotSrc?: string;
  children: React.ReactNode;
}

/**
 * Wires the M2M Payments API client to the user's session and mounts
 * Crossmint's wallet SDK with the same JWT, so there is one identity
 * everywhere.
 *
 * The SDK is browser-only. It mounts after hydration as a sibling of
 * `children`, not around them, and publishes its wallet through
 * `useSdkWallet()`. That way the app tree keeps its shape: when the SDK
 * wrapped the children instead, React recreated every node on the client
 * and entrance animations ran twice.
 */
export function M2mPaymentsProvider({
  apiBaseUrl = "/api/m2m-payments",
  getJwt,
  crossmintClientApiKey,
  crossmintEnvironment = "staging",
  userEmail,
  jwtRefreshMs = 30_000,
  mascotSrc = "/crossmint-mark.svg",
  children,
}: M2mPaymentsProviderProps) {
  const getJwtRef = React.useRef(getJwt);
  getJwtRef.current = getJwt;

  const [jwt, setJwt] = React.useState<string | null>(null);
  const [sdk, setSdk] = React.useState<SdkWalletState>(NOT_MOUNTED);

  const refreshJwt = React.useCallback(async () => {
    try {
      const next = (await getJwtRef.current()) ?? null;
      setJwt((prev) => (prev === next ? prev : next));
      return next;
    } catch {
      setJwt(null);
      return null;
    }
  }, []);

  React.useEffect(() => {
    void refreshJwt();
    const t = setInterval(() => void refreshJwt(), jwtRefreshMs);
    return () => clearInterval(t);
  }, [refreshJwt, jwtRefreshMs]);

  const api = React.useMemo(
    () => createM2mPaymentsApi({ baseUrl: apiBaseUrl, getJwt: () => getJwtRef.current() }),
    [apiBaseUrl],
  );

  const chain = chainFor(crossmintEnvironment);

  const value = React.useMemo<M2mPaymentsContextValue>(
    () => ({
      api,
      apiBaseUrl,
      jwt,
      refreshJwt,
      crossmint: { clientApiKey: crossmintClientApiKey, environment: crossmintEnvironment, chain },
      userEmail,
      mascotSrc,
    }),
    [
      api,
      apiBaseUrl,
      jwt,
      refreshJwt,
      crossmintClientApiKey,
      crossmintEnvironment,
      chain,
      userEmail,
      mascotSrc,
    ],
  );

  return (
    <M2mPaymentsContext.Provider value={value}>
      <SdkWalletContext.Provider value={sdk}>
        {children}
        {crossmintClientApiKey ? (
          <CrossmintMount
            apiKey={crossmintClientApiKey}
            jwt={jwt}
            chain={chain}
            email={userEmail}
            onState={setSdk}
          />
        ) : null}
      </SdkWalletContext.Provider>
    </M2mPaymentsContext.Provider>
  );
}

export function useM2mPayments(): M2mPaymentsContextValue {
  const ctx = React.useContext(M2mPaymentsContext);
  if (!ctx) throw new Error("useM2mPayments must be used inside <M2mPaymentsProvider>.");
  return ctx;
}

/** Same as useM2mPayments, but returns null outside a provider. */
export function useM2mPaymentsOptional(): M2mPaymentsContextValue | null {
  return React.useContext(M2mPaymentsContext);
}

// ---------------------------------------------------------------------------
// The SDK mount
// ---------------------------------------------------------------------------

/**
 * `CrossmintProvider` + `CrossmintWalletProvider`, client side only, inside an
 * error boundary. With the email known, `createOnLogin` makes the wallet on
 * the first sign-in with a device signer and email recovery. Without it the
 * SDK only loads a wallet that exists. The wallet provider also renders the
 * email code prompt the approval steps rely on.
 */
function CrossmintMount({
  apiKey,
  jwt,
  chain,
  email,
  onState,
}: {
  apiKey: string;
  jwt: string | null;
  chain: "base-sepolia" | "base";
  email: string | undefined;
  onState: (state: SdkWalletState) => void;
}) {
  const isClient = useIsClient();
  if (!isClient) return null;
  return (
    <CrossmintBoundary
      onFail={() => onState({ wallet: undefined, status: "error", error: MOUNT_FAILED })}
    >
      <CrossmintProvider apiKey={apiKey} jwt={jwt ?? undefined} consoleLogLevel="warn">
        <CrossmintWalletProvider
          showPasskeyHelpers={false}
          {...(email
            ? { createOnLogin: { chain, recovery: { type: "email" as const, email } } }
            : {})}
        >
          <SdkBridge jwt={jwt} onState={onState} />
        </CrossmintWalletProvider>
      </CrossmintProvider>
    </CrossmintBoundary>
  );
}

const MOUNT_FAILED: SdkWalletError = {
  code: "unknown",
  message: "The Crossmint wallet SDK did not start in this browser.",
};

/** Reads the SDK's wallet and hands it up; keeps the SDK's JWT in step with ours. */
function SdkBridge({
  jwt,
  onState,
}: {
  jwt: string | null;
  onState: (state: SdkWalletState) => void;
}) {
  const { wallet, status, error } = useCrossmintWallet();
  const { crossmint, setJwt } = useCrossmint();

  React.useEffect(() => {
    const next = jwt ?? undefined;
    if (crossmint.jwt !== next) setJwt(next);
    // `crossmint` is a new object after every setJwt; only our jwt should drive this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jwt, setJwt]);

  React.useEffect(() => {
    onState({
      wallet,
      status,
      error: error ? { code: error.code, message: error.message, status: error.status } : null,
    });
  }, [wallet, status, error, onState]);

  return null;
}

class CrossmintBoundary extends React.Component<
  { onFail: () => void; children: React.ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown) {
    console.warn(
      "[m2m-payments] Crossmint wallet SDK failed to mount. Approving agent access and revoking it need it.",
      error,
    );
    this.props.onFail();
  }
  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const subscribeNoop = () => () => {};
/** True after hydration. False on the server and on the first client render. */
export function useIsClient(): boolean {
  return React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
