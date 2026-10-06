import { describe, expect, it } from "vitest";
import { describeTool, paramDoc, TOOL_DOCS, toolNamesFor } from "../src/tool-docs.js";

describe("tool docs", () => {
  it("offers the wait-in-chat tools only to the chat, and the poll tools only to MCP", () => {
    const chat = toolNamesFor("chat");
    const mcp = toolNamesFor("mcp");
    expect(chat).toContain("await_wallet_access");
    expect(chat).toContain("await_top_up");
    expect(mcp).not.toContain("await_wallet_access");
    expect(mcp).toContain("get_access_request");
    expect(mcp).toContain("get_top_up_request");
    expect(chat).not.toContain("get_access_request");
  });

  it("puts the payment tools on both surfaces", () => {
    for (const name of [
      "pay_x402",
      "pay_mpp",
      "transfer",
      "send_transaction",
      "get_balance",
    ] as const) {
      expect(TOOL_DOCS[name].surfaces).toEqual(["mcp", "chat"]);
    }
  });

  it("describes a tool with its shared summary first", () => {
    expect(describeTool("pay_x402", "Extra.")).toBe(`${TOOL_DOCS.pay_x402.summary} Extra.`);
    expect(paramDoc("pay_x402", "url")).toBe(TOOL_DOCS.pay_x402.params.url);
  });
});
