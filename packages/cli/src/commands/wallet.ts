import type { Command } from "commander";
import type { WalletView } from "@m2m-payments/core";
import pc from "picocolors";
import type { CliContext } from "../context.js";
import { formatDate, kv, statusColor, toJson } from "../output.js";
import { fmt, getApi, type JsonOption, needsUser, printUserLink, withJson } from "./shared.js";

export function registerWalletCommands(program: Command, ctx: CliContext): void {
  withJson(
    program
      .command("wallet")
      .description("the wallet: address, chain, credits balance and this agent's access"),
  ).action(async (opts: JsonOption) => {
    const api = getApi(ctx);
    const wallet = await api.getWallet();
    if (opts.json) ctx.out(toJson(wallet));
    else printWallet(ctx, wallet);
    if (wallet.agentAccess.status === "pending" && wallet.agentAccess.approvalUrl) {
      throw needsUser(
        opts.json
          ? `Agent access is pending. The user must open ${wallet.agentAccess.approvalUrl}.`
          : "",
        "access_pending",
      );
    }
  });

  withJson(program.command("balance").description("the credits balance")).action(
    async (opts: JsonOption) => {
      const api = getApi(ctx);
      const balance = await api.getBalance();
      if (opts.json) ctx.out(toJson(balance));
      else
        ctx.out(
          `${pc.bold(fmt(balance.balance) ?? "")} ${pc.dim(`on ${balance.address} (${balance.token.chain})`)}`,
        );
    },
  );
}

export function printWallet(ctx: CliContext, w: WalletView): void {
  const access = w.agentAccess;
  ctx.out(`Wallet ${pc.bold(w.address)} ${pc.dim("·")} ${w.chain}`);
  for (const line of kv([
    ["Balance", fmt(w.balance)],
    ["Agent access", statusColor(access.status)],
    ["Signer", access.signerLocator],
    ["Granted", formatDate(access.grantedAt)],
    ["Revoked", formatDate(access.revokedAt)],
    ["Explorer", w.explorerUrl],
  ]))
    ctx.out(line);
  switch (access.status) {
    case "none":
      ctx.out(pc.dim("This agent cannot pay yet. Run `m2m-payments access request` first."));
      break;
    case "pending":
      if (access.approvalUrl)
        printUserLink(
          ctx,
          "Waiting for the user. Open this link to approve:",
          access.approvalUrl,
          `Show this URL to the user verbatim. Then run \`m2m-payments access status ${access.requestId ?? "<id>"} --wait\`.`,
        );
      break;
    case "revoked":
      ctx.out(pc.dim("The user revoked this agent's access. Ask them before requesting again."));
      break;
    default:
      break;
  }
}
