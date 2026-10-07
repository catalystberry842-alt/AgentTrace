import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { enforceLimits, validateLimits } from "./policy.ts";
import { traceCall } from "./trace.ts";

const abi = parseAbi(["function deposit(uint256 agentId, uint256 amount)", "function withdraw(uint256 agentId, uint256 amount)"]);
const DEMO = "0x1664be58ee54af91c756428f466bad6e4f9911c3";
const OTHER = "0x0000000000000000000000000000000000000abc";
const deposit = toFunctionSelector("deposit(uint256,uint256)");
const dep = (n: bigint) => encodeFunctionData({ abi, functionName: "deposit", args: [7n, n] });
const limits = [{ selector: deposit, argIndex: 1, maxAmount: 500n }];

test("allows at and below the cap", () => {
  enforceLimits(limits, DEMO, dep(500n));
  enforceLimits(limits, DEMO, dep(0n));
  enforceLimits(undefined, DEMO, dep(10n ** 30n));
  enforceLimits([], DEMO, dep(10n ** 30n));
});

test("rejects above the cap with POLICY_REJECTED", () => {
  assert.throws(() => enforceLimits(limits, DEMO, dep(501n)), (e: any) => e.code === "POLICY_REJECTED" && /501.*500/.test(e.message));
  assert.throws(() => enforceLimits(limits, DEMO, dep(2n ** 256n - 1n)), (e: any) => e.code === "POLICY_REJECTED");
});

test("other selectors and targets are not affected", () => {
  enforceLimits(limits, DEMO, encodeFunctionData({ abi, functionName: "withdraw", args: [7n, 10n ** 20n] }));
  const scoped = [{ ...limits[0], target: DEMO as `0x${string}` }];
  enforceLimits(scoped, OTHER, dep(10n ** 20n));
  assert.throws(() => enforceLimits(scoped, DEMO, dep(501n)), (e: any) => e.code === "POLICY_REJECTED");
  // target compare is checksum-insensitive
  assert.throws(() => enforceLimits(scoped, DEMO.toUpperCase().replace("0X", "0x") as `0x${string}`, dep(501n)), (e: any) => e.code === "POLICY_REJECTED");
});

test("truncated calldata cannot skip the check", () => {
  assert.throws(() => enforceLimits(limits, DEMO, dep(1n).slice(0, 10 + 64) as `0x${string}`), (e: any) => e.code === "POLICY_REJECTED" && /missing/.test(e.message));
  assert.throws(() => enforceLimits(limits, DEMO, "0x12"), (e: any) => e.code === "POLICY_REJECTED");
});

test("argIndex 0 and selector case", () => {
  const l = [{ selector: deposit.toUpperCase().replace("0X", "0x") as `0x${string}`, argIndex: 0, maxAmount: 6n }];
  assert.throws(() => enforceLimits(l, DEMO, dep(1n)), (e: any) => e.code === "POLICY_REJECTED");
});

test("bad rules are rejected", () => {
  for (const bad of [
    { selector: "0x1234", argIndex: 0, maxAmount: 1n },
    { selector: deposit, argIndex: -1, maxAmount: 1n },
    { selector: deposit, argIndex: 1.5, maxAmount: 1n },
    { selector: deposit, argIndex: 0, maxAmount: -1n },
    { selector: deposit, argIndex: 0, maxAmount: 1 as unknown as bigint },
    { selector: deposit, argIndex: 0, maxAmount: 1n, target: "0xnope" },
  ]) {
    assert.throws(() => validateLimits([bad as any]), (e: any) => e.code === "BAD_POLICY");
  }
});

test("traceCall checks limits before touching the network", async () => {
  await assert.rejects(
    traceCall({ network: "monad-testnet", signer: generatePrivateKey(), firewallId: 1, target: DEMO, data: dep(501n), limits, rpcUrl: "http://127.0.0.1:9" }),
    (e: any) => e.code === "POLICY_REJECTED",
  );
});

test("MCP server enforces AGENT_LIMITS and sends nothing", async () => {
  const server = join(import.meta.dirname, "../../../agents/mcp-firewall/server.ts");
  // The SDK uses TS parameter properties, so the server runs under tsx (as `npm run agent:mcp` does).
  const tsx = join(import.meta.dirname, "../../../node_modules/.bin/tsx");
  const child = spawn(tsx, [server], {
    env: { ...process.env, NETWORK: "monad-testnet", FIREWALL_ID: "1", AGENT_ID: "7", AGENT_KEY: generatePrivateKey(), AGENTTRACE_URL: "http://127.0.0.1:9", AGENT_LIMITS: JSON.stringify([{ selector: "deposit(uint256,uint256)", argIndex: 1, maxAmount: "500" }]) },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: any[] = [];
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); }
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "demo_deposit", arguments: { amount: 501 } } })}\n`);
  const deadline = Date.now() + 15_000;
  while (!lines.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  child.kill();
  assert.equal(lines.length, 1, "no MCP reply");
  const body = JSON.parse(lines[0].result.content[0].text);
  assert.equal(lines[0].result.isError, true);
  assert.equal(body.code, "POLICY_REJECTED");
  assert.equal(body.sent, false);
});
