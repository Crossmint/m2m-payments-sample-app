import { Mppx, evm } from "mppx/client";
import type { Account, Hex } from "viem";
import { compareDecimal, credits, unitsToCredits } from "../amount.js";
import { PaymentFailedError, PaymentTooLargeError } from "../errors.js";
import { CREDITS } from "../token.js";
import type { ProtocolPaymentInput, ProtocolResponse, ProtocolSettlement } from "../types.js";
import type { AgentWallet } from "./wallets.js";
import { toProtocolResponse, toRequestInit } from "./http.js";
import { stringifyBigInts } from "./x402.js";

/*
 * Pay an MPP endpoint from the agent's wallet.
 *
 * The Machine Payments Protocol answers 402 with a `WWW-Authenticate: Payment`
 * challenge naming a method. The `evm` charge method wants an EIP-3009
 * transfer authorization on the chain and asset the challenge names; the
 * client signs it with the wallet's signer and retries with the credential.
 * `prepareRequest` splits the two steps so the amount can be checked against
 * `maxAmount` before anything is signed.
 */

export interface MppPayOptions {
  agent: AgentWallet;
  input: ProtocolPaymentInput;
  maxAmount: string;
  decimals: number;
  fetch?: typeof fetch;
}

export interface MppPayResult {
  paid: boolean;
  amount?: { value: string; currency: string };
  settlement?: ProtocolSettlement;
  response: ProtocolResponse;
}

export async function payWithMpp(opts: MppPayOptions): Promise<MppPayResult> {
  const { agent, input } = opts;
  const baseFetch = opts.fetch ?? globalThis.fetch.bind(globalThis);

  // A viem-shaped account whose signing goes through the Crossmint wallet.
  const account = {
    address: agent.address,
    type: "local",
    source: "crossmint",
    publicKey: "0x" as Hex,
    async signTypedData(typedData: Record<string, unknown>): Promise<Hex> {
      const data = stringifyBigInts(typedData) as Record<string, unknown>;
      const { signature } = await agent.evm.signTypedData({
        ...data,
        chain: agent.chain,
      } as never);
      return signature as Hex;
    },
    async signMessage({ message }: { message: string | { raw: Hex } }): Promise<Hex> {
      const text = typeof message === "string" ? message : message.raw;
      const { signature } = await agent.evm.signMessage({ message: text });
      return signature as Hex;
    },
    async signTransaction(): Promise<Hex> {
      throw new Error("The Crossmint wallet does not sign raw transactions for MPP.");
    },
  } as unknown as Account;

  const mppx = Mppx.create({
    polyfill: false,
    fetch: baseFetch,
    methods: [evm({ account })],
  } as never);

  let prepared;
  try {
    prepared = await mppx.prepareRequest(input.url, toRequestInit(input));
  } catch (e) {
    throw new PaymentFailedError(
      `MPP request to ${input.url} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // No challenge: the endpoint answered without asking for money.
  if (!prepared.payment) {
    return { paid: false, response: await toProtocolResponse(prepared.response) };
  }

  const request = prepared.payment.challenge.request as {
    amount?: string;
    methodDetails?: { decimals?: number };
    description?: string;
  };
  const decimals = request.methodDetails?.decimals ?? opts.decimals;
  const charged = request.amount ? unitsToCredits(BigInt(request.amount), decimals) : undefined;
  if (charged && compareDecimal(charged, opts.maxAmount, decimals) > 0) {
    throw new PaymentTooLargeError(charged, opts.maxAmount, CREDITS);
  }

  let paidResponse: Response;
  try {
    paidResponse = await prepared.payment.pay();
  } catch (e) {
    throw new PaymentFailedError(
      `MPP payment to ${input.url} failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const response = await toProtocolResponse(paidResponse);
  if (paidResponse.status === 402) {
    throw new PaymentFailedError(`The endpoint at ${input.url} still answered 402 after payment`, {
      response,
    });
  }
  const receipt = paidResponse.headers.get("payment-receipt");
  return {
    paid: true,
    amount: charged ? credits(charged) : undefined,
    settlement: {
      reference: receipt ?? undefined,
      network: `eip155:${agent.chainId}`,
      payer: agent.address,
    },
    response,
  };
}
