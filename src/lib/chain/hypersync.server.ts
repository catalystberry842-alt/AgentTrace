import type { Log } from "viem";
import { MONAD_TESTNET } from "@/lib/chain/network";

/**
 * Envio HyperSync as a log source. One HTTP query returns every log of a contract over a block
 * range (paged by `next_block`), instead of hundreds of 100-block eth_getLogs windows.
 * Used only when ENVIO_API_TOKEN is set (server-only); otherwise callers fall back to RPC.
 * HyperSync serves raw chain logs; every log is still decoded and applied by the same code as
 * RPC logs, and receipts for proofs are still read from Monad RPC.
 */
const HOSTS: Record<number, string> = {
  143: "https://monad.hypersync.xyz",
  10143: "https://monad-testnet.hypersync.xyz",
};

const FIELDS = [
  "block_number",
  "log_index",
  "transaction_index",
  "transaction_hash",
  "block_hash",
  "address",
  "data",
  "topic0",
  "topic1",
  "topic2",
  "topic3",
];

type RawLog = {
  block_number: number;
  log_index: number;
  transaction_index: number;
  transaction_hash: `0x${string}`;
  block_hash: `0x${string}`;
  address: `0x${string}`;
  data: `0x${string}`;
  topic0?: `0x${string}` | null;
  topic1?: `0x${string}` | null;
  topic2?: `0x${string}` | null;
  topic3?: `0x${string}` | null;
};

function token(): string | null {
  const value = process.env.ENVIO_API_TOKEN?.trim();
  return value ? value : null;
}

export function hypersyncEnabled(): boolean {
  return Boolean(token() && HOSTS[MONAD_TESTNET.chainId]);
}

function toLog(raw: RawLog): Log {
  const topics = [raw.topic0, raw.topic1, raw.topic2, raw.topic3].filter(
    (topic): topic is `0x${string}` => typeof topic === "string" && topic.length > 2,
  );
  return {
    address: raw.address.toLowerCase() as `0x${string}`,
    blockHash: raw.block_hash,
    blockNumber: BigInt(raw.block_number),
    data: raw.data,
    logIndex: raw.log_index,
    transactionHash: raw.transaction_hash,
    transactionIndex: raw.transaction_index,
    removed: false,
    topics: topics as [`0x${string}`, ...`0x${string}`[]],
  } as Log;
}

/**
 * One page of logs for `address` from `fromBlock` up to `toBlock` (inclusive).
 * Returns the logs in chain order and the last block the page fully covers.
 */
export async function hypersyncLogs(
  address: `0x${string}`,
  fromBlock: number,
  toBlock: number,
  timeoutMs = 8_000,
): Promise<{ logs: Log[]; coveredTo: number }> {
  const auth = token();
  const host = HOSTS[MONAD_TESTNET.chainId];
  if (!auth || !host) throw new Error("HyperSync is not configured.");
  const response = await fetch(`${host}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      from_block: fromBlock,
      to_block: toBlock + 1, // exclusive
      logs: [{ address: [address] }],
      field_selection: { log: FIELDS },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HyperSync responded ${response.status}.`);
  const body = (await response.json()) as {
    data?: Array<{ logs?: RawLog[] }>;
    next_block?: number;
    archive_height?: number;
  };
  const logs = (body.data ?? [])
    .flatMap((batch) => batch.logs ?? [])
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index)
    .map(toLog);
  const next = typeof body.next_block === "number" ? body.next_block : fromBlock;
  const coveredTo = Math.min(next - 1, toBlock);
  return { logs, coveredTo };
}

/**
 * Logs matching `address` and topic filters (null = any) from `fromBlock` to the archive head,
 * with block timestamps. For small event sets such as one agent's ERC-8004 history.
 */
export async function hypersyncQuery(opts: {
  address: `0x${string}`;
  topics: Array<`0x${string}` | null>;
  fromBlock?: number;
  timeoutMs?: number;
}): Promise<Array<Log & { timestamp: number | null }>> {
  const auth = token();
  const host = HOSTS[MONAD_TESTNET.chainId];
  if (!auth || !host) throw new Error("HyperSync is not configured.");
  const response = await fetch(`${host}/query`, {
    method: "POST",
    headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({
      from_block: opts.fromBlock ?? 0,
      logs: [{ address: [opts.address], topics: opts.topics.map((topic) => (topic ? [topic] : [])) }],
      field_selection: { log: FIELDS, block: ["number", "timestamp"] },
    }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 6_000),
  });
  if (!response.ok) throw new Error(`HyperSync responded ${response.status}.`);
  const body = (await response.json()) as {
    data?: Array<{ logs?: RawLog[]; blocks?: Array<{ number: number; timestamp: number | string }> }>;
  };
  const times = new Map<number, number>();
  for (const batch of body.data ?? []) {
    for (const block of batch.blocks ?? []) times.set(block.number, Number(block.timestamp));
  }
  return (body.data ?? [])
    .flatMap((batch) => batch.logs ?? [])
    .sort((a, b) => a.block_number - b.block_number || a.log_index - b.log_index)
    .map((raw) => ({ ...toLog(raw), timestamp: times.get(raw.block_number) ?? null }));
}
