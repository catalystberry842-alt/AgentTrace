// Real mainnet sessions for the WMON agent (agent and firewall from docs/agent-runs/wmon-mainnet.json).
//   1. SDK traceCall: WMON.deposit() with 0.01 MON  -> allowed, receipt-verified, anchored
//   2. MCP session (server.ts, AGENT_LIMITS cap on transfer amount):
//        agenttrace_policy; transfer 0.01 WMON back to the owner (allowed);
//        WMON.withdraw (not in policy -> FIREWALL_REJECTED, nothing sent);
//        transfer 1 WMON (above the off-chain cap -> POLICY_REJECTED, nothing sent)
//   3. SDK traceCall: deposit() with 0.03 MON -> above the onchain 0.02 MON per-call cap, nothing sent
//
//   AGENT_KEY=0x... npx tsx agents/wmon-agent/run-sessions.ts --confirm-mainnet
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, parseEther, toFunctionSelector, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { traceCall } from "../../sdk/src/index.ts";

if (!process.argv.includes("--confirm-mainnet")) throw new Error("Mainnet spends real MON. Re-run with --confirm-mainnet.");
const recordPath = fileURLToPath(new URL("../../docs/agent-runs/wmon-mainnet.json", import.meta.url));
const transcriptPath = fileURLToPath(new URL("../../docs/agent-runs/wmon-mainnet.md", import.meta.url));
const rec = JSON.parse(readFileSync(recordPath, "utf8"));
const save = () => writeFileSync(recordPath, `${JSON.stringify(rec, null, 2)}\n`);
const key = process.env.AGENT_KEY as Hex;
const owner = privateKeyToAccount(key).address;
const WMON = rec.wmon as `0x${string}`;
const firewallId = BigInt(rec.firewallId);
const wmonAbi = parseAbi(["function deposit() payable", "function transfer(address dst, uint256 wad) returns (bool)", "function withdraw(uint256 wad)"]);
const transferSel = toFunctionSelector("transfer(address,uint256)");
const limits = [{ selector: transferSel, target: WMON, argIndex: 1, maxAmount: parseEther("0.01") }];
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x), 2);
rec.sessions ??= {};

const out: string[] = [`# WMON Agent on Monad mainnet: real sessions`, ``, `Agent #${rec.agentId} (owner and executor ${owner}), firewall #${rec.firewallId}: target Wrapped MON \`${WMON}\` only, functions \`deposit()\` and \`transfer(address,uint256)\`, at most 0.02 MON per call and 0.05 MON per day. Off-chain cap: \`transfer\` amount at most 0.01 WMON. Every transaction below is real.`, ``];
const log = (s: string) => { out.push(s); console.log(s); };

async function sdk(label: string, title: string, input: { data: Hex; value?: bigint }) {
  const t0 = Date.now();
  try {
    const r = await traceCall({ network: "monad-mainnet", signer: key, firewallId, target: WMON, limits, verifyTimeoutMs: 120_000, ...input });
    rec.sessions[label] = { allowed: true, txHash: r.txHash, executionId: r.executionId, proofStatus: r.proofStatus, proofHash: r.proofHash, anchorTxHash: r.anchorTxHash };
    save();
    log(`## ${title}\n\n\`traceCall\` (${((Date.now() - t0) / 1000).toFixed(1)} s)\n\n\`\`\`json\n${json({ allowed: true, ...r })}\n\`\`\`\n`);
  } catch (e: any) {
    rec.sessions[label] = { allowed: false, code: e.code, message: e.message, sent: false };
    save();
    log(`## ${title}\n\n\`traceCall\` **Result: rejected, nothing sent.** (${((Date.now() - t0) / 1000).toFixed(1)} s)\n\n\`\`\`json\n${json({ allowed: false, code: e.code, message: e.message, sent: false })}\n\`\`\`\n`);
  }
}

// Session 1
if (!rec.sessions.deposit) await sdk("deposit", "Session 1 (SDK): wrap 0.01 MON with WMON.deposit()", { data: encodeFunctionData({ abi: wmonAbi, functionName: "deposit" }), value: parseEther("0.01") });

// Session 2 (MCP)
const server = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../mcp-firewall/server.ts", import.meta.url))], {
  env: { ...process.env, NETWORK: "monad-mainnet", AGENT_ID: String(rec.agentId), FIREWALL_ID: String(rec.firewallId), AGENT_KEY: key,
    AGENT_LIMITS: JSON.stringify([{ selector: "transfer(address,uint256)", target: WMON, argIndex: 1, maxAmount: parseEther("0.01").toString() }]) },
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map<number, (v: any) => void>();
createInterface({ input: server.stdout! }).on("line", (line) => { const m = JSON.parse(line); pending.get(m.id)?.(m); pending.delete(m.id); });
let next = 1;
const rpc = (method: string, params?: unknown): Promise<any> => { const id = next++; server.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`); return new Promise((r) => pending.set(id, r)); };
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scripted-agent", version: "1" } });
server.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
log(`## Session 2 (MCP): ${init.result.serverInfo.name}\n\nStarted ${new Date().toISOString()}\n\n> ${init.result.instructions}\n`);
const calls: Array<[string, string, Record<string, unknown>, string]> = [
  ["policy", "agenttrace_policy", {}, "The agent reads its own policy first."],
  ["transfer", "call_contract", { target: WMON, data: encodeFunctionData({ abi: wmonAbi, functionName: "transfer", args: [owner, parseEther("0.01")] }) }, "Return the 0.01 WMON from session 1 to the owner. Allowed: transfer is in the policy and 0.01 is at the off-chain cap."],
  ["withdraw", "call_contract", { target: WMON, data: encodeFunctionData({ abi: wmonAbi, functionName: "withdraw", args: [parseEther("0.01")] }) }, "WMON.withdraw is not in the policy. The firewall should reject it before anything is sent."],
  ["overcap", "call_contract", { target: WMON, data: encodeFunctionData({ abi: wmonAbi, functionName: "transfer", args: [owner, parseEther("1")] }) }, "Transfer 1 WMON: above the 0.01 off-chain cap, so the MCP server refuses it before simulation."],
];
for (const [label, name, args, note] of calls) {
  if (label === "transfer" && rec.sessions.mcpTransfer?.allowed) { log(`## tools/call \`${name}\` (transfer) already done: ${rec.sessions.mcpTransfer.txHash}\n`); continue; }
  const t0 = Date.now();
  const r = await rpc("tools/call", { name, arguments: args });
  const text = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
  log(`### tools/call \`${name}\` ${json(args).replace(/\s+/g, " ")}\n\n${note}${r.result?.isError ? " **Result: rejected, nothing sent.**" : ""} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n\n\`\`\`json\n${text}\n\`\`\`\n`);
  if (label !== "policy") {
    let parsed: any = {}; try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
    rec.sessions[`mcp${label[0].toUpperCase()}${label.slice(1)}`] = parsed.allowed ? { allowed: true, txHash: parsed.txHash, executionId: parsed.executionId, proofStatus: parsed.proofStatus, proofHash: parsed.proofHash, anchorTxHash: parsed.anchorTxHash } : { allowed: false, code: parsed.code, message: parsed.message, sent: false };
    save();
  }
}
server.kill();

// Session 3
await sdk("valueCap", "Session 3 (SDK): deposit() with 0.03 MON, above the 0.02 MON onchain per-call cap", { data: encodeFunctionData({ abi: wmonAbi, functionName: "deposit" }), value: parseEther("0.03") });

writeFileSync(transcriptPath, `${out.join("\n")}\n`);
