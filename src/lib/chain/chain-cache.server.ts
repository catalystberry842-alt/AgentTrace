import type { Log } from "viem";
import type { Sql } from "@/lib/db";
import { MONAD_TESTNET } from "@/lib/chain/network";

/**
 * Durable cache of the raw contract logs the indexer has already read from Monad.
 *
 * The indexed tables live in the app database. On a serverless host without Postgres that
 * database is in memory and starts empty on every cold start, and rescanning from the deploy
 * block grows with chain age (public RPCs allow 100 blocks per eth_getLogs). This cache keeps
 * the logs and the scanned-to block in Vercel Blob, so a fresh instance replays the cached logs
 * into its tables and only scans the blocks after the cursor.
 *
 * It stores only public chain data copied verbatim from eth_getLogs. Replay goes through the
 * same apply functions as a live scan. Enabled only when BLOB_READ_WRITE_TOKEN is set.
 */

type CachedLog = {
  address: string;
  blockNumber: string;
  logIndex: number;
  transactionHash: string;
  data: string;
  topics: string[];
};

type ContractEntry = { scannedTo: number; logs: CachedLog[] };
/** An outcome check someone asked for. Only the request is kept; the verdict is recomputed. */
export type OutcomeRequest = { executionId: string; expectation: unknown };
type CacheDoc = {
  version: 1;
  chainId: number;
  contracts: Record<string, ContractEntry>;
  outcomeRequests?: OutcomeRequest[];
  /** Small public string maps, e.g. ERC-8004 links and the transactions that posted to them. */
  kv?: Record<string, Record<string, string>>;
};

const PATHNAME = `agenttrace/chain-cache-${MONAD_TESTNET.chainId}.json`;
const FLUSH_BLOCK_STEP = 20_000;
const FLUSH_MIN_INTERVAL_MS = 120_000;

type State = {
  doc?: Promise<CacheDoc | null>;
  hydrated: Record<string, Promise<void>>;
  pending: Record<string, ContractEntry>;
  flushedTo: Record<string, number>;
  lastFlushAt: number;
  dirty: boolean;
  requests: OutcomeRequest[];
  requestsReadAt: number;
  logsReadAt?: Record<string, number>;
  kv?: Record<string, Record<string, string>>;
  kvReadAt?: number;
};
const slot = globalThis as typeof globalThis & { __agenttraceChainCache?: State };
function state(): State {
  slot.__agenttraceChainCache ??= {
    hydrated: {},
    pending: {},
    flushedTo: {},
    lastFlushAt: 0,
    dirty: false,
    requests: [],
    requestsReadAt: 0,
  };
  return slot.__agenttraceChainCache;
}

