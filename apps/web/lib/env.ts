/**
 * Server-side env access. One place to read, one place to document.
 * See .env.example at the repo root.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. See .env.example.`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v ? v : undefined;
}

export type CrossmintEnv = "staging" | "production";

export function crossmintEnvironment(): CrossmintEnv {
  const raw = (optional("CROSSMINT_ENV") ?? "staging").toLowerCase();
  return raw === "production" ? "production" : "staging";
}

export const serverEnv = {
  required,
  optional,
  crossmintEnvironment,
  /** Public URL of this deployment, for approval and top-up links. */
  webBaseUrl(): string {
    return (
      optional("M2M_PAYMENTS_WEB_BASE_URL") ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
    ).replace(/\/+$/, "");
  },
  /** Where `@m2m-payments/server` is mounted. */
  apiBaseUrl(): string {
    return `${this.webBaseUrl()}/api/m2m-payments`;
  },
  /**
   * The agent's server signer secret. Anyone holding it can sign for every
   * wallet that approved it, so it is required and never sent to the browser.
   */
  signerSecret(): string {
    return required("M2M_PAYMENTS_SIGNER_SECRET");
  },
  /** Most credits one agent call may pay on an x402 or MPP endpoint. Default "1.00". */
  maxPayment(): string {
    return optional("M2M_PAYMENTS_MAX_PAYMENT") ?? "1.00";
  },
  /** Where the demo paid endpoints send their charges. Unset means the demo endpoints answer 503. */
  demoPayTo(): `0x${string}` | undefined {
    const v = optional("M2M_PAYMENTS_DEMO_PAY_TO");
    return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : undefined;
  },
  /** What one demo inference costs, in credits. Default "0.05". */
  demoPrice(): string {
    return optional("M2M_PAYMENTS_DEMO_PRICE") ?? "0.05";
  },
  /** The x402 facilitator the demo endpoint settles through. The default serves Base Sepolia. */
  x402FacilitatorUrl(): string {
    return (
      optional("M2M_PAYMENTS_X402_FACILITATOR_URL") ?? "https://x402.org/facilitator"
    ).replace(/\/+$/, "");
  },
  /** The demo endpoints, as the config route and the chat prompt name them. */
  demoUrls(): { x402Url: string; mppUrl: string } {
    const web = this.webBaseUrl();
    return { x402Url: `${web}/api/demo/x402/inference`, mppUrl: `${web}/api/demo/mpp/inference` };
  },
};
