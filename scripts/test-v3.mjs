// AgentFirewallV3 (per-agent vault, session executors, one-transaction setup) and
// AgentProofQuorum (multi-verifier anchoring, conflicts, challenges, revocation).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import solc from "solc";
import { createVM } from "@ethereumjs/vm";
import { createEmptyBlock } from "@ethereumjs/block";
import { bytesToHex, createAccount, createAddressFromString, hexToBytes } from "@ethereumjs/util";
import {
  decodeErrorResult,
  decodeEventLog,
  decodeFunctionResult,
  encodeDeployData,
  encodeFunctionData,
  getAddress,
  keccak256,
  toFunctionSelector,
} from "viem";

const root = join(import.meta.dirname, "..");
const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8"));
const registryArt = art("AgentRegistry");
const fwArt = art("AgentFirewallV3");
const vaultArt = art("AgentVault");
const quorumArt = art("AgentProofQuorum");
const fwAbi = fwArt.abi;
const qAbi = quorumArt.abi;

// A token-like target that credits msg.sender: the custody case the vault exists for.
const tokenSrc = `pragma solidity 0.8.31;
contract Token {
  mapping(address => uint256) public balanceOf;
  function claim(uint256 amount) external { balanceOf[msg.sender] += amount; }
  function transfer(address to, uint256 amount) external returns (bool) {
    require(balanceOf[msg.sender] >= amount, "balance");
    balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true;
  }
}`;
const tokenOut = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources: { "Token.sol": { content: tokenSrc } },
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
}))).contracts["Token.sol"].Token;
const tokenAbi = tokenOut.abi;

const vm = await createVM();
const [alice, bob, exec, session, v1, v2, v3] = ["01", "02", "03", "04", "05", "06", "07"].map((n) =>
  createAddressFromString(`0x${"00".repeat(19)}${n}`),
);
for (const a of [alice, bob, exec, v1, v2, v3]) await vm.stateManager.putAccount(a, createAccount({ balance: 10n ** 20n }));
let now = 1_000n;
const block = () => createEmptyBlock({ timestamp: now, gasLimit: 30_000_000n }, { common: vm.common });
const hex = (a) => bytesToHex(a.bytes);
async function deploy(data) {
  const r = await vm.evm.runCall({ caller: alice, data: hexToBytes(data), gasLimit: 15_000_000n, block: block() });
  assert.equal(r.execResult.exceptionError, undefined, "deploy reverted");
  return r.createdAddress;
}
const call = (from, to, abi, functionName, args = [], value = 0n) =>
  vm.evm.runCall({
    caller: from,
    to,
    value,
    data: hexToBytes(encodeFunctionData({ abi, functionName, args })),
    gasLimit: 8_000_000n,
    block: block(),
  });
const ok = (r, abi, name) => {
  assert.equal(r.execResult.exceptionError, undefined, `${name} reverted: ${bytesToHex(r.execResult.returnValue)}`);
  return decodeFunctionResult({ abi, functionName: name, data: bytesToHex(r.execResult.returnValue) });
};
const err = (r, abi = fwAbi) => {
  assert.ok(r.execResult.exceptionError, "expected revert");
  return decodeErrorResult({ abi, data: bytesToHex(r.execResult.returnValue) });
};
const events = (r, abi = fwAbi) =>
  (r.execResult.logs ?? []).flatMap((l) => {
    try {
      return [decodeEventLog({ abi, topics: l[1].map(bytesToHex), data: bytesToHex(l[2]) })];
    } catch {
      return [];
    }
  });
const balance = async (a) => (await vm.stateManager.getAccount(a))?.balance ?? 0n;

const registry = await deploy(registryArt.bytecode);
const fw = await deploy(encodeDeployData({ abi: fwAbi, bytecode: fwArt.bytecode, args: [hex(registry)] }));
const token = await deploy(`0x${tokenOut.evm.bytecode.object}`);
const tokenAddr = hex(token);
const claim = toFunctionSelector("claim(uint256)");
const transfer = toFunctionSelector("transfer(address,uint256)");
const tokenBal = async (who) =>
  ok(await call(alice, token, tokenAbi, "balanceOf", [who]), tokenAbi, "balanceOf");

