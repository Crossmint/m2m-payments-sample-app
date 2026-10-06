import { createHash } from "node:crypto";
import { UNDERLYING } from "@m2m-payments/core";
import { Mppx, evm } from "mppx/server";
import { fakeInference, promptFrom } from "@/lib/demo/inference";
import { serverEnv } from "@/lib/env";

/**
 * POST /api/demo/mpp/inference: a paid endpoint the demo pays with the
 * Machine Payments Protocol.
 *
 * `mppx/server` does the protocol: without a credential it answers 402 with
 * a `WWW-Authenticate: Payment` challenge naming the chain, the asset and the
 * recipient; with a signed EIP-3009 authorization it verifies the signature,
 * settles it through the x402 facilitator (the same one the x402 endpoint
 * uses, so no RPC of our own), and returns the answer with a receipt header.
 * The agent's side lives in `payWithMpp` in `@m2m-payments/core/server`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DESCRIPTION = "Acme research inference";

/** EIP-712 domain of the USDC contract, per chain. The token is not in mppx's known list on Base Sepolia. */
const USDC_DOMAIN = {
  staging: { name: "USDC", version: "2" },
  production: { name: "USD Coin", version: "2" },
} as const;

type Handler = ReturnType<typeof buildMppx>;
let mppx: Handler | undefined;

function buildMppx(payTo: `0x${string}`, secretKey: string) {
  const env = serverEnv.crossmintEnvironment();
  const token = UNDERLYING[env];
  return Mppx.create({
    methods: [
      evm.charge({
        chainId: token.chainId,
        currency: token.address,
        decimals: 6,
        recipient: payTo,
        authorization: USDC_DOMAIN[env],
        // Verification and settlement go through the x402 facilitator, which
        // speaks the same EIP-3009 authorization.
        x402: { facilitator: serverEnv.x402FacilitatorUrl() },
      }),
    ],
    secretKey,
    realm: new URL(serverEnv.webBaseUrl()).hostname,
  });
}

/**
 * The HMAC key that binds a challenge to the credential answering it. A
 * dedicated `MPP_SECRET_KEY` when set; otherwise a hash of the signer secret,
 * so the demo needs no extra env var and the signer secret itself is never
 * used as an HMAC key.
 */
function secretKey(): string | undefined {
  const own = serverEnv.optional("MPP_SECRET_KEY");
  if (own) return own;
  const signer = serverEnv.optional("M2M_PAYMENTS_SIGNER_SECRET");
  return signer ? createHash("sha256").update(`mpp:${signer}`).digest("hex") : undefined;
}

export async function POST(req: Request): Promise<Response> {
  const payTo = serverEnv.demoPayTo();
  if (!payTo) {
    return Response.json(
      {
        error: {
          code: "not_configured",
          message: "Set M2M_PAYMENTS_DEMO_PAY_TO to an EVM address to turn the demo endpoints on.",
        },
      },
      { status: 503 },
    );
  }
  const key = secretKey();
  if (!key) {
    return Response.json(
      {
        error: {
          code: "not_configured",
          message:
            "Set M2M_PAYMENTS_SIGNER_SECRET or MPP_SECRET_KEY so the MPP demo can bind its challenges.",
        },
      },
      { status: 503 },
    );
  }

  mppx ??= buildMppx(payTo, key);

  // The prompt is read from a clone: mppx may hash the body to bind the challenge to it.
  const prompt = await promptFrom(req);

  const result = await mppx.evm.charge({ amount: serverEnv.demoPrice(), description: DESCRIPTION })(
    req,
  );
  if (result.status === 402) return result.challenge;

  return result.withReceipt(Response.json(fakeInference(prompt)));
}
