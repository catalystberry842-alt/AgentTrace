import { readFileSync, readdirSync, statSync } from "node:fs";
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
  encodeEventTopics,
  encodeFunctionData,
  keccak256,
  toFunctionSelector,
} from "viem";

const root = join(import.meta.dirname, "..");
const registryArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentRegistry.json"), "utf8"));
const firewallArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewall.json"), "utf8"));
const proofArtifact = JSON.parse(readFileSync(join(root, "contracts/out/AgentProof.json"), "utf8"));
const registryAbi = registryArtifact.abi;
const firewallAbi = firewallArtifact.abi;
const proofAbi = proofArtifact.abi;
const proofSource = readFileSync(join(root, "contracts/AgentProof.sol"), "utf8");
assert.equal(/\btx\.origin\b/.test(proofSource), false);
assert.equal(/\bdelegatecall\b/.test(proofSource), false);
const proofFns = proofAbi.filter((item) => item.type === "function").map((item) => item.name);
for (const banned of ["updateProof", "editProof", "setProof", "deleteProof", "upgrade", "setAdmin"]) {
  assert.equal(proofFns.some((name) => name.toLowerCase() === banned.toLowerCase()), false);
}
assert.ok(proofFns.includes("anchorProof"));
assert.equal(proofAbi.some((item) => item.type === "event" && item.name === "ExecutionProofAnchored"), true);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(path);
  }
  return out;
}
for (const file of [...walk(join(root, "src/routes")), ...walk(join(root, "src/components"))]) {
  const text = readFileSync(file, "utf8");
  assert.equal(text.includes("AGENT_PROOF_VERIFIER_PRIVATE_KEY"), false, file);
  assert.equal(text.includes("MONAD_DEPLOYER_PRIVATE_KEY"), false, file);
  assert.equal(text.includes("privateKeyToAccount"), false, file);
}

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
  settings: { outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
};
const echoCompiled = JSON.parse(solc.compile(JSON.stringify(echoInput))).contracts["Echo.sol"].Echo;
const echoAbi = echoCompiled.abi;
const pingSelector = toFunctionSelector("ping()");
const failSelector = toFunctionSelector("fail()");
const pingData = encodeFunctionData({ abi: echoAbi, functionName: "ping", args: [] });
const failData = encodeFunctionData({ abi: echoAbi, functionName: "fail", args: [] });

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
  return decodeFunctionResult({ abi, functionName: name, data: bytesToHex(result.execResult.returnValue) });
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

function eventsOf(result, abi) {
  return (result.execResult.logs ?? []).map((log) => {
    const topics = log[1].map((topic) => bytesToHex(topic));
    const data = bytesToHex(log[2]);
    return decodeEventLog({ abi, data, topics });
  });
}

function rawLogs(result) {
  return (result.execResult.logs ?? []).map((log) => ({
    address: (log[0]?.bytes ? bytesToHex(log[0].bytes) : bytesToHex(log[0])).toLowerCase(),
    topics: log[1].map((topic) => bytesToHex(topic)),
    data: bytesToHex(log[2]),
  }));
}

const aliceAddr = bytesToHex(alice.bytes);
const bobAddr = bytesToHex(bob.bytes);
const carolAddr = bytesToHex(carol.bytes);
const trading = 1n;

const registry = await deploy(alice, registryArtifact.bytecode);
const firewall = await deploy(
  alice,
  encodeDeployData({ abi: firewallAbi, bytecode: firewallArtifact.bytecode, args: [bytesToHex(registry.bytes)] }),
);
const echo = await deploy(alice, `0x${echoCompiled.evm.bytecode.object}`);
const proof = await deploy(
  alice,
  encodeDeployData({ abi: proofAbi, bytecode: proofArtifact.bytecode, args: [carolAddr] }),
);
const firewallAddress = bytesToHex(firewall.bytes).toLowerCase();
const echoAddr = bytesToHex(echo.bytes).toLowerCase();
const proofAddress = bytesToHex(proof.bytes).toLowerCase();

