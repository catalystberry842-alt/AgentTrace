// A scripted MCP client session against server.ts, the way an LLM host would drive it:
// initialize → list tools → read policy → deposit (allowed) → withdraw (not in policy).
// Prints the transcript as Markdown. All transactions are real.
//
//   AGENT_KEY=0x... AGENT_ID=2 FIREWALL_ID=2 NETWORK=monad-mainnet npx tsx agents/mcp-firewall/run-session.ts
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const server = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./server.ts", import.meta.url))], {
  env: process.env,
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map<number, (value: any) => void>();
createInterface({ input: server.stdout! }).on("line", (line) => {
  const msg = JSON.parse(line);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
let next = 1;
function rpc(method: string, params?: unknown): Promise<any> {
  const id = next++;
  server.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return new Promise((resolve) => pending.set(id, resolve));
}
const out: string[] = [];
const log = (s: string) => {
  out.push(s);
  console.log(s);
};
const body = (r: any) => r.result?.content?.[0]?.text ?? JSON.stringify(r.error);

const started = new Date();
const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "scripted-agent", version: "1" } });
server.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
log(`# MCP session: ${init.result.serverInfo.name}\n\nStarted ${started.toISOString()}\n\n> ${init.result.instructions}\n`);
const list = await rpc("tools/list");
log(`**tools/list** → ${list.result.tools.map((t: any) => `\`${t.name}\``).join(", ")}\n`);

for (const [name, args, note] of [
  ["agenttrace_policy", {}, "The agent reads its own policy first."],
  ["demo_deposit", { amount: 25 }, "Allowed by the policy."],
  ["demo_withdraw", { amount: 25 }, "Not in the policy. The firewall should reject it before anything is sent."],
] as const) {
  const t0 = Date.now();
  const r = await rpc("tools/call", { name, arguments: args });
  log(`## tools/call \`${name}\` ${JSON.stringify(args)}\n\n${note}${r.result?.isError ? " **Result: rejected.**" : ""} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n\n\`\`\`json\n${body(r)}\n\`\`\`\n`);
}
server.kill();
if (process.env.TRANSCRIPT) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.TRANSCRIPT, out.join("\n"));
}
