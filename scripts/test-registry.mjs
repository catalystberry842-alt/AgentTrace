import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { createVM } from "@ethereumjs/vm";
import { bytesToHex, createAccount, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeFunctionData } from "viem";
import { encodeCapabilities, decodeCapabilities } from "../src/lib/agents/capabilities.ts";
import { parseCreateInput } from "../src/lib/agents/validate.ts";

const artifact = JSON.parse(
  readFileSync(join(import.meta.dirname, "../contracts/out/AgentRegistry.json"), "utf8"),
);
const abi = artifact.abi;
const fns = new Set(abi.filter((item) => item.type === "function").map((item) => item.name));
for (const name of ["registerAgent", "updateAgentMetadata", "deactivateAgent", "getAgent", "getAgentCount"]) {
  assert.ok(fns.has(name), name);
}
assert.equal(fns.has("upgrade"), false);
assert.equal([...fns].some((name) => /admin|ownerSet|setOwner/i.test(name)), false);

assert.equal(encodeCapabilities(["Trading", "Research"]), (1n << 0n) | (1n << 4n));
assert.deepEqual(decodeCapabilities((1n << 2n) | (1n << 1n)), ["Yield", "DeFi"]);
const good = parseCreateInput({
  name: "Trace",
  description: "Records what an agent did.",
  capabilities: ["Research", "Research", "Data"],
  metadataURI: "ipfs://cid",
});
assert.equal(good.ok, true);
assert.equal(parseCreateInput({ name: "", description: "x", capabilities: ["Trading"], metadataURI: "" }).ok, false);

const vm = await createVM();
const alice = createAddressFromString("0x0000000000000000000000000000000000000001");
const bob = createAddressFromString("0x0000000000000000000000000000000000000002");
await vm.stateManager.putAccount(alice, createAccount({ balance: 10n ** 18n }));
await vm.stateManager.putAccount(bob, createAccount({ balance: 10n ** 18n }));
const deployed = await vm.evm.runCall({
  caller: alice,
  data: hexToBytes(artifact.bytecode),
  gasLimit: 12_000_000n,
});
assert.equal(deployed.execResult.exceptionError, undefined);
const registry = deployed.createdAddress;

async function call(from, name, args = []) {
  const data = encodeFunctionData({ abi, functionName: name, args });
  return vm.evm.runCall({
    caller: from,
    to: registry,
    data: hexToBytes(data),
    gasLimit: 8_000_000n,
  });
}

function returned(result, name) {
  assert.equal(result.execResult.exceptionError, undefined, `${name} reverted`);
  return decodeFunctionResult({
    abi,
    functionName: name,
    data: bytesToHex(result.execResult.returnValue),
  });
}

function reverted(result) {
  assert.ok(result.execResult.exceptionError, "expected revert");
  const data = bytesToHex(result.execResult.returnValue ?? new Uint8Array());
  if (data.length > 2) {
    try {
      return decodeErrorResult({ abi, data }).errorName;
    } catch {
      return "revert";
    }
  }
  return "revert";
}

function eventOf(result) {
  const log = result.execResult.logs[0];
  const [, topics, data] = log;
  return decodeEventLog({
    abi,
    data: bytesToHex(data),
    topics: topics.map((topic) => bytesToHex(topic)),
  });
}

const tradingResearch = encodeCapabilities(["Trading", "Research"]);
const first = await call(alice, "registerAgent", ["Trace", "Records actions.", "ipfs://cid", tradingResearch]);
assert.equal(first.execResult.exceptionError, undefined);
assert.equal(returned(first, "registerAgent"), 1n);
const registered = eventOf(first);
assert.equal(registered.eventName, "AgentRegistered");
assert.equal(registered.args.agentId, 1n);
assert.equal(registered.args.name, "Trace");
assert.deepEqual(decodeCapabilities(registered.args.capabilities), ["Trading", "Research"]);

const second = await call(alice, "registerAgent", ["Ledger", "Pays.", "", encodeCapabilities(["Payments"])]);
assert.equal(returned(second, "registerAgent"), 2n);
const third = await call(bob, "registerAgent", ["Scout", "Looks.", "", encodeCapabilities(["Data"])]);
assert.equal(returned(third, "registerAgent"), 3n);
assert.equal(returned(await call(alice, "getAgentCount"), "getAgentCount"), 3n);

const owned = returned(await call(alice, "getAgentsByOwner", [bytesToHex(alice.bytes)]), "getAgentsByOwner");
assert.deepEqual(owned.map((id) => id.toString()), ["1", "2"]);
assert.equal(returned(await call(alice, "agentExists", [1n]), "agentExists"), true);
assert.equal(returned(await call(alice, "agentExists", [0n]), "agentExists"), false);
assert.equal(returned(await call(alice, "agentExists", [99n]), "agentExists"), false);
assert.equal(
  returned(await call(alice, "getAgentOwner", [2n]), "getAgentOwner").toLowerCase(),
  bytesToHex(alice.bytes),
);