ok(await call(alice, registry, registryArt.abi, "registerAgent", ["Vaulted", "Has its own vault.", "", 1n]), registryArt.abi, "registerAgent");
ok(await call(bob, registry, registryArt.abi, "registerAgent", ["Other", "Another owner.", "", 1n]), registryArt.abi, "registerAgent");

// --- One-transaction setup ---------------------------------------------------------------------
const predicted = ok(await call(alice, fw, fwAbi, "predictVault", [1n]), fwAbi, "predictVault");
const validUntil = now + 3_600n;
const stipend = 5n * 10n ** 16n;
const setup = await call(
  alice,
  fw,
  fwAbi,
  "createFirewallWithPermissions",
  [1n, hex(session), validUntil, false, 0n, 0n, 86_400n, [{ target: tokenAddr, name: "Token", selectors: [claim] }]],
  stipend,
);
const [firewallId, vault] = ok(setup, fwAbi, "createFirewallWithPermissions");
assert.equal(firewallId, 1n);
assert.equal(getAddress(vault), getAddress(predicted), "predictVault matches the CREATE2 address");
const setupNames = events(setup).map((e) => e.eventName);
for (const name of ["FirewallCreated", "VaultCreated", "SessionExecutorSet", "TargetAllowed", "FunctionAllowed", "ExecutorGasFunded"]) {
  assert.ok(setupNames.includes(name), `setup emits ${name}`);
}
assert.equal(await balance(session), stipend, "gas stipend reached the session executor");
await vm.stateManager.putAccount(session, createAccount({ balance: 10n ** 20n }));
assert.equal(ok(await call(alice, fw, fwAbi, "vaultOf", [1n]), fwAbi, "vaultOf").toLowerCase(), vault.toLowerCase());
assert.equal(ok(await call(alice, fw, fwAbi, "getExecutorValidUntil", [1n]), fwAbi, "getExecutorValidUntil"), validUntil);
// Only the agent owner can run setup, and the expiry must be in the future.
assert.equal(
  err(await call(bob, fw, fwAbi, "createFirewallWithPermissions", [1n, hex(session), 0n, false, 0n, 0n, 86_400n, []])).errorName,
  "UnauthorizedOwner",
);
assert.equal(
  err(await call(alice, fw, fwAbi, "createFirewallWithPermissions", [1n, hex(session), now, false, 0n, 0n, 86_400n, []])).errorName,
  "InvalidExpiry",
);
// The vault and the firewall can never be allowed as targets.
assert.equal(err(await call(alice, fw, fwAbi, "allowTarget", [1n, vault, "self"])).errorName, "InvalidTarget");
assert.equal(err(await call(alice, fw, fwAbi, "allowTarget", [1n, hex(fw), "self"])).errorName, "InvalidTarget");

