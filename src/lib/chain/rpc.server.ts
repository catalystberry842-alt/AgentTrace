import { fallback, http, type Transport } from "viem";
import { MONAD_TESTNET } from "@/lib/chain/network";

function validRpcUrl(value: string): boolean {
  if (/\s/.test(value) || value.length >= 300) return false;
  if (value.startsWith("https://")) return true;
  // Local node for development (e.g. an anvil fork of Monad testnet). Never a remote plain-http URL.
  return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(value);
}

/** Server-only RPC. A public https URL may override the default. Secrets never belong here. */
export function monadRpcUrl(): string {
  const fromEnv = process.env.MONAD_TESTNET_RPC_URL?.trim() ?? "";
  if (validRpcUrl(fromEnv)) return fromEnv;
  return MONAD_TESTNET.rpcUrl;
}

/** The configured RPC first, then the public fallbacks unless an explicit override is set. */
export function monadRpcUrls(): string[] {
  const primary = monadRpcUrl();
  if (primary !== MONAD_TESTNET.rpcUrl) return [primary];
  return [primary, ...MONAD_TESTNET.fallbackRpcUrls];
}

/** Endpoints that recently failed at the network level, skipped first until the time passes. */
const slot = globalThis as typeof globalThis & { __agenttraceRpcDown?: Map<string, number> };
function downList(): Map<string, number> {
  slot.__agenttraceRpcDown ??= new Map();
  return slot.__agenttraceRpcDown;
}
const DOWN_MS = 60_000;
const NETWORK_ERRORS = new Set(["HttpRequestError", "TimeoutError", "LimitExceededRpcError", "UnknownRpcError"]);

/**
 * viem transport that moves to the next public endpoint when one errors or times out.
 * An endpoint that fails at the network level (connection, timeout, rate limit) is tried last
 * for the next minute, so one dead endpoint does not slow every request. Contract reverts and
 * other JSON-RPC answers do not count as failures.
 */
export function monadTransport(timeout = 8_000): Transport {
  const urls = monadRpcUrls();
  if (urls.length === 1) return http(urls[0], { timeout, retryCount: 1 });
  const down = downList();
  const now = Date.now();
  const healthy = urls.filter((url) => (down.get(url) ?? 0) <= now);
  const ordered = [...healthy, ...urls.filter((url) => !healthy.includes(url))];
  return fallback(
    ordered.map((url, i) => tracked(url, timeout, down, i === ordered.length - 1)),
    { retryCount: 1 },
  );
}

/**
 * One http endpoint that marks itself down on a network-level failure, and steps aside
 * (so the fallback moves on at once) while it is down, unless it is the last option.
 */
function tracked(url: string, timeout: number, down: Map<string, number>, last: boolean): Transport {
  const markDown = () => down.set(url, Date.now() + DOWN_MS);
  const base = http(url, {
    timeout,
    retryCount: 0,
    onFetchResponse: (response) => {
      if (response.status === 429 || response.status >= 500) markDown();
    },
  });
  return ((params: Parameters<Transport>[0]) => {
    const t = base(params);
    const request: typeof t.request = async (args, options) => {
      if (!last && (down.get(url) ?? 0) > Date.now()) throw new Error(`${url} is cooling down after a failure`);
      try {
        return await t.request(args, options);
      } catch (err) {
        if (err instanceof Error && NETWORK_ERRORS.has(err.name)) markDown();
        throw err;
      }
    };
    return { ...t, request };
  }) as Transport;
}

/** eth_getLogs block span per request. Defaults to the public RPC limit of 100 blocks. */
export function logBlockRange(): number {
  const fromEnv = Number(process.env.MONAD_LOGS_BLOCK_RANGE?.trim() ?? "");
  if (Number.isInteger(fromEnv) && fromEnv >= 1 && fromEnv <= 10_000) return fromEnv;
  return MONAD_TESTNET.maxLogBlockRange;
}
