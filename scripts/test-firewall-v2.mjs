// AgentFirewallV2 argument caps: deposit(agentId, amount) with amount capped onchain.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createVM } from "@ethereumjs/vm";
import { createEmptyBlock } from "@ethereumjs/block";
import { bytesToHex, createAccount, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import { decodeErrorResult, decodeEventLog, decodeFunctionResult, encodeDeployData, encodeFunctionData, toFunctionSelector } from "viem";

const root = join(import.meta.dirname, "..");
const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8"));
const registryArt = art("AgentRegistry");
const fwArt = art("AgentFirewallV2");
const demoArt = art("DemoProtocol");
const v1Abi = art("AgentFirewall").abi;
const fwAbi = fwArt.abi;

// V2 is a strict superset of the V1 ABI, and AgentAction is byte-identical.
const sig = (i) => `${i.type}:${i.name}(${(i.inputs ?? []).map((x) => `${x.type}${x.indexed ? " indexed" : ""}`).join(",")})`;
const v2Sigs = new Set(fwAbi.map(sig));
for (const item of v1Abi) assert.ok(v2Sigs.has(sig(item)), `V2 missing ${sig(item)}`);
for (const fn of ["setArgCap", "clearArgCap", "getArgCap"]) assert.ok(fwAbi.some((i) => i.name === fn), fn);

const vm = await createVM();
const [alice, bob, exec] = ["01", "02", "03"].map((n) => createAddressFromString(`0x${"00".repeat(19)}${n}`));
for (const a of [alice, bob, exec]) await vm.stateManager.putAccount(a, createAccount({ balance: 10n ** 18n }));
const block = () => createEmptyBlock({ timestamp: 1_000n, gasLimit: 30_000_000n }, { common: vm.common });
async function deploy(data) {
  const r = await vm.evm.runCall({ caller: alice, data: hexToBytes(data), gasLimit: 15_000_000n, block: block() });
  assert.equal(r.execResult.exceptionError, undefined, "deploy reverted");
  return r.createdAddress;
}
const call = (from, to, abi, functionName, args = []) =>
  vm.evm.runCall({ caller: from, to, data: hexToBytes(encodeFunctionData({ abi, functionName, args })), gasLimit: 8_000_000n, block: block() });
const ok = (r, abi, name) => {
  assert.equal(r.execResult.exceptionError, undefined, `${name} reverted`);
  return decodeFunctionResult({ abi, functionName: name, data: bytesToHex(r.execResult.returnValue) });
};
const err = (r, abi = fwAbi) => {
  assert.ok(r.execResult.exceptionError, "expected revert");
  return decodeErrorResult({ abi, data: bytesToHex(r.execResult.returnValue) });
};
const events = (r) =>
  (r.execResult.logs ?? []).flatMap((l) => {
    try { return [decodeEventLog({ abi: fwAbi, topics: l[1].map(bytesToHex), data: bytesToHex(l[2]) })]; } catch { return []; }
  });

const registry = await deploy(registryArt.bytecode);
const fw = await deploy(encodeDeployData({ abi: fwAbi, bytecode: fwArt.bytecode, args: [bytesToHex(registry.bytes)] }));
const demo = await deploy(demoArt.bytecode);
const demoAddr = bytesToHex(demo.bytes);
const deposit = toFunctionSelector("deposit(uint256,uint256)");
const swap = toFunctionSelector("swap(uint256,uint256,uint256)");

ok(await call(alice, registry, registryArt.abi, "registerAgent", ["Capped", "Arg caps.", "", 1n]), registryArt.abi, "registerAgent");
ok(await call(alice, fw, fwAbi, "createFirewall", [1n, bytesToHex(exec.bytes), false, 0n, 0n, 86_400n]), fwAbi, "createFirewall");
ok(await call(alice, fw, fwAbi, "allowTarget", [1n, demoAddr, "Demo"]), fwAbi, "allowTarget");

// Cap on a function that is not allowed is rejected.
assert.equal(err(await call(alice, fw, fwAbi, "setArgCap", [1n, demoAddr, deposit, 1, 100n])).errorName, "FunctionNotAllowed");
ok(await call(alice, fw, fwAbi, "allowFunction", [1n, demoAddr, deposit]), fwAbi, "allowFunction");
ok(await call(alice, fw, fwAbi, "allowFunction", [1n, demoAddr, swap]), fwAbi, "allowFunction");
// Only the registry owner can set or clear caps.
assert.equal(err(await call(bob, fw, fwAbi, "setArgCap", [1n, demoAddr, deposit, 1, 100n])).errorName, "UnauthorizedOwner");
assert.equal(err(await call(alice, fw, fwAbi, "clearArgCap", [1n, demoAddr, deposit])).errorName, "ArgCapNotSet");

const setR = await call(alice, fw, fwAbi, "setArgCap", [1n, demoAddr, deposit, 1, 100n]);
assert.equal(setR.execResult.exceptionError, undefined);
const setEv = events(setR)[0];
assert.equal(setEv.eventName, "ArgCapSet");
assert.equal(setEv.args.argIndex, 1);
assert.equal(setEv.args.maxValue, 100n);
const cap = ok(await call(alice, fw, fwAbi, "getArgCap", [1n, demoAddr, deposit]), fwAbi, "getArgCap");
assert.deepEqual([cap.enabled, cap.argIndex, cap.maxValue], [true, 1, 100n]);

const dep = (amount) => encodeFunctionData({ abi: demoArt.abi, functionName: "deposit", args: [1n, amount] });
const exe = (data, from = exec) => call(from, fw, fwAbi, "execute", [1n, demoAddr, 0n, data]);

// At the cap: allowed, and AgentAction is emitted as in V1.
const atCap = await exe(dep(100n));
assert.equal(atCap.execResult.exceptionError, undefined, "deposit 100 should pass");
assert.ok(events(atCap).some((e) => e.eventName === "AgentAction" && e.args.executionNonce === 0n));
// Above the cap: rejected with the exact values, nothing executes, nonce unchanged.
const over = err(await exe(dep(101n)));
assert.equal(over.errorName, "ArgumentTooHigh");
assert.deepEqual(over.args, [1n, deposit, 1, 101n, 100n]);
const huge = err(await exe(dep(2n ** 255n)));
assert.equal(huge.errorName, "ArgumentTooHigh");
assert.equal(ok(await call(alice, fw, fwAbi, "getFirewall", [1n]), fwAbi, "getFirewall").executionNonce, 1n);
// Truncated calldata cannot skip the check.
assert.equal(err(await exe(dep(5n).slice(0, 10 + 64 + 10))).errorName, "ArgumentMissing");
// Other selectors are not affected by a deposit cap.
const sw = await exe(encodeFunctionData({ abi: demoArt.abi, functionName: "swap", args: [1n, 50n, 1000n] }));
assert.equal(sw.execResult.exceptionError, undefined, "swap uncapped should pass");
// Cap index 0 (agentId) works too.
ok(await call(alice, fw, fwAbi, "setArgCap", [1n, demoAddr, deposit, 0, 0n]), fwAbi, "setArgCap");
assert.equal(err(await exe(dep(1n))).errorName, "ArgumentTooHigh");
// Clearing restores V1 behaviour.
const cleared = await call(alice, fw, fwAbi, "clearArgCap", [1n, demoAddr, deposit]);
assert.equal(events(cleared)[0].eventName, "ArgCapCleared");
assert.equal((await exe(dep(10_000n))).execResult.exceptionError, undefined, "uncapped deposit should pass");
// Non-executor still blocked before any cap logic.
assert.equal(err(await exe(dep(1n), bob)).errorName, "UnauthorizedExecutor");
assert.equal(ok(await call(alice, fw, fwAbi, "getFirewall", [1n]), fwAbi, "getFirewall").executionNonce, 3n);
console.log("firewall v2 arg-cap tests ok");

// The committed artifact must be the compiled source (no drift between .sol and out/).
{
  const solc = (await import("solc")).default;
  const src = readFileSync(join(root, "contracts/AgentFirewallV2.sol"), "utf8");
  const out = JSON.parse(solc.compile(JSON.stringify({
    language: "Solidity",
    sources: { "AgentFirewallV2.sol": { content: src } },
    settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { "*": { "*": ["evm.bytecode.object"] } } },
  })));
  assert.equal(`0x${out.contracts["AgentFirewallV2.sol"].AgentFirewallV2.evm.bytecode.object}`, fwArt.bytecode, "run npm run compile:v2");
  console.log("firewall v2 artifact matches source");
}
