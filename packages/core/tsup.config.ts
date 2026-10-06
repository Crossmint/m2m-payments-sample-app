import { defineConfig } from "tsup";

/**
 * Two entries. The root is browser-safe: types, the token, formatting, tool
 * docs. `server` pulls in the Crossmint wallets SDK, viem, x402 and mppx, and
 * only Node code imports it. Keeping them apart is what keeps those out of
 * the browser bundle when `@m2m-payments/ui` imports the root.
 */
export default defineConfig({
  entry: { index: "src/index.ts", "server/index": "src/server/index.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  external: ["@crossmint/wallets-sdk", "@x402/core", "@x402/evm", "@x402/fetch", "mppx", "viem"],
});