assert.equal(returned(await call(alice, registry, registryAbi, "registerAgent", ["Trace", "Records.", "", trading]), registryAbi, "registerAgent"), 1n);
const created = await call(alice, firewall, firewallAbi, "createFirewall", [1n, bobAddr, false, 0n, 0n, 100n], { timestamp: 1_000n });
assert.equal(returned(created, firewallAbi, "createFirewall"), 1n);
const allowedTarget = await call(alice, firewall, firewallAbi, "allowTarget", [1n, echoAddr, "Echo"]);
const allowedFn = await call(alice, firewall, firewallAbi, "allowFunction", [1n, echoAddr, pingSelector]);
const executed = await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, pingData], { timestamp: 1_000n });
assert.equal(executed.execResult.exceptionError, undefined);
const actionEvent = eventsOf(executed, firewallAbi).find((event) => event.eventName === "AgentAction");
assert.ok(actionEvent);
assert.equal(actionEvent.args.calldataHash, keccak256(pingData));
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall").executionNonce, 1n);

await call(alice, firewall, firewallAbi, "allowFunction", [1n, echoAddr, failSelector]);
const failed = await call(bob, firewall, firewallAbi, "execute", [1n, echoAddr, 0n, failData], { timestamp: 1_050n });
assert.ok(failed.execResult.exceptionError);
assert.equal(eventsOf(failed, firewallAbi).some((event) => event.eventName === "AgentAction"), false);
assert.equal(rawLogs(failed).length, 0);
assert.equal(returned(await call(alice, firewall, firewallAbi, "getFirewall", [1n]), firewallAbi, "getFirewall").executionNonce, 1n);

const proofHash = keccak256("0x" + "11".repeat(32));
const otherHash = keccak256("0x" + "22".repeat(32));
const executionA = keccak256("0x" + "33".repeat(32));
const executionB = keccak256("0x" + "44".repeat(32));
const txA = keccak256("0x" + "55".repeat(32));
const txB = keccak256("0x" + "66".repeat(32));

assert.equal(
  reverted(await call(bob, proof, proofAbi, "anchorProof", [proofHash, executionA, 1n, 1n, txA]), proofAbi),
  "Unauthorized",
);
assert.equal(
  reverted(await call(carol, proof, proofAbi, "anchorProof", ["0x" + "00".repeat(32), executionA, 1n, 1n, txA]), proofAbi),
  "ZeroAddress",
);
const anchored = await call(carol, proof, proofAbi, "anchorProof", [proofHash, executionA, 1n, 1n, txA]);
assert.equal(anchored.execResult.exceptionError, undefined);
const anchoredEvent = eventsOf(anchored, proofAbi).find((event) => event.eventName === "ExecutionProofAnchored");
assert.ok(anchoredEvent);
assert.equal(anchoredEvent.args.proofHash, proofHash);
assert.equal(anchoredEvent.args.executionId, executionA);
assert.equal(anchoredEvent.args.verifier.toLowerCase(), carolAddr);
const stored = returned(await call(alice, proof, proofAbi, "getAnchor", [executionA]), proofAbi, "getAnchor");
assert.equal(stored.proofHash ?? stored[0], proofHash);
assert.equal(stored.executionId ?? stored[1], executionA);
assert.equal((stored.agentId ?? stored[2]).toString(), "1");
assert.equal(returned(await call(alice, proof, proofAbi, "isAnchored", [executionA]), proofAbi, "isAnchored"), true);
assert.equal(
  reverted(await call(carol, proof, proofAbi, "anchorProof", [otherHash, executionA, 1n, 1n, txA]), proofAbi),
  "ProofAlreadyAnchored",
);
assert.equal(
  reverted(await call(carol, proof, proofAbi, "anchorProof", [proofHash, executionB, 1n, 1n, txB]), proofAbi),
  "ProofHashAlreadyUsed",
);
assert.equal(
  reverted(await call(bob, proof, proofAbi, "setVerifier", [bobAddr]), proofAbi),
  "Unauthorized",
);
assert.equal((await call(alice, proof, proofAbi, "setVerifier", [bobAddr])).execResult.exceptionError, undefined);
assert.equal(returned(await call(alice, proof, proofAbi, "verifier"), proofAbi, "verifier").toLowerCase(), bobAddr);

