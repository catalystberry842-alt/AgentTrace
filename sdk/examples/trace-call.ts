// One call: route an agent action through AgentFirewall and get its AgentTrace proof.
//
//   AGENT_KEY=0x... FIREWALL_ID=4 node --experimental-strip-types sdk/examples/trace-call.ts
//
// AGENT_KEY must be the firewall's executor. The default target is DemoProtocol.deposit(agentId, 1),
// which the firewall must allow. Set NETWORK=monad-mainnet for mainnet (spends real MON).
import { encodeFunctionData, parseAbi } from "viem";
import { traceCall, type TraceNetwork } from "../src/index.ts";

const demo = "0x1664be58ee54af91c756428f466bad6e4f9911c3";
const agentId = BigInt(process.env.AGENT_ID ?? "6");

const result = await traceCall({
  network: (process.env.NETWORK ?? "monad-testnet") as TraceNetwork,
  signer: process.env.AGENT_KEY as `0x${string}`,
  firewallId: BigInt(process.env.FIREWALL_ID ?? "4"),
  target: demo,
  data: encodeFunctionData({
    abi: parseAbi(["function deposit(uint256 agentId, uint256 amount)"]),
    functionName: "deposit",
    args: [agentId, 1n],
  }),
});

console.log(JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
