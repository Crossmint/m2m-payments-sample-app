import {
  CrossmintWallets,
  createCrossmint,
  EVMWallet,
  type Chain,
  type Wallet,
} from "@crossmint/wallets-sdk";
import { unitsToCredits, credits } from "../amount.js";
import { WalletNotFoundError } from "../errors.js";
import { chainFor, explorerUrl, UNDERLYING } from "../token.js";
import type { ActivityItem, Amount, CrossmintEnvironment } from "../types.js";

/*
 * The Crossmint wallets SDK, server side, for one deployment.
 *
 * Every call here runs with the server API key. The wallet is always looked
 * up by its owner locator, `userId:<id>:evm`, never by an address a caller
 * sends: the user id comes from the verified JWT, so a caller can only ever
 * reach their own wallet.
 *
 * The agent's signer is a server signer derived from one secret. Adding it to
 * a wallet is prepared here and approved in the browser by the user's email
 * signer; from then on `asAgent` activates it and the SDK signs in process.
 */

export type WalletChain = ReturnType<typeof chainFor>;
export type UserWallet = Wallet<WalletChain>;

export interface WalletsClientOptions {
  serverApiKey: string;
  environment: CrossmintEnvironment;
  /** `M2M_PAYMENTS_SIGNER_SECRET`. 64 hex chars or `xmsk1_<64 hex>`. */
  signerSecret: string;
}

export interface PreparedSigner {
  /** "server:0x..." */
  locator: string;
  signatureId?: string;
  transactionId?: string;
}

export interface AgentWallet {
  /** The wallet with the server signer active. */
  evm: EVMWallet;
  address: `0x${string}`;
  chain: WalletChain;
  chainId: number;
}

export function walletLocator(userId: string): string {
  return `userId:${userId}:evm`;
}

export type WalletsClient = ReturnType<typeof createWalletsClient>;

export function createWalletsClient(opts: WalletsClientOptions) {
  const chain = chainFor(opts.environment);
  const underlying = UNDERLYING[opts.environment];
  const sdk = CrossmintWallets.from(createCrossmint({ apiKey: opts.serverApiKey }));
  const serverSigner = { type: "server" as const, secret: opts.signerSecret };

  /** The user's wallet, or `WalletNotFoundError`. */
  async function getUserWallet(userId: string): Promise<UserWallet> {
    try {
      return (await sdk.getWallet(walletLocator(userId), { chain })) as UserWallet;
    } catch (e) {
      if (isNotFound(e)) throw new WalletNotFoundError(userId);
      throw e;
    }
  }

  /** The credits balance, from the underlying token's balance. */
  async function balance(wallet: UserWallet): Promise<Amount> {
    const balances = await wallet.balances([underlying.symbol]);
    const token =
      balances.tokens.find((t) => t.symbol?.toLowerCase() === underlying.symbol) ??
      (balances.usdc?.symbol?.toLowerCase() === underlying.symbol ? balances.usdc : undefined);
    const amount = token?.amount ?? "0";
    return credits(amount);
  }

  /** Register the agent's server signer on the wallet, without approving it. The user approves in the browser. */
  async function prepareAgentSigner(wallet: UserWallet): Promise<PreparedSigner> {
    const result = await wallet.addSigner(serverSigner, { prepareOnly: true });
    const out: PreparedSigner = { locator: result.locator };
    if ("signatureId" in result && result.signatureId) out.signatureId = result.signatureId;
    if ("transactionId" in result && result.transactionId) out.transactionId = result.transactionId;
    return out;
  }

  /** True once the user has approved the signer and Crossmint has it active. */
  async function agentSignerApproved(wallet: UserWallet, locator: string): Promise<boolean> {
    try {
      return await wallet.isSignerApproved(locator);
    } catch {
      return false;
    }
  }

  /** The locator our secret derives to on this wallet, if it is registered at all. */
  async function findAgentSigner(wallet: UserWallet): Promise<string | undefined> {
    const signers = await wallet.signers();
    const ours = signers.find(
      (s) => (s as { type?: string }).type === "server" && typeof s.locator === "string",
    );
    return ours?.locator;
  }

  /** Prepare removing the agent's signer. The user approves in the browser. */
  async function prepareRemoveAgentSigner(wallet: UserWallet): Promise<{ transactionId?: string }> {
    const result = await wallet.removeSigner(serverSigner as never, { prepareOnly: true });
    return { transactionId: result.transactionId };
  }

  /** Activate the server signer and hand back an EVM wallet that signs with it. */
  async function asAgent(wallet: UserWallet): Promise<AgentWallet> {
    await wallet.useSigner(serverSigner as never);
    const evm = EVMWallet.from(wallet as Wallet<Chain>);
    return {
      evm,
      address: evm.address as `0x${string}`,
      chain,
      chainId: underlying.chainId,
    };
  }

  /** Send credits with the agent's signer. */
  async function send(agent: AgentWallet, to: string, amount: string) {
    return agent.evm.send(to, underlying.symbol, amount);
  }

  /** On-chain transfers of the underlying token, as the app's activity feed shows them. */
  async function activity(wallet: UserWallet, limit = 50): Promise<ActivityItem[]> {
    const result = await wallet.transfers({ status: "successful", tokens: underlying.symbol });
    const rows = (result as { data?: unknown[] }).data ?? [];
    const items: ActivityItem[] = [];
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      const token = (r.token ?? {}) as Record<string, unknown>;
      const symbol = String(token.symbol ?? "").toLowerCase();
      if (symbol && symbol !== underlying.symbol) continue;
      const type = String(r.type ?? "");
      const direction: "in" | "out" = type.endsWith(".in") ? "in" : "out";
      const onChain = (r.onChain ?? {}) as Record<string, unknown>;
      const hash = typeof onChain.txId === "string" ? onChain.txId : undefined;
      const rawAmount = token.amount;
      const value =
        typeof rawAmount === "string"
          ? rawAmount
          : typeof token.rawAmount === "string"
            ? unitsToCredits(token.rawAmount)
            : "0";
      items.push({
        id: String(r.id ?? hash ?? `${type}-${items.length}`),
        direction,
        amount: credits(value),
        counterparty:
          typeof (direction === "in" ? r.from : r.to) === "string"
            ? String(direction === "in" ? r.from : r.to)
            : undefined,
        hash,
        explorerUrl:
          typeof onChain.explorerLink === "string"
            ? onChain.explorerLink
            : hash
              ? explorerUrl(opts.environment, "tx", hash)
              : undefined,
        completedAt: String(r.completedAt ?? r.createdAt ?? new Date().toISOString()),
      });
      if (items.length >= limit) break;
    }
    return items;
  }

  return {
    chain,
    chainId: underlying.chainId,
    underlying,
    getUserWallet,
    balance,
    prepareAgentSigner,
    agentSignerApproved,
    findAgentSigner,
    prepareRemoveAgentSigner,
    asAgent,
    send,
    activity,
    explorer: (kind: "address" | "tx", id: string) => explorerUrl(opts.environment, kind, id),
  };
}

function isNotFound(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = (e as { name?: string }).name ?? "";
  const message = (e as { message?: string }).message ?? "";
  const status = (e as { status?: number }).status;
  return (
    name === "WalletNotAvailableError" ||
    status === 404 ||
    /not found|does not exist|no wallet/i.test(message)
  );
}