// --- Per-agent custody -------------------------------------------------------------------------
const claimData = encodeFunctionData({ abi: tokenAbi, functionName: "claim", args: [250n] });
const exe = await call(session, fw, fwAbi, "execute", [1n, tokenAddr, 0n, claimData]);
assert.equal(exe.execResult.exceptionError, undefined, "session executor can execute");
const action = events(exe).find((e) => e.eventName === "AgentAction");
assert.ok(action, "AgentAction emitted");
assert.equal(action.args.executor.toLowerCase(), hex(session));
assert.equal(action.args.calldataHash, keccak256(claimData));
assert.equal(await tokenBal(vault), 250n, "tokens credited to the agent's vault");
assert.equal(await tokenBal(hex(fw)), 0n, "nothing sits in the shared firewall");
// Only the registry owner can move vault assets; the firewall-forward path is firewall-only.
const sweep = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [hex(alice), 100n] });
const vaultAddr = createAddressFromString(vault);
assert.equal(err(await call(bob, vaultAddr, vaultArt.abi, "ownerCall", [tokenAddr, 0n, sweep]), vaultArt.abi).errorName, "OnlyOwner");
assert.equal(err(await call(session, vaultAddr, vaultArt.abi, "ownerCall", [tokenAddr, 0n, sweep]), vaultArt.abi).errorName, "OnlyOwner");
assert.equal(err(await call(alice, vaultAddr, vaultArt.abi, "forward", [tokenAddr, sweep]), vaultArt.abi).errorName, "OnlyFirewall");
ok(await call(alice, vaultAddr, vaultArt.abi, "ownerCall", [tokenAddr, 0n, sweep]), vaultArt.abi, "ownerCall");
assert.equal(await tokenBal(hex(alice)), 100n, "owner withdrew from the vault");
assert.equal(await tokenBal(vault), 150n);
// transfer is not allowed for the executor, so it cannot move the vault's tokens.
const steal = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [hex(session), 150n] });
assert.equal(err(await call(session, fw, fwAbi, "execute", [1n, tokenAddr, 0n, steal])).errorName, "FunctionNotAllowed");

// A second agent's firewall gets a different vault: balances never mix.
ok(await call(bob, fw, fwAbi, "createFirewallWithPermissions", [2n, hex(exec), 0n, false, 0n, 0n, 86_400n, [{ target: tokenAddr, name: "Token", selectors: [claim, transfer] }]]), fwAbi, "createFirewallWithPermissions");
const vault2 = ok(await call(bob, fw, fwAbi, "vaultOf", [2n]), fwAbi, "vaultOf");
assert.notEqual(vault2.toLowerCase(), vault.toLowerCase());
const steal2 = encodeFunctionData({ abi: tokenAbi, functionName: "transfer", args: [hex(exec), 1n] });
assert.ok((await call(exec, fw, fwAbi, "execute", [2n, tokenAddr, 0n, steal2])).execResult.exceptionError, "agent 2 cannot spend agent 1's tokens");
assert.equal(await tokenBal(vault), 150n);

// --- Session expiry ----------------------------------------------------------------------------
now = validUntil + 1n;
const expired = err(await call(session, fw, fwAbi, "execute", [1n, tokenAddr, 0n, claimData]));
assert.equal(expired.errorName, "ExecutorExpired");
ok(await call(alice, fw, fwAbi, "setSessionExecutor", [1n, hex(session), now + 60n]), fwAbi, "setSessionExecutor");
ok(await call(session, fw, fwAbi, "execute", [1n, tokenAddr, 0n, claimData]), fwAbi, "execute");
ok(await call(alice, fw, fwAbi, "setExecutor", [1n, hex(session)]), fwAbi, "setExecutor");
assert.equal(ok(await call(alice, fw, fwAbi, "getExecutorValidUntil", [1n]), fwAbi, "getExecutorValidUntil"), 0n, "setExecutor clears the expiry");
now = 10n ** 9n;
ok(await call(session, fw, fwAbi, "execute", [1n, tokenAddr, 0n, claimData]), fwAbi, "execute");
console.log("v3 firewall tests ok (vault custody, session executors, one-transaction setup)");

// --- AgentProofQuorum --------------------------------------------------------------------------
now = 2_000n;
assert.ok(
  (await vm.evm.runCall({ caller: alice, data: hexToBytes(encodeDeployData({ abi: qAbi, bytecode: quorumArt.bytecode, args: [[hex(v1)], 2n] })), gasLimit: 15_000_000n, block: block() })).execResult.exceptionError,
  "threshold above verifier count is rejected",
);
const quorum = await deploy(encodeDeployData({ abi: qAbi, bytecode: quorumArt.bytecode, args: [[hex(v1), hex(v2), hex(v3)], 2n] }));
const h = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const exA = h(0xa1), hashA = h(0xaa), txA = h(0x7a);
const anchorArgs = (hash = hashA, ex = exA) => [hash, ex, 1n, 1n, txA];

