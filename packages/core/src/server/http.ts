import type { ProtocolPaymentInput, ProtocolResponse } from "../types.js";

/** Response bodies are cut here so a tool result stays readable. */
export const RESPONSE_BODY_LIMIT = 16 * 1024;

/** Response headers worth returning: the content type and the protocols' receipts. */
const KEPT_HEADERS = [
  "content-type",
  "payment-response",
  "x-payment-response",
  "payment-receipt",
  "payment",
  "www-authenticate",
];

/** Build the `RequestInit` for a protocol payment from the API body. */
export function toRequestInit(input: ProtocolPaymentInput): RequestInit {
  const headers = new Headers(input.headers ?? {});
  const method = (input.method ?? (input.body === undefined ? "GET" : "POST")).toUpperCase();
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", looksLikeJson(input.body) ? "application/json" : "text/plain");
  }
  return { method, headers, body: method === "GET" || method === "HEAD" ? undefined : input.body };
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
}

/** Read a response into the shape the API returns: status, a few headers, the body cut to size. */
export async function toProtocolResponse(res: Response): Promise<ProtocolResponse> {
  const text = await res.text().catch(() => "");
  const headers: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return {
    status: res.status,
    headers,
    body: text.length > RESPONSE_BODY_LIMIT ? text.slice(0, RESPONSE_BODY_LIMIT) : text,
    truncated: text.length > RESPONSE_BODY_LIMIT,
  };
}

/** "api.example.com" from a URL, for the payments ledger. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
