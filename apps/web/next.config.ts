import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship built ESM in dist/. Turbopack resolves them as is.
  // List @m2m-payments/ui here only if you point its exports at src/.
  transpilePackages: [],
  // Postgres, the Stytch node SDK, the payment protocol SDKs and the Crossmint
  // wallets SDK stay external on the server: they carry Node-only code.
  serverExternalPackages: [
    "postgres",
    "stytch",
    "@x402/core",
    "@x402/evm",
    "mppx",
    "@crossmint/wallets-sdk",
  ],
  // /install reads the skill file at request time.
  outputFileTracingIncludes: { "/install": ["./public/skill.md"] },
};

export default nextConfig;
