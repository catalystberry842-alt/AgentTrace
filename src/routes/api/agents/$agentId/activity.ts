import { createFileRoute } from "@tanstack/react-router";
import { listActionsByAgent, syncFirewallSafe } from "@/lib/chain/firewall.server";
import { getIndexedAgent, syncRegistrySafe } from "@/lib/chain/indexer.server";

export const Route = createFileRoute("/api/agents/$agentId/activity")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^\d+$/.test(params.agentId) || params.agentId === "0") {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        await syncFirewallSafe();
        const activity = await listActionsByAgent(params.agentId);
        return Response.json({ activity }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
