export class CrossmintApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;
  readonly url: string;

  constructor(opts: { status: number; url: string; body: unknown; message?: string }) {
    const bodyMessage =
      typeof opts.body === "object" && opts.body !== null && "message" in opts.body
        ? String((opts.body as { message: unknown }).message)
        : undefined;
    super(opts.message ?? bodyMessage ?? `Crossmint request failed with ${opts.status}`);
    this.name = "CrossmintApiError";
    this.status = opts.status;
    this.url = opts.url;
    this.body = opts.body;
    this.code =
      typeof opts.body === "object" && opts.body !== null && "code" in opts.body
        ? String((opts.body as { code: unknown }).code)
        : undefined;
  }

  get isUnauthorized(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * A domain error with a stable code from docs/API.md. The server maps these
 * to the HTTP envelope; the CLI and MCP read the code back.
 */
export class M2mPaymentsError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "M2mPaymentsError";
    this.code = code;
    this.details = details;
  }
}

/** The user has no wallet yet. The browser creates it on first sign-in. */
export class WalletNotFoundError extends M2mPaymentsError {
  constructor(userId: string) {
    super("wallet_not_found", `No wallet for user ${userId}. Open the app once to create it.`, {
      userId,
    });
    this.name = "WalletNotFoundError";
  }
}

/** The wallet cannot cover a payment. Both amounts are in credits. */
export class InsufficientFundsError extends M2mPaymentsError {
  constructor(balance: string, required: string, currency: string) {
    super(
      "insufficient_funds",
      `The wallet holds ${balance} ${currency} and this needs ${required} ${currency}. Ask the user to top up.`,
      { balance: { value: balance, currency }, required: { value: required, currency } },
    );
    this.name = "InsufficientFundsError";
  }
}

/** An endpoint asked for more than the caller allowed for one call. */
export class PaymentTooLargeError extends M2mPaymentsError {
  constructor(required: string, maxAmount: string, currency: string) {
    super(
      "invalid_request",
      `The endpoint asks for ${required} ${currency}, above the ${maxAmount} ${currency} allowed for this call. Raise maxAmount if the user agrees.`,
      { required: { value: required, currency }, maxAmount: { value: maxAmount, currency } },
    );
    this.name = "PaymentTooLargeError";
  }
}

/** The payment settled but the endpoint then failed, or the protocol handshake broke. */
export class PaymentFailedError extends M2mPaymentsError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("payment_failed", message, details);
    this.name = "PaymentFailedError";
  }
}
