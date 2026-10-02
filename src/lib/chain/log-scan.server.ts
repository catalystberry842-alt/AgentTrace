import type { Log, PublicClient } from "viem";
import { logBlockRange } from "@/lib/chain/rpc.server";

/** Wall-clock budget for one sync call, so a page request never waits on a long catch-up. */
function scanBudgetMs(): number {
  const fromEnv = Number(process.env.MONAD_INDEXER_BUDGET_MS?.trim() ?? "");
  if (Number.isInteger(fromEnv) && fromEnv >= 500 && fromEnv <= 60_000) return fromEnv;
  return 4_000;
}

const CONCURRENCY = 4;

/**
 * Scan `address` logs from `from` to `latest` in RPC-sized block windows.
 * Windows are fetched a few at a time, applied strictly in block order, and the cursor is
 * saved after each window, so progress survives an interrupted request. Stops when the
 * time budget is spent and returns the last fully applied block (from - 1 if none).
 */
export async function scanLogs(opts: {
  client: Pick<PublicClient, "getLogs">;
  address: `0x${string}`;
  from: number;
  latest: number;
  apply: (log: Log) => Promise<unknown>;
  saveCursor: (scannedTo: number) => Promise<void>;
}): Promise<number> {
  const range = logBlockRange();
  const deadline = Date.now() + scanBudgetMs();
  let from = opts.from;
  let scannedTo = opts.from - 1;
  while (from <= opts.latest && Date.now() < deadline) {
    const windows: Array<[number, number]> = [];
    for (let i = 0; i < CONCURRENCY && from <= opts.latest; i++) {
      const to = Math.min(from + range - 1, opts.latest);
      windows.push([from, to]);
      from = to + 1;
    }
    const results = await Promise.all(
      windows.map(([a, b]) =>
        opts.client.getLogs({ address: opts.address, fromBlock: BigInt(a), toBlock: BigInt(b) }),
      ),
    );
    for (let i = 0; i < windows.length; i++) {
      for (const log of results[i]) await opts.apply(log);
      scannedTo = windows[i][1];
      await opts.saveCursor(scannedTo);
    }
  }
  return scannedTo;
}