assert.equal(err(await call(alice, quorum, qAbi, "attest", anchorArgs()), qAbi).errorName, "Unauthorized");
const first = await call(v1, quorum, qAbi, "anchorProof", anchorArgs());
ok(first, qAbi, "anchorProof");
assert.deepEqual(events(first, qAbi).map((e) => e.eventName), ["ProofAttested"], "one attestation does not anchor");
assert.equal(ok(await call(alice, quorum, qAbi, "isAnchored", [exA]), qAbi, "isAnchored"), false);
assert.equal(err(await call(v1, quorum, qAbi, "attest", anchorArgs()), qAbi).errorName, "AlreadyAttested");
const second = await call(v2, quorum, qAbi, "attest", anchorArgs());
const names = events(second, qAbi).map((e) => e.eventName);
assert.deepEqual(names, ["ProofAttested", "ExecutionProofAnchored"], "threshold reached anchors once");
assert.equal(ok(await call(alice, quorum, qAbi, "isAnchored", [exA]), qAbi, "isAnchored"), true);
const anchor = ok(await call(alice, quorum, qAbi, "getAnchor", [exA]), qAbi, "getAnchor");
assert.equal(anchor.proofHash, hashA);

// Anyone can challenge; it is a public flag, not a verdict change.
const ch = await call(bob, quorum, qAbi, "challenge", [exA, h(0xbb), "ipfs://recompute"]);
assert.equal(events(ch, qAbi)[0].eventName, "ProofChallenged");
assert.equal(ok(await call(alice, quorum, qAbi, "getExecution", [exA]), qAbi, "getExecution").challenges, 1);
assert.equal(err(await call(bob, quorum, qAbi, "challenge", [h(0xdead), h(0), ""]), qAbi).errorName, "UnknownExecution");

// A verifier withdrawing drops the anchor below threshold: Revoked (status 4), history kept.
const wd = await call(v2, quorum, qAbi, "withdrawAttestation", [exA, "agrees with challenge"]);
assert.deepEqual(events(wd, qAbi).map((e) => e.eventName), ["AttestationWithdrawn", "ProofRevoked"]);
assert.equal(ok(await call(alice, quorum, qAbi, "isAnchored", [exA]), qAbi, "isAnchored"), false);
assert.equal(ok(await call(alice, quorum, qAbi, "getExecution", [exA]), qAbi, "getExecution").status, 4);

// Conflicting hashes from two verifiers: Disputed (3), and nobody can anchor it afterwards.
const exB = h(0xb1);
ok(await call(v1, quorum, qAbi, "attest", anchorArgs(h(0xb0), exB)), qAbi, "attest");
const conflict = await call(v2, quorum, qAbi, "attest", anchorArgs(h(0xb9), exB));
assert.deepEqual(events(conflict, qAbi).map((e) => e.eventName), ["ProofConflict"]);
assert.equal(ok(await call(alice, quorum, qAbi, "getExecution", [exB]), qAbi, "getExecution").status, 3);
assert.equal(err(await call(v3, quorum, qAbi, "attest", anchorArgs(h(0xb0), exB)), qAbi).errorName, "ExecutionDisputed");
// A proof hash belongs to one execution only.
assert.equal(err(await call(v3, quorum, qAbi, "attest", anchorArgs(hashA, h(0xc1))), qAbi).errorName, "ProofHashAlreadyUsed");

// Verifier set management is owner-only and keeps threshold <= count.
assert.equal(err(await call(bob, quorum, qAbi, "addVerifier", [hex(bob)]), qAbi).errorName, "Unauthorized");
ok(await call(alice, quorum, qAbi, "removeVerifier", [hex(v3)]), qAbi, "removeVerifier");
assert.equal(err(await call(alice, quorum, qAbi, "removeVerifier", [hex(v2)]), qAbi).errorName, "InvalidThreshold");
assert.equal(err(await call(alice, quorum, qAbi, "setThreshold", [0n]), qAbi).errorName, "InvalidThreshold");
console.log("quorum tests ok (threshold anchoring, conflicts, challenges, revocation)");
