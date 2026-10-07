import { test } from "node:test";
import assert from "node:assert/strict";
import { computeProofHash } from "./verify-proof.mjs";

test("verify-proof.mjs hashes exactly like the app's proof-hash.ts", async () => {
  const app = await import("../src/lib/chain/proof-hash.ts");
  const f = {
    chainId: 143n, agentId: 1n, firewallId: 1n,
    executionId: `0x${"11".repeat(32)}`, executor: "0x4f3f999B60750cEf97D7D56c75f30F050A583D53",
    transactionHash: `0x${"22".repeat(32)}`, blockNumber: 110871715n,
    target: "0x1664be58ee54af91c756428f466bad6e4f9911c3", functionSelector: "0xe2bbb158", value: 0n,
    calldataHash: `0x${"33".repeat(32)}`,
  };
  assert.equal(computeProofHash(f), app.computeProofHash(f));
  assert.notEqual(computeProofHash({ ...f, chainId: 10143n }), app.computeProofHash(f));
});
