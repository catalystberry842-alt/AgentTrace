#!/usr/bin/env node
// Independent AgentTrace proof check. Uses only a public Monad RPC and viem.
// It does not call the AgentTrace API or database.
//
//   node scripts/verify-proof.mjs <executionId|txHash> [--chain mainnet|testnet] [--rpc URL]
//
// txHash may be the firewall execution transaction or the AgentProof anchor transaction.
// Steps: fetch receipt -> decode AgentAction from AgentFirewall -> check calldataHash
// against the execute() input -> rebuild the proof hash per docs/contracts.md ->
// compare with AgentProof.getAnchor(executionId). Exit 0 on PASS, 1 on FAIL, 2 on usage error.
import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem";

const ADDR = {
  firewall: "0x694178a2396b54bff6a25caa0aa9cca6eb079441",
  proof: "0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e",
};
const CHAINS = {
  mainnet: { id: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com" },
  testnet: { id: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com" },
};

const firewallAbi = parseAbi([
  "event AgentAction(uint256 indexed agentId, uint256 indexed firewallId, address indexed executor, address target, bytes4 functionSelector, uint256 value, uint256 executionNonce, bytes32 executionId, bytes32 calldataHash, uint64 timestamp)",
  "function execute(uint256 firewallId, address target, uint256 value, bytes data) payable returns (bytes)",
]);
const proofAbi = parseAbi([
  "event ExecutionProofAnchored(bytes32 indexed proofHash, bytes32 indexed executionId, uint256 indexed agentId, uint256 firewallId, bytes32 transactionHash, address verifier, uint64 anchoredAt)",
  "struct Anchor { bytes32 proofHash; bytes32 executionId; uint256 agentId; uint256 firewallId; bytes32 transactionHash; uint64 anchoredAt; address verifier; }",
  "function getAnchor(bytes32 executionId) view returns (Anchor)",
  "function isAnchored(bytes32 executionId) view returns (bool)",
]);

export function computeProofHash(f) {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bytes32" },
        { type: "address" }, { type: "bytes32" }, { type: "uint256" }, { type: "address" },
        { type: "bytes4" }, { type: "uint256" }, { type: "bytes32" },
      ],
      [f.chainId, f.agentId, f.firewallId, f.executionId, f.executor, f.transactionHash,
        f.blockNumber, f.target, f.functionSelector, f.value, f.calldataHash],
    ),
  );
}

function parseArgs(argv) {
  const out = { chain: "mainnet", rpc: undefined, id: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--chain") out.chain = argv[++i];
    else if (a.startsWith("--chain=")) out.chain = a.slice(8);
    else if (a === "--rpc") out.rpc = argv[++i];
    else if (a.startsWith("--rpc=")) out.rpc = a.slice(6);
    else if (!out.id) out.id = a;
  }
  return out;
}

function decodeLogs(receipt, address, abi, eventName) {
  const rows = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;
    try {
      const ev = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (ev.eventName === eventName) rows.push(ev.args);
    } catch {
      // not this event
    }
  }
  return rows;
}

