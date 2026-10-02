/**
 * Indexer log scanning: windows stay within the public RPC eth_getLogs limit (100 blocks),
 * logs are applied in block order, the cursor is saved per window, and a scan resumes.
 */
import assert from "node:assert/strict";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const { scanLogs } = await vite.ssrLoadModule("/src/lib/chain/log-scan.server.ts");
  const logAt = (n) => ({ blockNumber: BigInt(n), logIndex: 0, transactionHash: `0x${n.toString(16).padStart(64, "0")}` });
  const eventBlocks = [1_000, 1_099, 1_100, 1_250, 1_999, 2_000, 2_345];
  const calls = [];
  const client = {
    async getLogs({ fromBlock, toBlock }) {
      const from = Number(fromBlock);
      const to = Number(toBlock);
      calls.push([from, to]);
      if (to - from + 1 > 100) throw new Error("block range too large");
      return eventBlocks.filter((b) => b >= from && b <= to).map(logAt);
    },
  };
  const applied = [];
  const cursors = [];
  const last = await scanLogs({
    client,
    address: "0x0000000000000000000000000000000000000001",
    from: 1_000,
    latest: 2_345,
    apply: async (log) => applied.push(Number(log.blockNumber)),
    saveCursor: async (to) => cursors.push(to),
  });
  assert.equal(last, 2_345);
  assert.deepEqual(applied, eventBlocks);
  assert.ok(calls.every(([a, b]) => b - a + 1 <= 100), "every window is at most 100 blocks");
  assert.deepEqual(cursors, [...cursors].sort((a, b) => a - b), "cursor only moves forward");
  assert.equal(cursors.at(-1), 2_345);

  // Resume from a saved cursor applies nothing twice.
  applied.length = 0;
  const again = await scanLogs({
    client,
    address: "0x0000000000000000000000000000000000000001",
    from: 2_001,
    latest: 2_345,
    apply: async (log) => applied.push(Number(log.blockNumber)),
    saveCursor: async () => {},
  });
  assert.equal(again, 2_345);
  assert.deepEqual(applied, [2_345]);

  // An RPC error leaves the cursor at the last fully applied window.
  const saved = [];
  const failing = {
    async getLogs({ fromBlock }) {
      if (Number(fromBlock) >= 1_400) throw new Error("rpc down");
      return [];
    },
  };
  await assert.rejects(
    scanLogs({ client: failing, address: "0x0000000000000000000000000000000000000001", from: 1_000, latest: 5_000, apply: async () => {}, saveCursor: async (to) => saved.push(to) }),
    /rpc down/,
  );
  assert.ok(saved.every((to) => to < 1_400));
  console.log("log scan tests ok");
} finally {
  await vite.close();
}
