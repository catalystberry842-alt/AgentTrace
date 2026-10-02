import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createVM } from "@ethereumjs/vm";
import { createEmptyBlock } from "@ethereumjs/block";
import { bytesToHex, createAccount, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, toFunctionSelector } from "viem";

const root = join(import.meta.dirname, "..");
const source = readFileSync(join(root, "contracts/DemoProtocol.sol"), "utf8");
assert.equal(/\btx\.origin\b/.test(source), false);
assert.equal(/\bdelegatecall\b/.test(source), false);

const registryArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentRegistry.json"), "utf8"));
const firewallArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewall.json"), "utf8"));
const demoArtifact = JSON.parse(readFileSync(join(root, "contracts/out/DemoProtocol.json"), "utf8"));
const depositSelector = toFunctionSelector("deposit(uint256,uint256)");
const swapSelector = toFunctionSelector("swap(uint256,uint256,uint256)");
const withdrawSelector = toFunctionSelector("withdraw(uint256,uint256)");
assert.notEqual(depositSelector, withdrawSelector);
assert.notEqual(depositSelector, swapSelector);
assert.notEqual(swapSelector, withdrawSelector);

const vm = await createVM();
const alice = createAddressFromString("0x0000000000000000000000000000000000000001");
await vm.stateManager.putAccount(alice, createAccount({ balance: 10n ** 18n }));

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

async function call(from, to, abi, name, args = []) {
  const data = encodeFunctionData({ abi, functionName: name, args });
  return vm.evm.runCall({
    caller: from,
    to,
    data: hexToBytes(data),
    gasLimit: 8_000_000n,
    block: createEmptyBlock({ timestamp: 1_000n, gasLimit: 30_000_000n }, { common: vm.common }),
  });
}

function reverted(result, abi) {
  assert.ok(result.execResult.exceptionError, "expected revert");
  const data = bytesToHex(result.execResult.returnValue ?? new Uint8Array());
  return decodeErrorResult({ abi, data }).errorName;
}

function events(result, abi) {
  return (result.execResult.logs ?? []).flatMap((log) => {
    try {
      return [decodeEventLog({ abi, data: bytesToHex(log[2]), topics: log[1].map((topic) => bytesToHex(topic)) })];
    } catch {
      return [];
    }
  });
}

const registry = await deploy(alice, registryArtifact.bytecode);
const firewall = await deploy(
  alice,
  encodeDeployData({
    abi: firewallArtifact.abi,
    bytecode: firewallArtifact.bytecode,
    args: [bytesToHex(registry.bytes)],
  }),
);
const demo = await deploy(alice, demoArtifact.bytecode);
const aliceAddr = bytesToHex(alice.bytes);
const demoAddr = bytesToHex(demo.bytes);
const research = (1n << 4n) | (1n << 5n);

const registered = await call(alice, registry, registryArtifact.abi, "registerAgent", ["Research Agent", "An example AI agent operating through AgentTrace.", "", research]);
assert.equal(decodeFunctionResult({ abi: registryArtifact.abi, functionName: "registerAgent", data: bytesToHex(registered.execResult.returnValue) }), 1n);

const created = await call(alice, firewall, firewallArtifact.abi, "createFirewall", [1n, aliceAddr, false, 0n, 0n, 86_400n]);
assert.equal(created.execResult.exceptionError, undefined);
const allowedTarget = await call(alice, firewall, firewallArtifact.abi, "allowTarget", [1n, demoAddr, "AgentTrace Demo Protocol"]);
assert.equal(allowedTarget.execResult.exceptionError, undefined);
const allowedFn = await call(alice, firewall, firewallArtifact.abi, "allowFunction", [1n, demoAddr, depositSelector]);
assert.equal(allowedFn.execResult.exceptionError, undefined);

const depositData = encodeFunctionData({ abi: demoArtifact.abi, functionName: "deposit", args: [1n, 100n] });
const executed = await call(alice, firewall, firewallArtifact.abi, "execute", [1n, demoAddr, 0n, depositData]);
assert.equal(executed.execResult.exceptionError, undefined, "deposit should pass the firewall");
const firewallEvents = events(executed, firewallArtifact.abi).map((item) => item.eventName);
const demoEvents = events(executed, demoArtifact.abi);
assert.equal(firewallEvents.includes("AgentAction"), true);
assert.equal(demoEvents.some((item) => item.eventName === "Deposited" && item.args.amount === 100n && item.args.agentId === 1n), true);

const withdrawData = encodeFunctionData({ abi: demoArtifact.abi, functionName: "withdraw", args: [1n, 100n] });
const blocked = await call(alice, firewall, firewallArtifact.abi, "execute", [1n, demoAddr, 0n, withdrawData]);
assert.equal(reverted(blocked, firewallArtifact.abi), "FunctionNotAllowed");
assert.equal(events(blocked, firewallArtifact.abi).some((item) => item.eventName === "AgentAction"), false);

const swapData = encodeFunctionData({ abi: demoArtifact.abi, functionName: "swap", args: [1n, 40n, 7n] });
const blockedSwap = await call(alice, firewall, firewallArtifact.abi, "execute", [1n, demoAddr, 0n, swapData]);
assert.equal(reverted(blockedSwap, firewallArtifact.abi), "FunctionNotAllowed");
assert.equal(events(blockedSwap, firewallArtifact.abi).some((item) => item.eventName === "AgentAction"), false);

const swapped = await call(alice, demo, demoArtifact.abi, "swap", [1n, 40n, 7n]);
assert.equal(swapped.execResult.exceptionError, undefined, "direct demo swap");
assert.equal(events(swapped, demoArtifact.abi).some((item) => item.eventName === "Swapped" && item.args.amountIn === 40n && item.args.amountOut === 7n), true);
const depositsLeft = await call(alice, demo, demoArtifact.abi, "deposits", [1n]);
const swappedBal = await call(alice, demo, demoArtifact.abi, "swapped", [1n]);
assert.equal(decodeFunctionResult({ abi: demoArtifact.abi, functionName: "deposits", data: bytesToHex(depositsLeft.execResult.returnValue) }), 60n);
assert.equal(decodeFunctionResult({ abi: demoArtifact.abi, functionName: "swapped", data: bytesToHex(swappedBal.execResult.returnValue) }), 7n);

console.log("demo protocol tests ok");
