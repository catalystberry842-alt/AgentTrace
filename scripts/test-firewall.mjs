import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createServer } from "vite";
import solc from "solc";
import { createVM } from "@ethereumjs/vm";
import { createEmptyBlock } from "@ethereumjs/block";
import { bytesToHex, createAccount, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  keccak256,
  toFunctionSelector,
} from "viem";

const root = join(import.meta.dirname, "..");
const registryArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentRegistry.json"), "utf8"));
const firewallArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewall.json"), "utf8"));
const registryAbi = registryArtifact.abi;
const firewallAbi = firewallArtifact.abi;
const source = readFileSync(join(root, "contracts/AgentFirewall.sol"), "utf8");
assert.equal(/\btx\.origin\b/.test(source), false);
assert.equal(/\bdelegatecall\b/.test(source), false);
assert.equal(firewallAbi.some((item) => item.type === "function" && /upgrade|admin/i.test(item.name)), false);

const echoInput = {
  language: "Solidity",
  sources: {
    "Echo.sol": {
      content: `pragma solidity 0.8.31;
contract Echo {
    function ping() external payable returns (uint256) { return msg.value; }
    function fail() external pure { revert("no"); }
}`,
    },
  },
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};
const echoOut = JSON.parse(solc.compile(JSON.stringify(echoInput)));
const echoCompiled = echoOut.contracts["Echo.sol"].Echo;
const echoAbi = echoCompiled.abi;
const pingSelector = toFunctionSelector("ping()");
const failSelector = toFunctionSelector("fail()");

const vm = await createVM();
const alice = createAddressFromString("0x0000000000000000000000000000000000000001");
const bob = createAddressFromString("0x0000000000000000000000000000000000000002");
const carol = createAddressFromString("0x0000000000000000000000000000000000000003");
for (const account of [alice, bob, carol]) {
  await vm.stateManager.putAccount(account, createAccount({ balance: 10n ** 18n }));
}

async function deploy(from, data) {
  const result = await vm.evm.runCall({
    caller: from,
    data: hexToBytes(data),
    gasLimit: 15_000_000n,
    block: createEmptyBlock({ timestamp: 1_000n, gasLimit: 30_000_000n }, { common: vm.common }),
  });
  assert.equal(result.execResult.exceptionError, undefined, "deploy reverted");
  return result.createdAddress;
}

const registry = await deploy(alice, registryArtifact.bytecode);
const firewall = await deploy(
  alice,
  encodeDeployData({
    abi: firewallAbi,
    bytecode: firewallArtifact.bytecode,
    args: [bytesToHex(registry.bytes)],
  }),
);
const echo = await deploy(alice, `0x${echoCompiled.evm.bytecode.object}`);

async function call(from, to, abi, name, args = [], { value = 0n, timestamp = 1_000n } = {}) {
  const data = encodeFunctionData({ abi, functionName: name, args });
  return vm.evm.runCall({
    caller: from,
    to,
    data: hexToBytes(data),
    gasLimit: 8_000_000n,
    value,
    block: createEmptyBlock({ timestamp, gasLimit: 30_000_000n }, { common: vm.common }),
  });
}

function returned(result, abi, name) {
  assert.equal(result.execResult.exceptionError, undefined, `${name} reverted`);
  return decodeFunctionResult({
    abi,
    functionName: name,
    data: bytesToHex(result.execResult.returnValue),
  });
}

function reverted(result, abi) {
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

function eventsOf(result) {
  return (result.execResult.logs ?? []).map((log) => {
    const topics = log[1].map((topic) => bytesToHex(topic));
    const data = bytesToHex(log[2]);
    return decodeEventLog({ abi: firewallAbi, data, topics });
  });
}

const aliceAddr = bytesToHex(alice.bytes);
const bobAddr = bytesToHex(bob.bytes);
const echoAddr = bytesToHex(echo.bytes);
const trading = 1n;

const registered = await call(alice, registry, registryAbi, "registerAgent", ["Trace", "Records.", "", trading]);
assert.equal(returned(registered, registryAbi, "registerAgent"), 1n);
const bobAgent = await call(bob, registry, registryAbi, "registerAgent", ["Other", "Not yours.", "", trading]);
assert.equal(returned(bobAgent, registryAbi, "registerAgent"), 2n);
const doomed = await call(alice, registry, registryAbi, "registerAgent", ["Old", "Inactive.", "", trading]);
assert.equal(returned(doomed, registryAbi, "registerAgent"), 3n);
const doomedCall = await call(alice, registry, registryAbi, "deactivateAgent", [3n]);
assert.equal(doomedCall.execResult.exceptionError, undefined);

assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "createFirewall", [1n, bobAddr, false, 0n, 0n, 86_400n]), firewallAbi),
  "UnauthorizedOwner",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [2n, bobAddr, false, 0n, 0n, 86_400n]), firewallAbi),
  "UnauthorizedOwner",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [3n, bobAddr, false, 0n, 0n, 86_400n]), firewallAbi),
  "AgentInactive",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [99n, bobAddr, false, 0n, 0n, 86_400n]), firewallAbi),
  "AgentNotFound",
);
assert.equal(
  reverted(
    await call(alice, firewall, firewallAbi, "createFirewall", [1n, "0x0000000000000000000000000000000000000000", false, 0n, 0n, 86_400n]),
    firewallAbi,
  ),
  "InvalidExecutor",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [1n, bobAddr, false, 0n, 0n, 0n]), firewallAbi),
  "InvalidPeriod",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [1n, bobAddr, false, 1n, 0n, 86_400n]), firewallAbi),
  "InvalidPolicy",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "createFirewall", [1n, bobAddr, true, 0n, 0n, 86_400n]), firewallAbi),
  "InvalidPolicy",
);

