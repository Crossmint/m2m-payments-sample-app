import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** What `m2m-payments login` stores. Lives in `~/.config/m2m-payments/config.json` with mode 0600. */
export interface M2mPaymentsConfig {
  apiBaseUrl: string;
  accessToken?: string;
  refreshToken?: string;
  /** ISO timestamp for when `accessToken` stops working. */
  expiresAt?: string;
  /** OAuth token endpoint, kept so refresh needs no network discovery. */
  tokenEndpoint?: string;
  /** OAuth client id of the CLI Connected App. */
  clientId?: string;
  userId?: string;
  email?: string;
}

export type Env = Record<string, string | undefined>;

/** `$XDG_CONFIG_HOME/m2m-payments` or `~/.config/m2m-payments`. `M2M_PAYMENTS_CONFIG_DIR` wins when set. */
export function configDir(env: Env = process.env): string {
  if (env.M2M_PAYMENTS_CONFIG_DIR) return env.M2M_PAYMENTS_CONFIG_DIR;
  const base =
    env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim() !== ""
      ? env.XDG_CONFIG_HOME
      : join(homedir(), ".config");
  return join(base, "m2m-payments");
}

export function configPath(env: Env = process.env): string {
  return join(configDir(env), "config.json");
}

export interface ConfigStore {
  readonly path: string;
  read(): M2mPaymentsConfig | null;
  write(config: M2mPaymentsConfig): void;
  clear(): void;
}

export function createConfigStore(env: Env = process.env): ConfigStore {
  const path = configPath(env);
  return {
    path,
    read: () => readConfig(path),
    write: (config) => writeConfig(config, path),
    clear: () => clearConfig(path),
  };
}

export function readConfig(path: string = configPath()): M2mPaymentsConfig | null {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<M2mPaymentsConfig>;
    if (!raw || typeof raw.apiBaseUrl !== "string") return null;
    return raw as M2mPaymentsConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: M2mPaymentsConfig, path: string = configPath()): void {
  const dir = join(path, "..");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // `mode` is ignored when the file already exists. Force it.
  chmodSync(path, 0o600);
}

export function clearConfig(path: string = configPath()): void {
  rmSync(path, { force: true });
}

/**
 * Effective settings for one command run. The file is the base. Environment
 * variables override it so CI and agents need no login step:
 * - `M2M_PAYMENTS_API_URL`: API base URL, e.g. https://wallet.example.com/api/m2m-payments
 * - `M2M_PAYMENTS_TOKEN`: a bearer token. No refresh happens for env tokens.
 */
export interface ResolvedConfig extends M2mPaymentsConfig {
  /** True when the token came from `M2M_PAYMENTS_TOKEN`. */
  tokenFromEnv: boolean;
}

export function resolveConfig(store: ConfigStore, env: Env = process.env): ResolvedConfig | null {
  const file = store.read();
  const apiBaseUrl = normalizeBaseUrl(env.M2M_PAYMENTS_API_URL ?? file?.apiBaseUrl);
  if (!apiBaseUrl) return null;
  if (env.M2M_PAYMENTS_TOKEN) {
    return {
      ...(file ?? {}),
      apiBaseUrl,
      accessToken: env.M2M_PAYMENTS_TOKEN,
      refreshToken: undefined,
      expiresAt: undefined,
      tokenFromEnv: true,
    };
  }
  return { ...(file ?? {}), apiBaseUrl, tokenFromEnv: false };
}

export function normalizeBaseUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed === "" ? undefined : trimmed;
}
