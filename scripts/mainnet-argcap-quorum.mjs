/**
 * Monad MAINNET: deploy AgentFirewallV2 (argument caps) and AgentProofQuorum (2-of-2 verifiers),
 * point WMON Agent #003 at a V2 firewall that caps WMON.approve amount onchain, run one approve that
 * passes and SEND one approve above the cap (it reverts onchain with ArgumentTooHigh), then anchor the
 * passing execution through the quorum with two independent verifier keys.
 *
 *   OPS_KEY=0x... V1_KEY=0x... V2_KEY=0x... node scripts/mainnet-argcap-quorum.mjs --confirm-mainnet
 *
 * Resumable: contracts/deployments/mainnet-v2-quorum.json is written after every confirmed tx.
 * Monad charges the gas limit, so every transaction uses estimateGas * 1.15. Aborts above SPEND_CAP.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, decodeEventLog, defineChain, encodeDeployData, encodeFunctionData,
  formatEther, http, parseAbi, parseEther, toFunctionSelector,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyProof } from "./verify-proof.mjs";

if (!process.argv.includes("--confirm-mainnet")) { console.error("Add --confirm-mainnet. Nothing sent."); process.exit(1); }
const root = join(import.meta.dirname, "..");
const recordPath = join(root, "contracts/deployments/mainnet-v2-quorum.json");
const RPC = "https://rpc.monad.xyz";
const REGISTRY = "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e";
const WMON = "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A";
const AGENT_ID = 3n; // WMON Agent #003, owned by the ops wallet
const CAP = parseEther("0.001");
const SPEND_CAP = parseEther("0.5");
const chain = defineChain({ id: 143, name: "Monad mainnet", nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const transport = http(RPC, { retryCount: 3, timeout: 30_000 });
const pub = createPublicClient({ chain, transport });
if ((await pub.getChainId()) !== 143) throw new Error("not mainnet");
const ops = privateKeyToAccount(process.env.OPS_KEY);
const va = privateKeyToAccount(process.env.V1_KEY);
const vb = privateKeyToAccount(process.env.V2_KEY);
const w = (a) => createWalletClient({ chain, transport, account: a });
const art = (n) => JSON.parse(readFileSync(join(root, `contracts/out/${n}.json`), "utf8"));
const v2 = art("AgentFirewallV2"), q = art("AgentProofQuorum");
const wmonAbi = parseAbi(["function approve(address spender, uint256 amount) returns (bool)", "event Approval(address indexed src, address indexed guy, uint256 wad)"]);
const APPROVE = toFunctionSelector("approve(address,uint256)");
const rec = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { chainId: 143, network: "Monad mainnet", registry: REGISTRY, wmon: WMON, agentId: "3", txs: {}, gas: {} };
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const ex = (h) => `https://monadvision.com/tx/${h}`;
rec.startBalance ??= String(await pub.getBalance({ address: ops.address })); save();
const opsSpent = async () => BigInt(rec.startBalance) - (await pub.getBalance({ address: ops.address }));
console.log("ops", ops.address, "verifiers", va.address, vb.address);

async function send(label, req, account = ops, fixedGas) {
  if (rec.txs[label]) { console.log(`${label}: done ${ex(rec.txs[label])}`); return pub.getTransactionReceipt({ hash: rec.txs[label] }); }
  if (account === ops && (await opsSpent()) > SPEND_CAP) throw new Error("spend cap reached, stopping");
  const gas = fixedGas ?? ((await pub.estimateGas({ account, ...req })) * 115n) / 100n;
  const hash = await w(account).sendTransaction({ ...req, gas });
  rec.txs[label] = hash; save();
  const r = await pub.waitForTransactionReceipt({ hash });
  rec.gas[label] = { limit: String(gas), used: String(r.gasUsed), price: String(r.effectiveGasPrice), status: r.status, block: String(r.blockNumber) }; save();
  console.log(`${label}: ${r.status} ${ex(hash)} gasUsed ${r.gasUsed} limit ${gas}`);
  if (r.status !== "success" && !fixedGas) throw new Error(`${label} reverted`);
  return r;
}
const logsOf = (r, abi, address) => r.logs.filter((l) => l.address.toLowerCase() === address.toLowerCase()).flatMap((l) => { try { return [decodeEventLog({ abi, data: l.data, topics: l.topics })]; } catch { return []; } });

// 1. AgentFirewallV2
const d1 = await send("deployAgentFirewallV2", { data: encodeDeployData({ abi: v2.abi, bytecode: v2.bytecode, args: [REGISTRY] }) });
rec.agentFirewallV2 ??= d1.contractAddress; save();
const FW = rec.agentFirewallV2;
// 2. AgentProofQuorum, 2-of-2 new verifier keys, owned by ops
const d2 = await send("deployAgentProofQuorum", { data: encodeDeployData({ abi: q.abi, bytecode: q.bytecode, args: [[va.address, vb.address], 2n] }) });
rec.agentProofQuorum ??= d2.contractAddress; rec.verifiers = [va.address, vb.address]; rec.threshold = 2; save();
const Q = rec.agentProofQuorum;
// 3. V2 firewall for agent #003: executor = ops, no value transfers, WMON.approve only, amount <= 0.001 WMON
const cf = await send("createFirewall", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "createFirewall", args: [AGENT_ID, ops.address, false, 0n, 0n, 86_400n] }) });
rec.firewallId ??= String(logsOf(cf, v2.abi, FW).find((e) => e.eventName === "FirewallCreated").args.firewallId); save();
const fid = BigInt(rec.firewallId);
await send("allowTarget", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "allowTarget", args: [fid, WMON, "Wrapped MON"] }) });
await send("allowFunction", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "allowFunction", args: [fid, WMON, APPROVE] }) });
await send("setArgCap", { to: FW, data: encodeFunctionData({ abi: v2.abi, functionName: "setArgCap", args: [fid, WMON, APPROVE, 1, CAP] }) });
const exec = (amt) => encodeFunctionData({ abi: v2.abi, functionName: "execute", args: [fid, WMON, 0n, encodeFunctionData({ abi: wmonAbi, functionName: "approve", args: [ops.address, amt] })] });
// 4. allowed: approve 0.0005 WMON
const ok = await send("executeApproveAllowed", { to: FW, data: exec(parseEther("0.0005")) });
const action = logsOf(ok, v2.abi, FW).find((e) => e.eventName === "AgentAction");
const appr = logsOf(ok, wmonAbi, WMON).find((e) => e.eventName === "Approval");
rec.allowed = { amountWei: String(parseEther("0.0005")), executionId: action.args.executionId, approvalWad: String(appr.args.wad) }; save();
// 5. rejected: approve 0.005 WMON, SENT with a fixed gas limit so the onchain revert is recorded
const bad = await send("executeApproveOverCap", { to: FW, data: exec(parseEther("0.005")) }, ops, 120_000n);
if (bad.status === "success") throw new Error("over-cap call was NOT rejected");
try { await pub.call({ account: ops.address, to: FW, data: exec(parseEther("0.005")), blockNumber: bad.blockNumber - 1n }); } catch (e) { rec.rejected = { amountWei: String(parseEther("0.005")), capWei: String(CAP), reason: e.shortMessage?.slice(0, 200) ?? String(e).slice(0, 200) }; save(); }
// 6. quorum anchor of the allowed execution
const pr = await verifyProof({ id: rec.txs.executeApproveAllowed, chain: "mainnet", firewall: FW, proof: Q, requireAnchor: false, log: () => {} });
rec.quorumProofHash = pr.proofHash; save();
const anchorArgs = [pr.proofHash, action.args.executionId, AGENT_ID, fid, rec.txs.executeApproveAllowed];
for (const [lbl, v] of [["fundVerifierA", va], ["fundVerifierB", vb]]) {
  const need = ((await pub.estimateGas({ account: v.address, to: Q, data: encodeFunctionData({ abi: q.abi, functionName: "attest", args: anchorArgs }) }).catch(() => 250_000n)) * 140n / 100n) * (await pub.getGasPrice()) * 12n / 10n;
  const bal = await pub.getBalance({ address: v.address });
  if (bal < need) await send(lbl, { to: v.address, value: need - bal });
}
await send("attestVerifierA", { to: Q, data: encodeFunctionData({ abi: q.abi, functionName: "attest", args: anchorArgs }) }, va);
await send("attestVerifierB", { to: Q, data: encodeFunctionData({ abi: q.abi, functionName: "attest", args: anchorArgs }) }, vb);
rec.quorumAnchored = await pub.readContract({ address: Q, abi: q.abi, functionName: "isAnchored", args: [action.args.executionId] }); save();
rec.opsSpentWei = String(await opsSpent()); rec.opsSpentMON = formatEther(BigInt(rec.opsSpentWei)); save();
console.log("anchored", rec.quorumAnchored, "ops spent", rec.opsSpentMON, "MON");