const actionLogs = rawLogs(executed);
const actionLog = actionLogs.find((log) => {
  try {
    return decodeEventLog({ abi: firewallAbi, data: log.data, topics: log.topics }).eventName === "AgentAction";
  } catch {
    return false;
  }
});
assert.ok(actionLog);
const txHash = `0x${"cd".repeat(32)}`;
const blockNumber = 20;
const base = {
  action: {
    executionId: actionEvent.args.executionId.toLowerCase(),
    agentId: actionEvent.args.agentId.toString(),
    firewallId: actionEvent.args.firewallId.toString(),
    executor: bobAddr,
    target: echoAddr,
    selector: pingSelector.toLowerCase(),
    value: actionEvent.args.value.toString(),
    calldataHash: actionEvent.args.calldataHash.toLowerCase(),
    txHash,
    blockNumber,
  },
  agentExists: true,
  firewallAgentId: "1",
  firewallContract: firewallAddress,
  tx: {
    hash: txHash,
    from: bobAddr,
    to: firewallAddress,
    input: encodeFunctionData({ abi: firewallAbi, functionName: "execute", args: [1n, echoAddr, 0n, pingData] }),
    value: 0n,
  },
  receipt: {
    status: "success",
    transactionHash: txHash,
    blockNumber,
    logs: actionLogs,
  },
};

function cloneEvidence(input) {
  return {
    ...input,
    action: { ...input.action },
    tx: input.tx ? { ...input.tx } : null,
    receipt: input.receipt
      ? { ...input.receipt, logs: input.receipt.logs.map((log) => ({ ...log, topics: [...log.topics] })) }
      : null,
  };
}