export function chainCacheEnabled(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/** Key ties cached logs to one deployment, so a redeploy never replays another contract's logs. */
export function cacheKey(address: string, deployBlock: number): string {
  return `${address.toLowerCase()}@${deployBlock}`;
}

function toCached(log: Log): CachedLog | null {
  if (!log.address || log.blockNumber == null || log.logIndex == null || !log.transactionHash)
    return null;
  return {
    address: log.address.toLowerCase(),
    blockNumber: log.blockNumber.toString(),
    logIndex: Number(log.logIndex),
    transactionHash: log.transactionHash.toLowerCase(),
    data: log.data,
    topics: [...log.topics],
  };
}

function fromCached(log: CachedLog): Log {
  return {
    address: log.address as `0x${string}`,
    blockNumber: BigInt(log.blockNumber),
    logIndex: log.logIndex,
    transactionHash: log.transactionHash as `0x${string}`,
    data: log.data as `0x${string}`,
    topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    blockHash: null,
    transactionIndex: null,
    removed: false,
  } as unknown as Log;
}

function mergeRequests(a: OutcomeRequest[] = [], b: OutcomeRequest[] = []): OutcomeRequest[] {
  const seen = new Map<string, OutcomeRequest>();
  for (const r of [...a, ...b]) seen.set(`${r.executionId}:${JSON.stringify(r.expectation)}`, r);
  return [...seen.values()];
}

function sortLogs(logs: CachedLog[]): CachedLog[] {
  return logs.sort((a, b) => {
    const d = BigInt(a.blockNumber) - BigInt(b.blockNumber);
    return d === 0n ? a.logIndex - b.logIndex : d < 0n ? -1 : 1;
  });
}

function mergeEntry(a: ContractEntry | undefined, b: ContractEntry | undefined): ContractEntry {
  const seen = new Map<string, CachedLog>();
  for (const log of [...(a?.logs ?? []), ...(b?.logs ?? [])])
    seen.set(`${log.transactionHash}:${log.logIndex}`, log);
  return {
    // Every writer scans contiguously from a cursor no later than the stored one, so the union of
    // logs covers everything up to the larger cursor.
    scannedTo: Math.max(a?.scannedTo ?? -1, b?.scannedTo ?? -1),
    logs: sortLogs([...seen.values()]),
  };
}

async function readRemote(): Promise<CacheDoc | null> {
  const { get } = await import("@vercel/blob");
  try {
    const result = await get(PATHNAME, { access: "private", useCache: false });
    if (!result || !result.stream) return null;
    const text = await new Response(result.stream).text();
    const doc = JSON.parse(text) as CacheDoc;
    if (
      doc?.version !== 1 ||
      doc.chainId !== MONAD_TESTNET.chainId ||
      typeof doc.contracts !== "object"
    )
      return null;
    return doc;
  } catch (err) {
    console.warn("[chain-cache] read failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Replay cached logs into a fresh database, once per contract per process. Contracts are applied
 * in the given order (registry before firewall), and only when this database has no cursor yet.
 */
export async function hydrateFromCache(
  sql: Sql,
  contracts: Array<{ key: string; address: string; apply: (log: Log) => Promise<unknown> }>,
): Promise<void> {
  if (!chainCacheEnabled()) return;
  const s = state();
  for (const c of contracts) {
    s.hydrated[c.key] ??= (async () => {
      s.doc ??= readRemote();
      const doc = await s.doc;
      const entry = doc?.contracts[c.key];
      if (!entry) return;
      s.flushedTo[c.key] = entry.scannedTo;
      s.pending[c.key] = mergeEntry(s.pending[c.key], entry);
      const cursor = await sql<{ last_scanned_block: number | string }>`
        select last_scanned_block from indexer_state
        where chain_id = ${MONAD_TESTNET.chainId} and contract_address = ${c.address}
      `;
      if (cursor.length) return;
      for (const log of entry.logs) await c.apply(fromCached(log));
      await sql`
        insert into indexer_state (chain_id, contract_address, last_scanned_block, updated_at)
        values (${MONAD_TESTNET.chainId}, ${c.address}, ${entry.scannedTo}, now())
        on conflict (chain_id, contract_address) do update set
          last_scanned_block = greatest(indexer_state.last_scanned_block, excluded.last_scanned_block),
          updated_at = now()
      `;
    })().catch((err) => {
      console.warn("[chain-cache] hydrate failed:", err instanceof Error ? err.message : err);
      delete s.hydrated[c.key];
      s.doc = undefined;
    });
    await s.hydrated[c.key];
  }
}

/** Remember what a scan read. Flushes to Blob when new logs arrived or the cursor moved far enough. */
export async function recordScan(key: string, logs: Log[], scannedTo: number): Promise<void> {
  if (!chainCacheEnabled()) return;
  const s = state();
  const fresh = logs.map(toCached).filter((l): l is CachedLog => l !== null);
  const before = s.pending[key]?.logs.length ?? 0;
  s.pending[key] = mergeEntry(s.pending[key], { scannedTo, logs: fresh });
  if (s.pending[key].logs.length > before) s.dirty = true;
  const moved = scannedTo - (s.flushedTo[key] ?? -1) >= FLUSH_BLOCK_STEP;
  if (!s.dirty && !(moved && Date.now() - s.lastFlushAt >= FLUSH_MIN_INTERVAL_MS)) return;
  await flush();
}

async function flush(): Promise<void> {
  const s = state();
  try {
    const { put } = await import("@vercel/blob");
    const remote = await readRemote();
    const contracts: Record<string, ContractEntry> = { ...(remote?.contracts ?? {}) };
    for (const [key, entry] of Object.entries(s.pending))
      contracts[key] = mergeEntry(contracts[key], entry);
    const outcomeRequests = mergeRequests(remote?.outcomeRequests, s.requests);
    const kv = mergeKv(remote?.kv, s.kv);
    const doc: CacheDoc = { version: 1, chainId: MONAD_TESTNET.chainId, contracts, outcomeRequests, kv };
    await put(PATHNAME, JSON.stringify(doc), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: "application/json",
      cacheControlMaxAge: 60,
    });
    for (const [key, entry] of Object.entries(contracts)) {
      s.flushedTo[key] = entry.scannedTo;
      s.pending[key] = entry;
    }
    s.requests = outcomeRequests;
    s.kv = kv;
    s.dirty = false;
    s.lastFlushAt = Date.now();
  } catch (err) {
    console.warn("[chain-cache] write failed:", err instanceof Error ? err.message : err);
  }
}

/** Remember that an outcome check was requested, so other instances can recompute it. */
export async function recordOutcomeRequest(request: OutcomeRequest): Promise<void> {
  if (!chainCacheEnabled()) return;
  const s = state();
  const before = s.requests.length;
  s.requests = mergeRequests(s.requests, [request]);
  if (s.requests.length > before) await flush();
}

/** Outcome checks requested on any instance (refreshed from the blob at most once a minute). */
export async function cachedOutcomeRequests(): Promise<OutcomeRequest[]> {
  if (!chainCacheEnabled()) return [];
  const s = state();
  // Other instances add requests over time; re-read the blob at most once a minute.
  if (Date.now() - s.requestsReadAt >= 60_000) {
    s.requestsReadAt = Date.now();
    const remote = await readRemote();
    s.requests = mergeRequests(remote?.outcomeRequests, s.requests);
  }
  return s.requests;
}

/**
 * Logs cached for one contract key, including ones other instances wrote (re-read from the blob
 * at most once a minute). Used for logs that are recorded when they are produced rather than
 * scanned, such as the proof anchor events.
 */
export async function cachedContractLogs(key: string): Promise<Log[]> {
  if (!chainCacheEnabled()) return [];
  const s = state();
  s.logsReadAt ??= {};
  if (Date.now() - (s.logsReadAt[key] ?? 0) >= 60_000) {
    s.logsReadAt[key] = Date.now();
    const remote = await readRemote();
    const entry = remote?.contracts[key];
    if (entry) s.pending[key] = mergeEntry(s.pending[key], entry);
  }
  return (s.pending[key]?.logs ?? []).map(fromCached);
}

function mergeKv(
  a: Record<string, Record<string, string>> = {},
  b: Record<string, Record<string, string>> = {},
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) out[name] = { ...(a[name] ?? {}), ...(b[name] ?? {}) };
  return out;
}

/** Read one public string map shared by all instances (re-read from the blob at most once a minute). */
export async function cachedKv(name: string): Promise<Record<string, string>> {
  if (!chainCacheEnabled()) return state().kv?.[name] ?? {};
  const s = state();
  if (Date.now() - (s.kvReadAt ?? 0) >= 60_000) {
    s.kvReadAt = Date.now();
    const remote = await readRemote();
    s.kv = mergeKv(remote?.kv, s.kv);
  }
  return s.kv?.[name] ?? {};
}

/** Record one public value (an id or a transaction hash). Flushes to the blob. */
export async function recordKv(name: string, key: string, value: string): Promise<void> {
  const s = state();
  s.kv = mergeKv(s.kv, { [name]: { [key]: value } });
  if (!chainCacheEnabled()) return;
  await flush();
}
