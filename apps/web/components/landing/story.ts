import { AGENT_COMPANY, AGENT_DOMAIN, AGENT_NAME } from "@/components/brand";

/*
 * The one story every mock on the page tells: the user asks Acme Agent for a
 * market brief, the agent asks to use the wallet, the user approves once with
 * an email code, the wallet is short so the agent asks for a $10 top-up, the
 * user pays by card with no ID check, the agent pays a research API over x402
 * at 0.05 credits a call and hands back the brief with the receipt. One place
 * for the figures, so the phone, the terminal and the desktop window agree.
 *
 * The agent is Acme's, not Crossmint's: every agent surface and every
 * example URL wears Acme. Crossmint stays in the page chrome.
 */

const agentOrigin = `https://${AGENT_DOMAIN}`;

export const STORY = {
  /** The agent the user talks to, and the company that built it. */
  agent: AGENT_NAME,
  company: AGENT_COMPANY,
  agentDomain: AGENT_DOMAIN,
  agentOrigin,
  /** Acme's own CLI, built on @m2m-payments/cli. */
  cli: AGENT_COMPANY.toLowerCase(),

  ask: "Put together a market brief on EV charging in Europe",
  purpose: "Market brief",
  /** The agent's reason on the access request, in its words. */
  reason: "Research API calls",
  /** What the agent's server signer may do once approved. */
  canDo: "Pay x402 and MPP services",
  /** The user's wallet, short form. */
  address: "0x7a3F…9c2E",

  /** The wallet before and after the top-up, and what the brief needs. */
  balanceBefore: "0.20",
  needs: "2",
  topUpBare: "10",
  topUp: "$10",
  topUpCharge: "$10.00",
  topUpCredits: "10.00",
  balanceAfter: "10.20",
  card: "Mastercard •••• 4444",

  /** The research API the agent pays, and what one call costs. */
  api: "api.acme-research.com",
  apiUrl: "https://api.acme-research.com/v1/search",
  apiQuery: "EV charging Europe",
  callPrice: "0.05",
  sources: "40",
  txHash: "0x4f1a…e77b",
  network: "Base",

  accessRequestId: "acs_8f2k1d",
  topUpRequestId: "tup_3m9q0z",

  /** The example URLs, all on Acme's domain. */
  approveUrl: `${agentOrigin}/approve/acs_8f2k1d`,
  approvePath: `${AGENT_DOMAIN}/approve/acs_8f2k1d`,
  topUpUrl: `${agentOrigin}/top-up/tup_3m9q0z`,
  topUpPath: `${AGENT_DOMAIN}/top-up/tup_3m9q0z`,
  appAddress: `${AGENT_DOMAIN}/app`,
  mcpUrl: `${agentOrigin}/api/mcp`,

  receipt: {
    lines: [
      { label: "Research API · 2 calls", amount: "0.10 credits" },
      { label: "Data export", amount: "0.05 credits" },
    ],
    total: "0.15 credits",
  },
  /** The steps the payment run goes through, in order. */
  paymentSteps: [
    "Opened api.acme-research.com",
    "Paid 0.05 credits over x402",
    "Fetched 40 sources",
    "Paid 0.05 credits over x402",
    "Brief ready",
  ],
} as const;