const vite = await createServer({ root, server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
try {
  const assessMod = await vite.ssrLoadModule("/src/lib/chain/proof-assess.ts");
  const hashMod = await vite.ssrLoadModule("/src/lib/chain/proof-hash.ts");
  const proofMod = await vite.ssrLoadModule("/src/lib/chain/proof.server.ts");
  const firewallMod = await vite.ssrLoadModule("/src/lib/chain/firewall.server.ts");
  const indexerMod = await vite.ssrLoadModule("/src/lib/chain/indexer.server.ts");
  const db = await vite.ssrLoadModule("/src/lib/db.ts");
  const sql = await db.getSql();

  const happy = assessMod.assessExecution(base);
  assert.equal(happy.status, "receipt_verified");
  assert.ok(happy.proofHash);
  assert.equal(happy.checks.every((item) => item.passed), true);
  const independent = keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint256" },
        { type: "address" },
        { type: "bytes4" },
        { type: "uint256" },
        { type: "bytes32" },
      ],
      [
        10143n,
        1n,
        1n,
        base.action.executionId,
        bobAddr,
        txHash,
        BigInt(blockNumber),
        echoAddr,
        pingSelector,
        0n,
        base.action.calldataHash,
      ],
    ),
  );
  assert.equal(happy.proofHash, independent);
  assert.equal(hashMod.computeProofHash({
    chainId: 10143n,
    agentId: 1n,
    firewallId: 1n,
    executionId: base.action.executionId,
    executor: bobAddr,
    transactionHash: txHash,
    blockNumber: BigInt(blockNumber),
    target: echoAddr,
    functionSelector: pingSelector,
    value: 0n,
    calldataHash: base.action.calldataHash,
  }), independent);

  function expectFail(mutate, checkName) {
    const next = cloneEvidence(base);
    mutate(next);
    const result = assessMod.assessExecution(next);
    assert.equal(result.status, "unverifiable", checkName);
    assert.equal(result.proofHash, null, checkName);
    const found = result.checks.find((item) => item.name === checkName);
    assert.equal(found.passed, false, checkName);
    assert.ok(found.details.length > 0, checkName);
    assert.equal(result.checks.every((item) => item.passed), false);
  }

  const missingReceipt = cloneEvidence(base);
  missingReceipt.receipt = null;
  const missingReceiptResult = assessMod.assessExecution(missingReceipt);
  assert.equal(missingReceiptResult.status, "unverifiable");
  assert.equal(missingReceiptResult.checks.find((item) => item.name === "receiptExists").passed, false);

  const missingTx = cloneEvidence(base);
  missingTx.tx = null;
  missingTx.receipt = null;
  assert.equal(assessMod.assessExecution(missingTx).checks.find((item) => item.name === "transactionExists").passed, false);

  const revertedReceipt = cloneEvidence(base);
  revertedReceipt.receipt = { ...revertedReceipt.receipt, status: "reverted", logs: [] };
  const revertedResult = assessMod.assessExecution(revertedReceipt);
  assert.equal(revertedResult.status, "unverifiable");
  assert.equal(revertedResult.checks.find((item) => item.name === "transactionSucceeded").passed, false);
  assert.equal(revertedResult.checks.find((item) => item.name === "actionEventExists").passed, false);

  const noAction = cloneEvidence(base);
  noAction.receipt = { ...noAction.receipt, logs: [] };
  assert.equal(assessMod.assessExecution(noAction).checks.find((item) => item.name === "actionEventExists").passed, false);

  expectFail((next) => {
    next.action.agentId = "9";
  }, "agentMatches");
  expectFail((next) => {
    next.agentExists = false;
  }, "agentExists");
  expectFail((next) => {
    next.action.firewallId = "9";
  }, "firewallMatches");
  expectFail((next) => {
    next.firewallAgentId = "2";
  }, "firewallMatches");
  expectFail((next) => {
    next.action.executor = aliceAddr;
  }, "executorAuthorized");
  expectFail((next) => {
    next.tx.from = aliceAddr;
  }, "executorAuthorized");
  expectFail((next) => {
    next.tx.to = echoAddr;
  }, "executorAuthorized");
  expectFail((next) => {
    next.action.target = aliceAddr;
  }, "targetMatches");
  expectFail((next) => {
    next.action.selector = failSelector;
  }, "selectorMatches");
  expectFail((next) => {
    next.action.executionId = executionB;
  }, "executionIdMatches");
  expectFail((next) => {
    next.action.txHash = txB;
    next.tx.hash = txB;
  }, "blockMatches");
  expectFail((next) => {
    next.action.blockNumber = 99;
  }, "blockMatches");
  expectFail((next) => {
    next.action.value = "5";
  }, "valueMatches");
  expectFail((next) => {
    next.tx.value = 5n;
  }, "valueMatches");
  expectFail((next) => {
    next.action.calldataHash = otherHash;
  }, "calldataHashMatches");
  expectFail((next) => {
    next.tx.input = encodeFunctionData({ abi: firewallAbi, functionName: "execute", args: [1n, echoAddr, 0n, failData] });
  }, "calldataHashMatches");
  expectFail((next) => {
    next.receipt.logs = next.receipt.logs.map((log) => ({ ...log, address: echoAddr }));
  }, "actionEventExists");

  const wrongId = cloneEvidence(base);
  wrongId.action.executionId = executionB;
  const wrongIdResult = assessMod.assessExecution(wrongId);
  assert.match(wrongIdResult.checks.find((item) => item.name === "executionIdMatches").details, /different execution id/);

  delete process.env.AGENT_FIREWALL_ADDRESS;
  delete process.env.AGENT_PROOF_ADDRESS;
  delete process.env.AGENT_PROOF_VERIFIER_PRIVATE_KEY;

  let seq = 0;
  async function apply(result, reuseHash) {
    const hash = reuseHash ?? `0x${(++seq).toString(16).padStart(64, "0")}`;
    let index = 0;
    for (const log of rawLogs(result)) {
      await firewallMod.applyFirewallLog(sql, firewallAddress, {
        address: log.address,
        topics: log.topics,
        data: log.data,
        blockNumber: 20n,
        logIndex: index,
        transactionHash: hash,
      });
      index += 1;
    }
    return hash;
  }

  await apply(created);
  await apply(allowedTarget);
  await apply(allowedFn);
  const executionTx = await apply(executed);
  const beforeFail = await sql`select count(*)::int as count from execution_proofs`;
  await apply(failed);
  const afterFail = await sql`select count(*)::int as count from execution_proofs`;
  assert.equal(Number(beforeFail[0].count), 1);
  assert.equal(Number(afterFail[0].count), 1);

  const proofs = await sql`
    select execution_id, verification_status, proof_hash, anchored, agent_id, tx_hash
    from execution_proofs
  `;
  assert.equal(proofs.length, 1);
  assert.equal(proofs[0].verification_status, "executed");
  assert.equal(proofs[0].proof_hash, null);
  assert.equal(proofs[0].anchored, false);
  assert.equal(proofs[0].tx_hash, executionTx);
  const executionId = proofs[0].execution_id;

  await apply(executed);
  const replayed = await sql`select count(*)::int as count, max(verification_status) as status from execution_proofs`;
  assert.equal(Number(replayed[0].count), 1);
  assert.equal(replayed[0].status, "executed");

  const unknown = `0x${"ab".repeat(32)}`;
  assert.equal(await proofMod.verifyIndexedExecution(unknown, true), null);
  const stillOne = await sql`select count(*)::int as count from execution_proofs`;
  assert.equal(Number(stillOne[0].count), 1);

  const delayed = await proofMod.verifyIndexedExecution(executionId, true);
  assert.equal(delayed.verificationStatus, "temporary_error");
  assert.match(delayed.lastError, /not deployed/i);
  assert.equal(delayed.anchored, false);
  assert.equal(delayed.proofHash, null);

  process.env.AGENT_FIREWALL_ADDRESS = firewallAddress;
  let head = null;
  try {
    head = await indexerMod.getPublicClient().getBlockNumber();
  } catch {
    head = null;
  }
  if (head != null) {
    await sql`
      update execution_proofs set block_number = ${Number(head)}, verification_status = 'executed', permanent = false, last_error = null
      where execution_id = ${executionId}
    `;
    await sql`update firewall_actions set block_number = ${Number(head)} where execution_id = ${executionId}`;
    const recent = await proofMod.verifyIndexedExecution(executionId, true);
    assert.equal(recent.verificationStatus, "temporary_error");
    assert.notEqual(recent.verificationStatus, "unverifiable");
    assert.match(recent.lastError, /not available/i);

    await sql`
      update execution_proofs set block_number = 1, verification_status = 'executed', permanent = false
      where execution_id = ${executionId}
    `;
    await sql`update firewall_actions set block_number = 1 where execution_id = ${executionId}`;
    const stale = await proofMod.verifyIndexedExecution(executionId, true);
    assert.equal(stale.verificationStatus, "unverifiable");
    assert.equal(stale.proofHash, null);
    const flags = await sql`select permanent from execution_proofs where execution_id = ${executionId}`;
    assert.equal(flags[0].permanent, true);
    const attempts = await sql`select attempt_count from execution_proofs where execution_id = ${executionId}`;
    await proofMod.settlePendingProofs(5);
    const afterSettle = await sql`select attempt_count, verification_status from execution_proofs where execution_id = ${executionId}`;
    assert.equal(Number(afterSettle[0].attempt_count), Number(attempts[0].attempt_count));
    assert.equal(afterSettle[0].verification_status, "unverifiable");
  } else {
    const offline = await proofMod.verifyIndexedExecution(executionId, true);
    assert.equal(offline.verificationStatus, "temporary_error");
    assert.notEqual(offline.verificationStatus, "unverifiable");
  }

  const row = (await sql`
    select agent_id, firewall_id, execution_id, executor, tx_hash, block_number, target, function_selector, value, calldata_hash
    from execution_proofs where execution_id = ${executionId}
  `)[0];
  const canonical = hashMod.computeProofHash({
    chainId: 10143n,
    agentId: BigInt(row.agent_id),
    firewallId: BigInt(row.firewall_id),
    executionId: row.execution_id,
    executor: row.executor,
    transactionHash: row.tx_hash,
    blockNumber: BigInt(row.block_number),
    target: row.target,
    functionSelector: row.function_selector,
    value: BigInt(row.value),
    calldataHash: row.calldata_hash,
  });
  await sql`
    update execution_proofs set
      verification_status = 'receipt_verified',
      proof_hash = ${canonical},
      verification_method = 'monad-receipt-v1',
      permanent = true,
      anchored = false,
      anchor_tx_hash = null
    where execution_id = ${executionId}
  `;
  const kept = await proofMod.verifyIndexedExecution(executionId, true);
  assert.equal(kept.verificationStatus, "receipt_verified");
  assert.equal(kept.proofHash, canonical);

  await apply(executed, executionTx);
  const afterRestart = await sql`
    select count(*)::int as count, max(verification_status) as status, max(proof_hash) as proof_hash
    from execution_proofs
  `;
  assert.equal(Number(afterRestart[0].count), 1);
  assert.equal(afterRestart[0].status, "receipt_verified");
  assert.equal(afterRestart[0].proof_hash, canonical);

  await sql`update execution_proofs set proof_hash = ${otherHash} where execution_id = ${executionId}`;
  const wrong = await proofMod.anchorVerifiedProof(executionId);
  assert.equal(wrong.anchored, false);
  assert.match(wrong.reason, /does not match/);
  assert.equal(wrong.txHash, null);

  await sql`update execution_proofs set proof_hash = ${canonical} where execution_id = ${executionId}`;
  const unconfigured = await proofMod.anchorVerifiedProof(executionId);
  assert.equal(unconfigured.anchored, false);
  assert.equal(unconfigured.reason, "Verifier credentials are not configured. No anchor transaction was sent.");
  assert.equal(unconfigured.txHash, null);
  const notAnchored = await sql`select anchored from execution_proofs where execution_id = ${executionId}`;
  assert.equal(notAnchored[0].anchored, false);

  const verifiedOnly = await proofMod.listProofsForAgent("1", true);
  assert.equal(verifiedOnly.length, 1);
  assert.equal(verifiedOnly[0].executionId, executionId);
  await sql`update execution_proofs set verification_status = 'executed' where execution_id = ${executionId}`;
  assert.equal((await proofMod.listProofsForAgent("1", true)).length, 0);
  await sql`
    update execution_proofs set verification_status = 'receipt_verified', proof_hash = ${canonical}
    where execution_id = ${executionId}
  `;

  process.env.AGENT_PROOF_ADDRESS = proofAddress;
  const anchorTx = `0x${"ee".repeat(32)}`;
  const topicsFor = (hash) =>
    encodeEventTopics({
      abi: proofAbi,
      eventName: "ExecutionProofAnchored",
      args: { proofHash: hash, executionId: executionId, agentId: 1n },
    });
  const anchorData = encodeAbiParameters(
    [{ type: "uint256" }, { type: "bytes32" }, { type: "address" }, { type: "uint64" }],
    [1n, executionTx, carolAddr, 1n],
  );
  await sql`update execution_proofs set verification_status = 'executed' where execution_id = ${executionId}`;
  await proofMod.applyProofLog({
    address: proofAddress,
    topics: topicsFor(canonical),
    data: anchorData,
    blockNumber: 30n,
    transactionHash: anchorTx,
  });
  assert.equal((await sql`select anchored from execution_proofs where execution_id = ${executionId}`)[0].anchored, false);

  await sql`
    update execution_proofs set verification_status = 'receipt_verified', proof_hash = ${canonical}
    where execution_id = ${executionId}
  `;
  await proofMod.applyProofLog({
    address: proofAddress,
    topics: topicsFor(otherHash),
    data: anchorData,
    blockNumber: 30n,
    transactionHash: anchorTx,
  });
  assert.equal((await sql`select anchored from execution_proofs where execution_id = ${executionId}`)[0].anchored, false);
  await proofMod.applyProofLog({
    address: proofAddress,
    topics: topicsFor(canonical),
    data: anchorData,
    blockNumber: 31n,
    transactionHash: anchorTx,
  });
  const anchoredRow = (await sql`
    select anchored, anchor_tx_hash, anchor_block_number, verification_status
    from execution_proofs where execution_id = ${executionId}
  `)[0];
  assert.equal(anchoredRow.anchored, true);
  assert.equal(anchoredRow.anchor_tx_hash, anchorTx);
  assert.equal(Number(anchoredRow.anchor_block_number), 31);
  assert.equal(anchoredRow.verification_status, "receipt_verified");
  const again = await proofMod.anchorVerifiedProof(executionId);
  assert.equal(again.anchored, true);
  assert.equal(again.reason, "Already anchored.");
  assert.equal(again.txHash, anchorTx);
  assert.equal(Number((await sql`select count(*)::int as count from execution_proofs`)[0].count), 1);
} finally {
  await vite.close();
}

console.log("proof tests ok");
