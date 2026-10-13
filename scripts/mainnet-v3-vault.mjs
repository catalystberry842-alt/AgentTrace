/**
 * Monad MAINNET: deploy AgentFirewallV3 (per-agent vaults) from the ops wallet, create a vault firewall for
 * WMON Agent #003 (owned by the ops wallet) allowing only WMON.transfer with an onchain cap on the amount,
 * deposit a little WMON into the agent's vault, run one capped transfer out of the vault, and prove an
 * over-cap transfer is rejected (eth_call; no MON spent on the rejection).
 *
 *   OPS_KEY=0x... node scripts/mainnet-v3-vault.mjs --confirm-mainnet
 *
 * Resumable: contracts/deployments/mainnet-v3-vault.json is written after every confirmed tx.
 * Monad charges the gas limit, so every transaction uses estimateGas * 1.15. Aborts above SPEND_CAP.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, decodeErrorResult, decodeEventLog, defineChain, encodeDeployData,
  encodeFunctionData, formatEther, http, parseAbi, parseEther, toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

if (!process.argv.includes("--confirm-mainnet")) { console.error("Add --confirm-mainnet. Nothing sent."); process.exit(1); }
const root = join(import.meta.dirname, "..");
const recordPath = join(root, "contracts/deployments/mainnet-v3-vault.json");
const RPC = "https://rpc.monad.xyz";
const REGISTRY = "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const AGENT_ID = 3n;
const DEPOSIT = parseEther("0.001");
const CAP = parseEther("0.0005");
const SEND = parseEther("0.0004");
const OVER = parseEther("0.0009");
const SPEND_CAP = parseEther("0.45");
const chain = defineChain({ id: 143, name: "Monad mainnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const transport = http(RPC, { retryCount: 3, timeout: 30_000 });
const pub = createPublicClient({ chain, transport });
if ((await pub.getChainId()) !== 143) throw new Error("not mainnet");
const ops = privateKeyToAccount(process.env.OPS_KEY);
const wallet = createWalletClient({ chain, transport, account: ops });
const fw = JSON.parse(readFileSync(join(root, "contracts/out/AgentFirewallV3.json"), "utf8"));
const wmonAbi = parseAbi(["function deposit() payable", "function transfer(address dst, uint256 wad) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
const TRANSFER = toFunctionSelector("transfer(address,uint256)");
const rec = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { chainId: 143, network: "Monad mainnet", registry: REGISTRY, wmon: WMON, agentId: "3", owner: ops.address, txs: {}, gas: {} };
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const ex = (h) => `https://monadvision.com/tx/${h}`;
rec.startBalance ??= String(await pub.getBalance({ address: ops.address })); save();
const spent = async () => BigInt(rec.startBalance) - (await pub.getBalance({ address: ops.address }));
const events = (r) => r.logs.flatMap((l) => { try { return [decodeEventLog({ abi: fw.abi, ...l })]; } catch { return []; } });

async function send(label, req) {
  if (rec.txs[label]) { console.log(`${label}: done`); return pub.getTransactionReceipt({ hash: rec.txs[label] }); }
  if ((await spent()) > SPEND_CAP) throw new Error("spend cap reached, stopping");
  const gas = ((await pub.estimateGas({ account: ops, ...req })) * 115n) / 100n;
  const hash = await wallet.sendTransaction({ ...req, gas });
  rec.txs[label] = hash; save();
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  rec.gas[label] = { limit: String(gas), used: String(r.gasUsed), price: String(r.effectiveGasPrice), status: r.status, block: String(r.blockNumber) }; save();
  console.log(`${label}: ${r.status} ${ex(hash)}`);
  if (r.status !== "success") throw new Error(`${label} reverted`);
  return r;
}

if (!rec.agentFirewallV3) {
  const r = await send("deployAgentFirewallV3", { data: encodeDeployData({ abi: fw.abi, bytecode: fw.bytecode, args: [REGISTRY] }) });
  rec.agentFirewallV3 = r.contractAddress.toLowerCase(); rec.deployBlock = String(r.blockNumber); save();
}
const FW = rec.agentFirewallV3;
if (!rec.firewallId) {
  const r = await send("createFirewallWithPermissions", { to: FW, data: encodeFunctionData({ abi: fw.abi, functionName: "createFirewallWithPermissions",
    args: [AGENT_ID, ops.address, 0n, false, 0n, 0n, 86_400n, [{ target: WMON, name: "WMON", selectors: [TRANSFER] }]] }) });
  const ev = events(r);
  rec.firewallId = String(ev.find((e) => e.eventName === "FirewallCreated").args.firewallId);
  rec.vault = ev.find((e) => e.eventName === "VaultCreated").args.vault; save();
}
const id = BigInt(rec.firewallId);
await send("setArgCapTransferAmount", { to: FW, data: encodeFunctionData({ abi: fw.abi, functionName: "setArgCap", args: [id, WMON, TRANSFER, 1, CAP] }) });
await send("wrapMON", { to: WMON, value: DEPOSIT, data: encodeFunctionData({ abi: wmonAbi, functionName: "deposit" }) });
await send("vaultDepositWMON", { to: WMON, data: encodeFunctionData({ abi: wmonAbi, functionName: "transfer", args: [rec.vault, DEPOSIT] }) });
const r = await send("executeCappedTransfer", { to: FW, data: encodeFunctionData({ abi: fw.abi, functionName: "execute",
  args: [id, WMON, 0n, encodeFunctionData({ abi: wmonAbi, functionName: "transfer", args: [ops.address, SEND] })] }) });
rec.allowed = { amountWei: String(SEND), capWei: String(CAP), executionId: events(r).find((e) => e.eventName === "AgentAction")?.args.executionId };
try {
  await pub.call({ account: ops, to: FW, data: encodeFunctionData({ abi: fw.abi, functionName: "execute",
    args: [id, WMON, 0n, encodeFunctionData({ abi: wmonAbi, functionName: "transfer", args: [ops.address, OVER] })] }) });
  rec.rejected = { amountWei: String(OVER), result: "UNEXPECTED: call succeeded" };
} catch (e) {
  const data = e.walk?.((x) => typeof x?.data === "string")?.data ?? e.data;
  let err = String(e.shortMessage ?? e.message).slice(0, 200);
  try { const d = decodeErrorResult({ abi: fw.abi, data }); err = `${d.errorName}(${d.args.join(", ")})`; } catch { /* not a known custom error: keep the raw revert data */ }
  rec.rejected = { amountWei: String(OVER), capWei: String(CAP), sent: false, checkedBy: "eth_call", error: err };
}
rec.vaultWMON = String(await pub.readContract({ address: WMON, abi: wmonAbi, functionName: "balanceOf", args: [rec.vault] }));
rec.opsSpentWei = String(await spent()); rec.opsSpentMON = formatEther(BigInt(rec.opsSpentWei)); save();
console.log(JSON.stringify({ fw: FW, firewallId: rec.firewallId, vault: rec.vault, rejected: rec.rejected, vaultWMON: rec.vaultWMON, spent: rec.opsSpentMON }, null, 1));