const created = await call(alice, firewall, firewallAbi, "createFirewall", [1n, bobAddr, false, 0n, 0n, 100n], {
  timestamp: 1_000n,
});
assert.equal(returned(created, firewallAbi, "createFirewall"), 1n);
const createdEvent = eventsOf(created).find((event) => event.eventName === "FirewallCreated");
assert.ok(createdEvent);
assert.equal(createdEvent.args.agentId, 1n);
assert.equal(createdEvent.args.executor.toLowerCase(), bobAddr);
assert.equal(createdEvent.args.allowValueTransfer, false);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewallCount"), firewallAbi, "getFirewallCount"), 1n);

const fw = returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall");
assert.equal(fw.owner.toLowerCase(), aliceAddr);
assert.equal(fw.executor.toLowerCase(), bobAddr);
assert.equal(fw.active, true);
assert.equal(fw.paused, false);
assert.equal(fw.executionNonce, 0n);
const policy = returned(await call(alice, firewall, firewallAbi, "getPolicy", [1n]), firewallAbi, "getPolicy");
assert.equal(policy.allowValueTransfer, false);
assert.equal(policy.maxValuePerTransaction, 0n);
assert.equal(policy.maxValuePerPeriod, 0n);
assert.equal(policy.spentInPeriod, 0n);

const second = await call(alice, firewall, firewallAbi, "createFirewall", [1n, carol.bytes ? bytesToHex(carol.bytes) : carol, false, 0n, 0n, 100n]);
assert.equal(returned(second, firewallAbi, "createFirewall"), 2n);
const ids = returned(await call(alice, firewall, firewallAbi, "getFirewallsByAgent", [1n]), firewallAbi, "getFirewallsByAgent");
assert.deepEqual(ids.map((id) => id.toString()), ["1", "2"]);

assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "pauseFirewall", [1n]), firewallAbi),
  "UnauthorizedOwner",
);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "allowTarget", [1n, echoAddr, "Echo"]), firewallAbi),
  "UnauthorizedOwner",
);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "setExecutor", [1n, aliceAddr]), firewallAbi),
  "UnauthorizedOwner",
);

const pingData = encodeFunctionData({ abi: echoAbi, functionName: "ping", args: [] });
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "TargetNotAllowed",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "allowTarget", [1n, "0x0000000000000000000000000000000000000000", "no"]), firewallAbi),
  "InvalidTarget",
);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "allowTarget", [1n, echoAddr, "Echo"]))[0].eventName, "TargetAllowed");
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "FunctionNotAllowed",
);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, "0x1234"]), firewallAbi),
  "InvalidCalldata",
);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "allowFunction", [1n, echoAddr, pingSelector]))[0].eventName, "FunctionAllowed");
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "UnauthorizedExecutor",
);

const executed = await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData], { timestamp: 1_000n });
assert.equal(executed.execResult.exceptionError, undefined);
const action = eventsOf(executed).find((event) => event.eventName === "AgentAction");
assert.ok(action);
assert.equal(action.args.executionNonce, 0n);
assert.equal(action.args.value, 0n);
assert.equal(action.args.calldataHash, keccak256(pingData));
assert.equal(action.args.functionSelector.toLowerCase(), pingSelector.toLowerCase());
const expectedId = keccak256(
  encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "address" },
      { type: "uint256" },
      { type: "address" },
      { type: "bytes4" },
    ],
    [1n, 1n, bobAddr, 0n, echoAddr, pingSelector],
  ),
);
assert.equal(action.args.executionId, expectedId);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall").executionNonce, 1n);

