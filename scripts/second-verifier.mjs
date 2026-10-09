#!/usr/bin/env node
/**
 * An independent AgentTrace verifier. It shares no code path, database, or key with the hosted
 * AgentTrace server: it reads the Monad receipt over public RPC, rebuilds the proof hash with
 * scripts/verify-proof.mjs, and only then attests on AgentProofQuorum with its own key.
 * Run it on a different machine, by a different operator, to remove the single-verifier trust.
 *
 *   SECOND_VERIFIER_PRIVATE_KEY=0x... node scripts/second-verifier.mjs <executionTxHash> \
 *     --chain mainnet|testnet --firewall 0xFirewall --quorum 0xAgentProofQuorum [--rpc URL]
 *   ... --watch            poll new AgentAction logs and attest each one that verifies
 *   ... --dry-run          recompute and print, never send
 *
 * If the receipt checks fail it does NOT attest. If another verifier already attested a
 * different hash, attest() records a conflict onchain (ProofConflict) instead of anchoring.
 */
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyProof } from "./verify-proof.mjs";

const CHAINS = {
  mainnet: { id: 143, rpc: "https://rpc.monad.xyz", explorer: "https://monadvision.com" },
  testnet: { id: 10143, rpc: "https://testnet-rpc.monad.xyz", explorer: "https://testnet.monadvision.com" },
};
const quorumAbi = parseAbi([
  "function attest(bytes32 proofHash, bytes32 executionId, uint256 agentId, uint256 firewallId, bytes32 transactionHash)",
  "function attestationOf(bytes32 executionId, address verifier) view returns (bytes32)",
  "function isVerifier(address) view returns (bool)",
]);
const actionEvent = parseAbi([
  "event AgentAction(uint256 indexed agentId, uint256 indexed firewallId, address indexed executor, address target, bytes4 functionSelector, uint256 value, uint256 executionNonce, bytes32 executionId, bytes32 calldataHash, uint64 timestamp)",
])[0];

const argv = process.argv.slice(2);
const opt = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const chainName = opt("chain") ?? "mainnet";
const net = CHAINS[chainName];
const firewall = opt("firewall")?.toLowerCase();
const quorum = opt("quorum")?.toLowerCase();
const rpc = opt("rpc") ?? net?.rpc;
const dryRun = argv.includes("--dry-run");
const watch = argv.includes("--watch");
const input = argv.find((a) => /^0x[0-9a-fA-F]{64}$/.test(a));
if (!net || !firewall || !quorum || (!input && !watch)) {
  console.error("usage: second-verifier.mjs <executionTxHash>|--watch --chain mainnet|testnet --firewall 0x.. --quorum 0x.. [--rpc URL] [--dry-run]");
  process.exit(2);
}
const key = process.env.SECOND_VERIFIER_PRIVATE_KEY?.trim();
if (!dryRun && !/^0x[a-fA-F0-9]{64}$/.test(key ?? "")) {
  console.error("SECOND_VERIFIER_PRIVATE_KEY is not set. Use --dry-run to recompute without sending.");
  process.exit(2);
}

const chain = defineChain({ id: net.id, name: chainName, nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const transport = http(rpc, { retryCount: 3, timeout: 30_000 });
const pub = createPublicClient({ chain, transport });
const account = key ? privateKeyToAccount(key) : null;
const wallet = account ? createWalletClient({ chain, transport, account }) : null;

if (account && !(await pub.readContract({ address: quorum, abi: quorumAbi, functionName: "isVerifier", args: [account.address] }))) {
  console.error(`${account.address} is not in the AgentProofQuorum verifier set. Ask the quorum owner to addVerifier it.`);
  process.exit(1);
}

async function handle(txHash) {
  const result = await verifyProof({ id: txHash, chain: chainName, rpc, firewall, proof: quorum, requireAnchor: false, log: () => {} });
  const failed = result.checks.filter((c) => !c.ok).map((c) => c.name);
  if (!result.pass || !result.proofHash) {
    console.log(`skip ${txHash}: receipt checks failed (${failed.join(", ")}). Not attesting.`);
    return;
  }
  const executionId = result.executionId;
  if (account) {
    const mine = await pub.readContract({ address: quorum, abi: quorumAbi, functionName: "attestationOf", args: [executionId, account.address] });
    if (mine !== `0x${"0".repeat(64)}`) {
      console.log(`already attested ${executionId}`);
      return;
    }
  }
  const receipt = await pub.getTransactionReceipt({ hash: txHash });
  const action = receipt.logs
    .filter((l) => l.address.toLowerCase() === firewall)
    .map((l) => { try { return decodeAction(l); } catch { return null; } })
    .find((a) => a && a.executionId.toLowerCase() === executionId.toLowerCase());
  console.log(`verified ${executionId}  proofHash ${result.proofHash}`);
  if (dryRun || !wallet) return;
  const args = [result.proofHash, executionId, action.agentId, action.firewallId, receipt.transactionHash];
  const gas = await pub.estimateContractGas({ account, address: quorum, abi: quorumAbi, functionName: "attest", args });
  const hash = await wallet.writeContract({ address: quorum, abi: quorumAbi, functionName: "attest", args, gas: (gas * 115n) / 100n });
  await pub.waitForTransactionReceipt({ hash });
  console.log(`attested: ${net.explorer}/tx/${hash}`);
}

function decodeAction(log) {
  const ev = decodeEventLog({ abi: [actionEvent], data: log.data, topics: log.topics });
  return ev.args;
}

if (input) {
  await handle(input);
} else {
  let from = (await pub.getBlockNumber()) - 90n;
  console.log(`watching ${firewall} from block ${from}`);
  for (;;) {
    const head = await pub.getBlockNumber();
    const to = head - from > 99n ? from + 99n : head;
    if (to >= from) {
      const logs = await pub.getLogs({ address: firewall, event: actionEvent, fromBlock: from, toBlock: to });
      for (const tx of new Set(logs.map((l) => l.transactionHash))) {
        await handle(tx).catch((e) => console.error(`error ${tx}: ${e.shortMessage ?? e.message}`));
      }
      from = to + 1n;
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
}
