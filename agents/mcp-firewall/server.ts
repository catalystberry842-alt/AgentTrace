// AgentTrace MCP server: gives any MCP client (Claude Desktop, Cursor, an Eliza or AgentKit host)
// onchain tools that can only act through an AgentTrace firewall.
//
// Every write goes through traceCall: simulated against AgentFirewall first (a blocked call sends
// nothing), then sent from the agent's executor key, then verified and anchored by AgentTrace.
//
// Env: AGENT_KEY (the firewall executor), FIREWALL_ID, AGENT_ID,
//      NETWORK=monad-mainnet | monad-testnet (default testnet), AGENTTRACE_URL (optional).
//
// Transport: MCP over stdio, newline-delimited JSON-RPC 2.0. No dependencies beyond viem.
import { createInterface } from "node:readline";
import { encodeFunctionData, isAddress, isHex, parseAbi } from "viem";
import { TRACE_NETWORKS, traceCall, type TraceNetwork } from "../../sdk/src/index.ts";

const network = (process.env.NETWORK ?? "monad-testnet") as TraceNetwork;
const net = TRACE_NETWORKS[network];
if (!net) throw new Error(`Unknown NETWORK ${network}`);
const appUrl = (process.env.AGENTTRACE_URL ?? net.appUrl).replace(/\/$/, "");
const firewallId = BigInt(process.env.FIREWALL_ID ?? "0");
const agentId = BigInt(process.env.AGENT_ID ?? "0");
const key = process.env.AGENT_KEY as `0x${string}` | undefined;
const DEMO = "0x1664be58ee54af91c756428f466bad6e4f9911c3" as const;
const demoAbi = parseAbi([
  "function deposit(uint256 agentId, uint256 amount)",
  "function withdraw(uint256 agentId, uint256 amount)",
]);

const tools = [
  {
    name: "agenttrace_policy",
    description: "Read this agent's AgentTrace firewall: which contracts and functions it may call, and value limits.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "demo_deposit",
    description: "Deposit an amount into DemoProtocol for this agent. Runs through the AgentTrace firewall and returns the verified proof.",
    inputSchema: { type: "object", properties: { amount: { type: "integer", minimum: 1 } }, required: ["amount"] },
  },
  {
    name: "demo_withdraw",
    description: "Withdraw an amount from DemoProtocol for this agent. Runs through the AgentTrace firewall.",
    inputSchema: { type: "object", properties: { amount: { type: "integer", minimum: 1 } }, required: ["amount"] },
  },
  {
    name: "call_contract",
    description: "Call any contract function with raw calldata through the AgentTrace firewall. Rejected unless the firewall allows the target and selector.",
    inputSchema: {
      type: "object",
      properties: { target: { type: "string" }, data: { type: "string" }, value: { type: "string", description: "wei" } },
      required: ["target", "data"],
    },
  },
];

function text(value: unknown, isError = false) {
  return { content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) }], isError };
}

async function guarded(target: `0x${string}`, data: `0x${string}`, value = 0n) {
  if (!key) return text("AGENT_KEY is not set, so this server cannot sign.", true);
  try {
    const result = await traceCall({ network, signer: key, firewallId, target, data, value, appUrl });
    return text({ allowed: true, ...result });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "ERROR";
    return text({ allowed: false, code, message: error instanceof Error ? error.message : String(error), sent: false }, true);
  }
}

async function callTool(name: string, args: Record<string, unknown>) {
  if (name === "agenttrace_policy") {
    const response = await fetch(`${appUrl}/api/firewalls/${firewallId}`);
    if (!response.ok) return text(`Firewall ${firewallId} is not indexed at ${appUrl}.`, true);
    const { firewall } = (await response.json()) as { firewall: Record<string, any> };
    return text({
      firewallId: firewall.id,
      agentId: firewall.agentId,
      status: firewall.status,
      executor: firewall.executor,
      allowValueTransfer: firewall.allowValueTransfer,
      allowedTargets: firewall.allowedTargets.filter((t: any) => t.active).map((t: any) => `${t.name || "contract"} ${t.target}`),
      allowedFunctions: firewall.allowedFunctions.filter((f: any) => f.active).map((f: any) => `${f.selector} on ${f.target}`),
      page: `${appUrl}/firewalls/${firewall.id}`,
    });
  }
  if (name === "demo_deposit" || name === "demo_withdraw") {
    const amount = BigInt(Number(args.amount ?? 0));
    if (amount < 1n) return text("amount must be a positive integer.", true);
    const functionName = name === "demo_deposit" ? "deposit" : "withdraw";
    return guarded(DEMO, encodeFunctionData({ abi: demoAbi, functionName, args: [agentId, amount] }));
  }
  if (name === "call_contract") {
    const target = String(args.target ?? "");
    const data = String(args.data ?? "");
    if (!isAddress(target) || !isHex(data)) return text("target must be an address and data hex calldata.", true);
    return guarded(target, data, args.value ? BigInt(String(args.value)) : 0n);
  }
  return null;
}

function reply(id: unknown, result?: unknown, error?: { code: number; message: string }) {
  process.stdout.write(`${JSON.stringify(error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result })}\n`);
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg: { id?: unknown; method?: string; params?: any };
  try {
    msg = JSON.parse(line);
  } catch {
    return reply(null, undefined, { code: -32700, message: "Parse error" });
  }
  const { id, method, params } = msg;
  if (id === undefined) return; // notification (e.g. notifications/initialized)
  try {
    if (method === "initialize") {
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "agenttrace-firewall", version: "0.1.0" },
        instructions: `Onchain tools for agent #${agentId} on ${network}. Every write is checked by AgentTrace firewall #${firewallId}; calls outside its policy are rejected and nothing is sent.`,
      });
    }
    if (method === "ping") return reply(id, {});
    if (method === "tools/list") return reply(id, { tools });
    if (method === "tools/call") {
      const result = await callTool(String(params?.name), params?.arguments ?? {});
      return result ? reply(id, result) : reply(id, undefined, { code: -32602, message: `Unknown tool ${params?.name}` });
    }
    reply(id, undefined, { code: -32601, message: `Method not found: ${method}` });
  } catch (error) {
    reply(id, undefined, { code: -32603, message: error instanceof Error ? error.message : String(error) });
  }
});