const failData = encodeFunctionData({ abi: echoAbi, functionName: "fail", args: [] });
await call(alice, firewall, firewallAbi, "allowFunction", [1n, echoAddr, failSelector]);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 1n, pingData], { value: 1n, timestamp: 1_050n }), firewallAbi),
  "ValueTransferDisabled",
);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "updatePolicy", [1n, true, 10n, 12n, 100n], { timestamp: 1_100n }))[0].eventName, "PolicyUpdated");
const failed = await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 1n, failData], { value: 1n, timestamp: 1_100n });
assert.ok(failed.execResult.exceptionError);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall").executionNonce, 1n);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getPolicy", [1n]), firewallAbi, "getPolicy").spentInPeriod, 0n);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 11n, pingData], { value: 11n, timestamp: 1_100n }), firewallAbi),
  "TransactionValueTooHigh",
);
assert.equal(
  (await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 10n, pingData], { value: 10n, timestamp: 1_100n })).execResult.exceptionError,
  undefined,
);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getPolicy", [1n]), firewallAbi, "getPolicy").spentInPeriod, 10n);
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 5n, pingData], { value: 5n, timestamp: 1_120n }), firewallAbi),
  "SpendingLimitExceeded",
);
assert.equal(
  (await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 5n, pingData], { value: 5n, timestamp: 1_200n })).execResult.exceptionError,
  undefined,
);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getPolicy", [1n]), firewallAbi, "getPolicy").spentInPeriod, 5n);

assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "pauseFirewall", [1n]))[0].eventName, "FirewallPaused");
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "FirewallIsPaused",
);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "unpauseFirewall", [1n]))[0].eventName, "FirewallUnpaused");
assert.equal(
  (await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData], { timestamp: 1_260n })).execResult.exceptionError,
  undefined,
);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "disableTarget", [1n, echoAddr]))[0].eventName, "TargetDisabled");
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "TargetInactive",
);
await call(alice, firewall, firewallAbi, "allowTarget", [1n, echoAddr, "Echo"]);
assert.equal(eventsOf(await call(alice, firewall, firewallAbi, "deactivateFirewall", [1n]))[0].eventName, "FirewallDeactivated");
assert.equal(
  reverted(await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData]), firewallAbi),
  "FirewallInactive",
);
assert.equal(
  reverted(await call(alice, firewall, firewallAbi, "pauseFirewall", [1n]), firewallAbi),
  "FirewallInactive",
);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall").active, false);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewallCount"), firewallAbi, "getFirewallCount"), 2n);

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  const indexer = await vite.ssrLoadModule("/src/lib/chain/firewall.server.ts");
  const sql = await db.getSql();
  const firewallAddress = bytesToHex(firewall.bytes);
  const tx = `0x${"cd".repeat(32)}`;
  let index = 0;
  async function apply(result) {
    for (const log of result.execResult.logs ?? []) {
      const topics = log[1].map((topic) => bytesToHex(topic));
      const data = bytesToHex(log[2]);
      const address = log[0]?.bytes ? bytesToHex(log[0].bytes) : bytesToHex(log[0]);
      await indexer.applyFirewallLog(sql, firewallAddress, {
        address,
        topics,
        data,
        blockNumber: 20n,
        logIndex: index,
        transactionHash: tx,
      });
      index += 1;
    }
  }
  await apply(created);
  const createdLogs = index;
  index = 0;
  await apply(created);
  index = createdLogs;
  const rows = await sql`
    select firewall_id, agent_id, executor, allow_value_transfer, spent_in_period, execution_nonce,
           (select count(*) from indexed_events where event_name = 'FirewallCreated' and tx_hash = ${tx}) as events
    from indexed_firewalls
    where firewall_id = '1'
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].agent_id, "1");
  assert.equal(rows[0].executor, bobAddr);
  assert.equal(rows[0].allow_value_transfer, false);
  assert.equal(String(rows[0].events), "1");
  await apply(executed);
  const actionLogs = index;
  index = createdLogs;
  await apply(executed);
  index = actionLogs;
  const after = await sql`
    select spent_in_period, execution_nonce,
           (select count(*)::int from firewall_actions where firewall_id = '1') as actions
    from indexed_firewalls where firewall_id = '1'
  `;
  assert.equal(after[0].execution_nonce, "1");
  assert.equal(String(after[0].actions), "1");
  assert.equal(after[0].spent_in_period, "0");
} finally {
  await vite.close();
}

console.log("firewall tests ok");
