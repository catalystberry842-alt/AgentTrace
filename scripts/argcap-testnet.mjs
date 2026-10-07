/**
 * Deploy AgentFirewallV2 to Monad TESTNET (pointing at the existing AgentRegistry) and run the
 * argument-cap demo against the existing DemoProtocol:
 *   register agent -> create V2 firewall -> allow DemoProtocol.deposit -> setArgCap(amount <= 500)
 *   -> execute deposit(100) (sent, must succeed) -> deposit(900) (simulated, must revert ArgumentTooHigh, not sent).
 *
 *   MONAD_DEPLOYER_PRIVATE_KEY=0x... node scripts/argcap-testnet.mjs
 *
 * Testnet only. Resumable: state is written to contracts/deployments/firewall-v2-testnet.json after each step.
 * Monad charges the gas limit, so each transaction uses estimateGas * 1.2.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, decodeEventLog, defineChain,
  encodeDeployData, encodeFunctionData, formatEther, http, parseAbi, toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const root = join(import.meta.dirname, "..");
const recordPath = join(root, "contracts/deployments/firewall-v2-testnet.json");
const REGISTRY = "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e";
const DEMO = "0x1664be58ee54af91c756428f466bad6e4f9911c3";
const RPC = process.env.MONAD_DEPLOY_RPC_URL ?? "https://testnet-rpc.monad.xyz";
const key = process.env.MONAD_DEPLOYER_PRIVATE_KEY;
if (!key) { console.error("MONAD_DEPLOYER_PRIVATE_KEY is not set. Nothing was sent."); process.exit(1); }
const account = privateKeyToAccount(key);
const chain = defineChain({ id: 10143, name: "Monad testnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { retryCount: 3 }) });
const wallet = createWalletClient({ chain, transport: http(RPC, { retryCount: 3 }), account });
if ((await pub.getChainId()) !== 10143) throw new Error("RPC is not Monad testnet");

const v2 = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewallV2.json"), "utf8"));
const registryAbi = JSON.parse(readFileSync(join(root, "contracts/out/AgentRegistry.json"), "utf8")).abi;
const demoAbi = parseAbi(["function deposit(uint256 agentId, uint256 amount)", "event Deposited(uint256 indexed agentId, uint256 amount)"]);
const deposit = toFunctionSelector("deposit(uint256,uint256)");
const rec = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { chainId: 10143, network: "Monad testnet", registry: REGISTRY, demoProtocol: DEMO, txs: {} };
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const ex = (h) => `https://testnet.monadvision.com/tx/${h}`;
console.log("sender", account.address, "balance", formatEther(await pub.getBalance({ address: account.address })), "MON");

async function send(label, req) {
  if (rec.txs[label]) { console.log(`${label}: done ${ex(rec.txs[label])}`); return pub.getTransactionReceipt({ hash: rec.txs[label] }); }
  const gas = await pub.estimateGas({ account, ...req });
  const hash = await wallet.sendTransaction({ ...req, gas: (gas * 120n) / 100n });
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  rec.txs[label] = hash; save();
  console.log(`${label}: ${ex(hash)} (gas ${r.gasUsed})`);
  return r;
}
const logsOf = (r, abi, address) => r.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()).flatMap((l) => { try { return [decodeEventLog({ abi, data: l.data, topics: l.topics })]; } catch { return []; } });

// 1. deploy
const dep = await send("deployAgentFirewallV2", { data: encodeDeployData({ abi: v2.abi, bytecode: v2.bytecode, args: [REGISTRY] }) });
rec.agentFirewallV2 ??= dep.contractAddress; save();
const FW = rec.agentFirewallV2;
if (!(await pub.getCode({ address: FW }))) throw new Error("no bytecode at V2");
console.log("AgentFirewallV2", FW);
// 2. register agent
const reg = await send("registerAgent", { to: REGISTRY, data: encodeFunctionData({ abi: registryAbi, functionName: "registerAgent", args: ["ArgCap Agent", "AgentFirewallV2 demo: DemoProtocol.deposit with amount capped onchain at 500.", "", 1n] }) });
rec.agentId ??= String(logsOf(reg, registryAbi, REGISTRY).find((e) => e.eventName === "AgentRegistered").args.agentId); save();
const agentId = BigInt(rec.agentId);
// 3. firewall (executor = this wallet, no value transfers)
const cf = await send("createFirewall", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "createFirewall", args: [agentId, account.address, false, 0n, 0n, 86_400n] }) });
rec.firewallId ??= String(logsOf(cf, v2.abi, FW).find((e) => e.eventName === "FirewallCreated").args.firewallId); save();
const firewallId = BigInt(rec.firewallId);
await send("allowTarget", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "allowTarget", args: [firewallId, DEMO, "AgentTrace Demo Protocol"] }) });
await send("allowFunction", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "allowFunction", args: [firewallId, DEMO, deposit] }) });
await send("setArgCap", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "setArgCap", args: [firewallId, DEMO, deposit, 1, 500n] }) });
const cap = await pub.readContract({ address: FW, abi: v2.abi, functionName: "getArgCap", args: [firewallId, DEMO, deposit] });
console.log("onchain cap", cap);
if (!cap.enabled || cap.argIndex !== 1 || cap.maxValue !== 500n) throw new Error("cap not set");
// 4. allowed call
const execData = (amount) => encodeFunctionData({ abi: v2.abi, functionName: "execute", args: [firewallId, DEMO, 0n, encodeFunctionData({ abi: demoAbi, functionName: "deposit", args: [agentId, amount] })] });
const ok = await send("executeDeposit100", { to: FW, data: execData(100n) });
const action = logsOf(ok, v2.abi, FW).find((e) => e.eventName === "AgentAction");
const deposited = logsOf(ok, demoAbi, DEMO).find((e) => e.eventName === "Deposited");
if (!action || !deposited || deposited.args.amount !== 100n) throw new Error("expected AgentAction + Deposited(100)");
rec.allowedExecutionId = action.args.executionId; save();
console.log("AgentAction executionId", action.args.executionId, "Deposited", deposited.args.amount);
// 5. blocked call: simulate only
try {
  await pub.simulateContract({ account, address: FW, abi: v2.abi, functionName: "execute", args: [firewallId, DEMO, 0n, encodeFunctionData({ abi: demoAbi, functionName: "deposit", args: [agentId, 900n] })] });
  throw new Error("deposit(900) was NOT rejected");
} catch (e) {
  const rev = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  if (rev?.data?.errorName !== "ArgumentTooHigh") throw e;
  rec.blockedSimulation = { amount: "900", error: `ArgumentTooHigh(${rev.data.args.map(String).join(", ")})`, sent: false, checkedAt: new Date().toISOString() }; save();
  console.log("deposit(900) rejected onchain in simulation:", rec.blockedSimulation.error, "- nothing sent");
}
console.log("balance left", formatEther(await pub.getBalance({ address: account.address })), "MON");
