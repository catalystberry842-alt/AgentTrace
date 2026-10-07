/**
 * Mainnet setup for the WMON agent: register an agent owned by the signing wallet, create a
 * firewall whose only target is canonical Wrapped MON, allow deposit() and transfer(address,uint256),
 * and allow small MON value (0.02 MON per transaction, 0.05 MON per day). Executor = the owner wallet.
 *
 *   AGENT_KEY=0x... node agents/wmon-agent/setup.mjs --confirm-mainnet
 *
 * Resumable: confirmed hashes are written to docs/agent-runs/wmon-mainnet.json (public data only).
 * WMON: 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A, docs.monad.xyz network information, "Canonical Contracts".
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeFunctionData, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

if (!process.argv.includes("--confirm-mainnet")) { console.error("Mainnet spends real MON. Re-run with --confirm-mainnet. Nothing was sent."); process.exit(1); }
const root = join(import.meta.dirname, "../..");
const recordPath = join(root, "docs/agent-runs/wmon-mainnet.json");
const REGISTRY = "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e";
const FIREWALL = "0x694178a2396b54bff6a25caa0aa9cca6eb079441";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const MIN_BALANCE = parseEther(process.env.MIN_BALANCE ?? "0.4"); // stop before spending past the budget
const account = privateKeyToAccount(process.env.AGENT_KEY);
const chain = defineChain({ id: 143, name: "Monad", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } } });
const pub = createPublicClient({ chain, transport: http(undefined, { retryCount: 3 }) });
const wallet = createWalletClient({ chain, transport: http(undefined, { retryCount: 3 }), account });
if ((await pub.getChainId()) !== 143) throw new Error("not Monad mainnet");
const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8")).abi;
const registryAbi = art("AgentRegistry");
const firewallAbi = art("AgentFirewall");
const rec = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { chainId: 143, owner: account.address, executor: account.address, wmon: WMON, txs: {} };
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const link = (h) => `https://monadvision.com/tx/${h}`;
console.log("wallet", account.address, formatEther(await pub.getBalance({ address: account.address })), "MON");

async function send(label, to, data) {
  if (rec.txs[label]) { console.log(`${label}: already ${link(rec.txs[label])}`); return pub.getTransactionReceipt({ hash: rec.txs[label] }); }
  const bal = await pub.getBalance({ address: account.address });
  if (bal < MIN_BALANCE) throw new Error(`balance ${formatEther(bal)} below budget floor; stopping`);
  const gas = await pub.estimateGas({ account, to, data });
  const hash = await wallet.sendTransaction({ to, data, gas: (gas * 115n) / 100n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted ${hash}`);
  rec.txs[label] = hash; save();
  console.log(`${label}: ${link(hash)} gasUsed ${r.gasUsed} fee ${formatEther(r.gasUsed * r.effectiveGasPrice)} MON`);
  return r;
}
const events = (r, abi, addr) => r.logs.filter((l) => l.address.toLowerCase() === addr).flatMap((l) => { try { return [decodeEventLog({ abi, data: l.data, topics: l.topics })]; } catch { return []; } });

const reg = await send("registerAgent", REGISTRY, encodeFunctionData({ abi: registryAbi, functionName: "registerAgent", args: [
  "WMON Agent",
  "Wraps MON into canonical Wrapped MON (WMON) and returns it, only through its AgentTrace firewall: WMON deposit() and transfer() only, at most 0.02 MON per call.",
  "", 1n,
] }));
rec.agentId ??= String(events(reg, registryAbi, REGISTRY).find((e) => e.eventName === "AgentRegistered").args.agentId); save();
const agentId = BigInt(rec.agentId);
const owner = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: "getAgentOwner", args: [agentId] });
if (owner.toLowerCase() !== account.address.toLowerCase()) throw new Error("agent owner mismatch");

const cf = await send("createFirewall", FIREWALL, encodeFunctionData({ abi: firewallAbi, functionName: "createFirewall", args: [agentId, account.address, true, parseEther("0.02"), parseEther("0.05"), 86_400n] }));
rec.firewallId ??= String(events(cf, firewallAbi, FIREWALL).find((e) => e.eventName === "FirewallCreated").args.firewallId); save();
const firewallId = BigInt(rec.firewallId);
await send("allowTarget", FIREWALL, encodeFunctionData({ abi: firewallAbi, functionName: "allowTarget", args: [firewallId, WMON, "Wrapped MON (WMON)"] }));
await send("allowFunctionDeposit", FIREWALL, encodeFunctionData({ abi: firewallAbi, functionName: "allowFunction", args: [firewallId, WMON, "0xd0e30db0"] }));
await send("allowFunctionTransfer", FIREWALL, encodeFunctionData({ abi: firewallAbi, functionName: "allowFunction", args: [firewallId, WMON, "0xa9059cbb"] }));
for (const sel of ["0xd0e30db0", "0xa9059cbb", "0x2e1a7d4d"]) console.log("allowed", sel, await pub.readContract({ address: FIREWALL, abi: firewallAbi, functionName: "isFunctionAllowed", args: [firewallId, WMON, sel] }));
console.log("policy", await pub.readContract({ address: FIREWALL, abi: firewallAbi, functionName: "getPolicy", args: [firewallId] }));
console.log(`agent #${rec.agentId}, firewall #${rec.firewallId}; balance ${formatEther(await pub.getBalance({ address: account.address }))} MON`);
