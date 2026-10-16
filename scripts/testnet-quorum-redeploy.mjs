#!/usr/bin/env node
/**
 * Testnet only: deploy a replacement AgentProofQuorum that includes the app verifier, then
 * execute one more deposit on V3 firewall #1 (agent #14) for the app to anchor.
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... node scripts/testnet-quorum-redeploy.mjs [--rpc URL]
 * Resumable via contracts/deployments/v3-testnet.json (key "quorumV2").
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeDeployData, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = join(import.meta.dirname, "..");
const i = process.argv.indexOf("--rpc");
const RPC = i > 0 ? process.argv[i + 1] : "https://testnet-rpc.monad.xyz";
const chain = defineChain({ id: 10143, name: "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const transport = http(RPC, { timeout: 30_000, retryCount: 3 });
const pub = createPublicClient({ chain, transport });
if ((await pub.getChainId()) !== 10143) throw new Error("not Monad testnet");
const account = privateKeyToAccount(process.env.MONAD_DEPLOYER_PRIVATE_KEY.trim());
const wallet = createWalletClient({ chain, transport, account });
const recordPath = join(root, "contracts/deployments/v3-testnet.json");
const rec = JSON.parse(readFileSync(recordPath, "utf8"));
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8"));
const VERIFIERS = ["0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85", "0xfF64E90dF724F7b59EC32a7d17baE9f1AbfD8642", account.address];

async function send(label, request) {
  if (rec.txs[label]) return pub.getTransactionReceipt({ hash: rec.txs[label] });
  const gas = await pub.estimateGas({ account, ...request });
  const hash = await wallet.sendTransaction({ ...request, gas: (gas * 115n) / 100n });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error(`${label} reverted ${hash}`);
  rec.txs[label] = hash; rec.gasUsed[label] = String(r.gasUsed); save();
  console.log(`${label}: ${hash} gasUsed ${r.gasUsed}`);
  return r;
}
if (!rec.quorumV2) {
  const q = art("AgentProofQuorum");
  const r = await send("deployAgentProofQuorumV2", { data: encodeDeployData({ abi: q.abi, bytecode: q.bytecode, args: [VERIFIERS, 2n] }) });
  rec.quorumV2 = { address: r.contractAddress.toLowerCase(), deployBlock: Number(r.blockNumber), verifiers: VERIFIERS, threshold: 2, replaces: rec.agentProofQuorum };
  save();
}
console.log("AgentProofQuorum v2", rec.quorumV2.address, rec.quorumV2.deployBlock);
if (process.argv.includes("--execute") && !rec.quorumV2.executionTx) {
  const fw = art("AgentFirewallV3").abi;
  const demo = parseAbi(["function deposit(uint256 agentId, uint256 amount)"]);
  const data = encodeFunctionData({ abi: fw, functionName: "execute", args: [BigInt(rec.migrated.firewallId), rec.demoProtocol, 0n, encodeFunctionData({ abi: demo, functionName: "deposit", args: [BigInt(rec.migrated.agentId), 100n] })] });
  const r = await send("executeDeposit100b", { to: rec.agentFirewallV3, data });
  const ev = r.logs.flatMap((l) => { try { return [decodeEventLog({ abi: fw, ...l })]; } catch { return []; } }).find((e) => e.eventName === "AgentAction");
  rec.quorumV2.executionTx = r.transactionHash; rec.quorumV2.executionId = ev.args.executionId; save();
  console.log("execution", ev.args.executionId);
}
