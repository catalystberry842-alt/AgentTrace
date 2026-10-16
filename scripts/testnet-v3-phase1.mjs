#!/usr/bin/env node
/**
 * Phase 1 (testnet only) follow-up to deploy-v3.mjs: rotate the V3 smoke firewall's session
 * executor to the owner wallet, add caps, execute deposit(agentId, 100), fund the second verifier.
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... node scripts/testnet-v3-phase1.mjs [--rpc URL]
 * Resumable via contracts/deployments/v3-testnet.json. Refuses any chain other than 10143.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, http, parseAbi, parseEther, toFunctionSelector } from "viem";
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
const fw = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewallV3.json"), "utf8")).abi;
const DEMO = rec.demoProtocol;
const DEPOSIT = toFunctionSelector("deposit(uint256,uint256)");
rec.gasUsed ??= {};

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
const decode = (r) => r.logs.flatMap((l) => { try { return [decodeEventLog({ abi: fw, ...l })]; } catch { return []; } });

if (!rec.migrated) {
  const setup = await pub.getTransactionReceipt({ hash: rec.txs.createFirewallWithPermissions });
  const ev = decode(setup);
  const firewallId = ev.find((e) => e.eventName === "FirewallCreated").args.firewallId;
  const agentId = ev.find((e) => e.eventName === "FirewallCreated").args.agentId;
  const vault = ev.find((e) => e.eventName === "VaultCreated").args.vault;
  const until = BigInt(Math.floor(Date.now() / 1000) + 30 * 86_400);
  const call = (functionName, args) => ({ to: rec.agentFirewallV3, data: encodeFunctionData({ abi: fw, functionName, args }) });
  await send("setSessionExecutor", call("setSessionExecutor", [firewallId, account.address, until]));
  await send("setArgCap", call("setArgCap", [firewallId, DEMO, DEPOSIT, 1, 500n]));
  await send("setArgPeriodCap", call("setArgPeriodCap", [firewallId, DEMO, DEPOSIT, 1000n]));
  const demo = parseAbi(["function deposit(uint256 agentId, uint256 amount)"]);
  const r = await send("executeDeposit100", call("execute", [firewallId, DEMO, 0n, encodeFunctionData({ abi: demo, functionName: "deposit", args: [agentId, 100n] })]));
  const action = decode(r).find((e) => e.eventName === "AgentAction");
  rec.migrated = { agentId: String(agentId), firewallId: String(firewallId), vault, executor: account.address, executorValidUntil: Number(until), argCap: "deposit amount <= 500", argPeriodCap: "1000 per period", executionId: action.args.executionId, executionTx: r.transactionHash };
  save();
}
const second = rec.quorum.verifiers[1];
if (!rec.txs.fundSecondVerifier) {
  const hash = await wallet.sendTransaction({ to: second, value: parseEther("0.3") });
  const r = await pub.waitForTransactionReceipt({ hash });
  rec.txs.fundSecondVerifier = hash; rec.gasUsed.fundSecondVerifier = String(r.gasUsed); save();
  console.log(`funded ${second} 0.3 MON: ${hash}`);
}
console.log(JSON.stringify(rec.migrated));
