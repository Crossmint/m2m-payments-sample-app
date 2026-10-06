const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/** 21 url-safe random chars, same alphabet as nanoid. */
export function randomId(length = 21): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 63];
  return out;
}

export function accessRequestId(): string {
  return `acs_${randomId(21)}`;
}

export function topUpRequestId(): string {
  return `tup_${randomId(21)}`;
}

export function paymentId(): string {
  return `pay_${randomId(21)}`;
}
