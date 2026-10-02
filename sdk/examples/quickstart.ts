import { AgentTrace } from "../src/index.ts";

// Replace these with the key shown once at creation and the origin of this AgentTrace app.
// Monad mainnet is rejected. No agent id is returned until a registry receipt is confirmed.
const agenttrace = new AgentTrace({
  apiKey: "<api key>",
  network: "monad-testnet",
  baseUrl: "<your AgentTrace origin>",
});

const agent = await agenttrace.agents.create({
  name: "Research Agent",
  description: "AI research agent",
  capabilities: ["Research", "Data"],
});

// status is failed, and agentId is null, until the registry is deployed and a real receipt is confirmed.
console.log(agent.status, agent.agentId, agent.transactionHash, agent.error?.code);