export async function verifyProof({ id, chain = "mainnet", rpc, log = console.log }) {
  const net = CHAINS[chain];
  if (!net) throw new Error(`unknown chain ${chain}`);
  if (!/^0x[0-9a-fA-F]{64}$/.test(id ?? "")) throw new Error("expected a 32-byte 0x hex executionId or txHash");
  const client = createPublicClient({ transport: http(rpc ?? net.rpc, { retryCount: 3 }) });
  const checks = [];
  const check = (name, ok, detail = "") => { checks.push({ name, ok }); log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `  ${detail}` : ""}`); };

  const rpcChain = await client.getChainId();
  check("rpc chain id", rpcChain === net.id, `${rpcChain}`);

  // Resolve input to an executionId.
  let executionId = id.toLowerCase();
  let execTxHash;
  const asReceipt = await client.getTransactionReceipt({ hash: id }).catch(() => null);
  if (asReceipt) {
    const actions = decodeLogs(asReceipt, ADDR.firewall, firewallAbi, "AgentAction");
    const anchors = decodeLogs(asReceipt, ADDR.proof, proofAbi, "ExecutionProofAnchored");
    if (actions.length) { executionId = actions[0].executionId; execTxHash = asReceipt.transactionHash; log(`input is an execution tx`); }
    else if (anchors.length) { executionId = anchors[0].executionId; log(`input is an anchor tx`); }
    else throw new Error("transaction has no AgentAction or ExecutionProofAnchored log");
  }
  log(`executionId ${executionId}`);

  const anchored = await client.readContract({ address: ADDR.proof, abi: proofAbi, functionName: "isAnchored", args: [executionId] });
  check("AgentProof.isAnchored", anchored === true, anchored ? "" : "(not anchored: the hash is rebuilt below but there is nothing onchain to compare)");
  if (!anchored && !execTxHash) return { pass: false, checks };
  const anchor = anchored
    ? await client.readContract({ address: ADDR.proof, abi: proofAbi, functionName: "getAnchor", args: [executionId] })
    : null;
  execTxHash ??= anchor.transactionHash;
  if (anchor) check("anchor tx matches execution tx", anchor.transactionHash.toLowerCase() === execTxHash.toLowerCase(), execTxHash);

  const receipt = asReceipt && asReceipt.transactionHash.toLowerCase() === execTxHash.toLowerCase()
    ? asReceipt : await client.getTransactionReceipt({ hash: execTxHash });
  check("execution receipt status success", receipt.status === "success", `block ${receipt.blockNumber}`);
  check("execution sent to AgentFirewall", receipt.to?.toLowerCase() === ADDR.firewall);
  const action = decodeLogs(receipt, ADDR.firewall, firewallAbi, "AgentAction").find((a) => a.executionId.toLowerCase() === executionId.toLowerCase());
  check("AgentAction log with this executionId", !!action);
  if (!action) return { pass: false, checks };

  const tx = await client.getTransaction({ hash: execTxHash });
  check("tx sender is executor", getAddress(tx.from) === getAddress(action.executor), action.executor);
  let calldataHash = action.calldataHash;
  try {
    const call = decodeFunctionData({ abi: firewallAbi, data: tx.input });
    const [fwId, target, value, data] = call.args;
    calldataHash = keccak256(data);
    check("calldataHash = keccak256(execute data)", calldataHash === action.calldataHash);
    check("execute args match event", fwId === action.firewallId && getAddress(target) === getAddress(action.target) && value === action.value && data.slice(0, 10).toLowerCase() === action.functionSelector.toLowerCase());
  } catch {
    check("decode execute() input", false);
  }

  const rebuilt = computeProofHash({
    chainId: BigInt(net.id), agentId: action.agentId, firewallId: action.firewallId, executionId: action.executionId,
    executor: action.executor, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber,
    target: action.target, functionSelector: action.functionSelector, value: action.value, calldataHash,
  });
  log(`rebuilt proofHash  ${rebuilt}`);
  if (anchor) {
    log(`onchain proofHash  ${anchor.proofHash}`);
    check("proof hash matches AgentProof.getAnchor", rebuilt.toLowerCase() === anchor.proofHash.toLowerCase());
    check("anchor agent/firewall ids match", anchor.agentId === action.agentId && anchor.firewallId === action.firewallId, `agent #${action.agentId} firewall #${action.firewallId}`);
    log(`verifier ${anchor.verifier}, anchored at ${new Date(Number(anchor.anchoredAt) * 1000).toISOString()}`);
  }
  log(`${net.explorer}/tx/${receipt.transactionHash}`);
  return { pass: checks.every((c) => c.ok), checks, proofHash: rebuilt, executionId };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id) { console.error("usage: node scripts/verify-proof.mjs <executionId|txHash> [--chain mainnet|testnet] [--rpc URL]"); process.exit(2); }
  verifyProof(args).then(
    (r) => { console.log(r.pass ? "PASS" : "FAIL"); process.exit(r.pass ? 0 : 1); },
    (e) => { console.error(`FAIL: ${e.shortMessage ?? e.message}`); process.exit(1); },
  );
}
