import type { CrossmintEnvironment, TokenInfo } from "./types.js";

/*
 * The closed-loop token. This is the one thing the wallet holds and spends.
 *
 * It is a made-up name over a real asset: credits are USDC on Base (Sepolia
 * on staging), one credit for one dollar. The user buys them by card, with
 * no identity check, because they only pay for machine services. User-facing
 * text says credits; the underlying asset shows in developer surfaces only.
 *
 * To back credits with another asset, change `UNDERLYING` here and nothing
 * else: every amount in the system is a decimal string in credits, and the
 * server converts at the edge with `decimals`.
 */

/** The user-facing token. */
export const CLOSED_LOOP_TOKEN = {
  symbol: "CRED",
  name: "Credits",
  /** One credit is one dollar. The onramp charges this in USD. */
  fiat: "USD",
  decimals: 6,
} as const;

/** The currency code every `Amount` in credits carries. */
export const CREDITS = CLOSED_LOOP_TOKEN.symbol;

/** The asset behind credits, per Crossmint environment. Base Sepolia on staging, Base in production. */
export const UNDERLYING: Record<
  CrossmintEnvironment,
  { chain: "base-sepolia" | "base"; chainId: number; symbol: string; address: `0x${string}` }
> = {
  staging: {
    chain: "base-sepolia",
    chainId: 84532,
    symbol: "usdc",
    address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
  production: {
    chain: "base",
    chainId: 8453,
    symbol: "usdc",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  },
};

/** The token as `GET /v1/config` and `GET /v1/wallet` describe it. */
export function tokenInfo(environment: CrossmintEnvironment): TokenInfo {
  const u = UNDERLYING[environment];
  return {
    symbol: CLOSED_LOOP_TOKEN.symbol,
    name: CLOSED_LOOP_TOKEN.name,
    decimals: CLOSED_LOOP_TOKEN.decimals,
    chain: u.chain,
    underlying: {
      symbol: u.symbol.toUpperCase(),
      address: u.address,
      locator: `${u.chain}:${u.address}`,
    },
  };
}

/** The chain the wallet lives on in this environment. */
export function chainFor(environment: CrossmintEnvironment): "base-sepolia" | "base" {
  return UNDERLYING[environment].chain;
}

/** CAIP-2 network id, the form x402 uses: `eip155:84532`. */
export function x402Network(environment: CrossmintEnvironment): `eip155:${number}` {
  return `eip155:${UNDERLYING[environment].chainId}`;
}

/** Block explorer for the chain. */
export function explorerBase(environment: CrossmintEnvironment): string {
  return environment === "production" ? "https://basescan.org" : "https://sepolia.basescan.org";
}

export function explorerUrl(
  environment: CrossmintEnvironment,
  kind: "address" | "tx",
  id: string,
): string {
  return `${explorerBase(environment)}/${kind}/${id}`;
}