assert.equal(reverted(await call(bob, "updateAgentMetadata", [1n, "Hijack", "no", "", tradingResearch])), "NotOwner");
assert.equal(reverted(await call(alice, "registerAgent", ["", "x", "", tradingResearch])), "EmptyName");
assert.equal(
  reverted(await call(alice, "registerAgent", ["n".repeat(65), "x", "", tradingResearch])),
  "NameTooLong",
);
assert.equal(reverted(await call(alice, "registerAgent", ["Ok", "x", "", 0n])), "InvalidCapabilities");
assert.equal(reverted(await call(alice, "registerAgent", ["Ok", "x", "", 1n << 9n])), "InvalidCapabilities");

const updated = await call(alice, "updateAgentMetadata", [1n, "Trace Two", "Updated.", "ipfs://cid", encodeCapabilities(["DeFi", "Yield"])]);
assert.equal(updated.execResult.exceptionError, undefined);
const updatedEvent = eventOf(updated);
assert.equal(updatedEvent.eventName, "AgentUpdated");
assert.equal(updatedEvent.args.name, "Trace Two");
const agent = returned(await call(alice, "getAgent", [1n]), "getAgent");
assert.equal(agent.name, "Trace Two");
assert.equal(agent.active, true);
assert.deepEqual(decodeCapabilities(agent.capabilities), ["Yield", "DeFi"]);

const deactivated = await call(alice, "deactivateAgent", [1n]);
assert.equal(eventOf(deactivated).eventName, "AgentDeactivated");
assert.equal(returned(await call(alice, "getAgent", [1n]), "getAgent").active, false);
assert.equal(reverted(await call(alice, "updateAgentMetadata", [1n, "Nope", "x", "", tradingResearch])), "InactiveAgent");
assert.equal(reverted(await call(alice, "deactivateAgent", [1n])), "InactiveAgent");
assert.equal(returned(await call(alice, "getAgentCount"), "getAgentCount"), 3n);
assert.equal(returned(await call(alice, "agentExists", [1n]), "agentExists"), true);

// Live check: at least one public Monad testnet endpoint answers with chain id 10143.
let liveChainId = null;
for (const url of ["https://testnet-rpc.monad.xyz", "https://rpc-testnet.monadinfra.com", "https://rpc.ankr.com/monad_testnet"]) {
  try {
    const rpc = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    liveChainId = (await rpc.json()).result;
    break;
  } catch {
    // try the next public endpoint
  }
}
assert.equal(liveChainId, "0x279f");

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  const indexer = await vite.ssrLoadModule("/src/lib/chain/indexer.server.ts");
  const sql = await db.getSql();
  const registryAddress = bytesToHex(registry.bytes);
  const tx = `0x${"ab".repeat(32)}`;
  const log = first.execResult.logs[0];
  await indexer.applyRegistryLog(sql, registryAddress, {
    address: registryAddress,
    topics: log[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(log[2]),
    blockNumber: 12n,
    logIndex: 0,
    transactionHash: tx,
  });
  await indexer.applyRegistryLog(sql, registryAddress, {
    address: registryAddress,
    topics: log[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(log[2]),
    blockNumber: 12n,
    logIndex: 0,
    transactionHash: tx,
  });
  const rows = await sql`
    select agent_id, name, active, capability_bits, tx_hash,
           (select count(*) from indexed_events) as events
    from indexed_agents
    where agent_id = '1'
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Trace");
  assert.equal(rows[0].active, true);
  assert.equal(rows[0].capability_bits, tradingResearch.toString());
  assert.equal(String(rows[0].tx_hash), tx);
  assert.equal(Number(rows[0].events), 1);

  const updateLog = updated.execResult.logs[0];
  const updateTx = `0x${"cd".repeat(32)}`;
  await indexer.applyRegistryLog(sql, registryAddress, {
    address: registryAddress,
    topics: updateLog[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(updateLog[2]),
    blockNumber: 13n,
    logIndex: 1,
    transactionHash: updateTx,
  });
  const afterUpdate = await sql`select name, last_update_tx_hash, tx_hash from indexed_agents where agent_id = '1'`;
  assert.equal(afterUpdate[0].name, "Trace Two");
  assert.equal(afterUpdate[0].last_update_tx_hash, updateTx);
  assert.equal(afterUpdate[0].tx_hash, tx);

  const deactivateLog = deactivated.execResult.logs[0];
  const deactivateTx = `0x${"ef".repeat(32)}`;
  await indexer.applyRegistryLog(sql, registryAddress, {
    address: registryAddress,
    topics: deactivateLog[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(deactivateLog[2]),
    blockNumber: 14n,
    logIndex: 2,
    transactionHash: deactivateTx,
  });
  await indexer.applyRegistryLog(sql, registryAddress, {
    address: registryAddress,
    topics: deactivateLog[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(deactivateLog[2]),
    blockNumber: 14n,
    logIndex: 2,
    transactionHash: deactivateTx,
  });
  const after = await sql`
    select active, deactivation_tx_hash, (select count(*)::int as n from indexed_events) as events
    from indexed_agents where agent_id = '1'
  `;
  assert.equal(after[0].active, false);
  assert.equal(after[0].deactivation_tx_hash, deactivateTx);
  assert.equal(Number(after[0].events), 3);
} finally {
  await vite.close();
}

console.log("registry tests ok");
