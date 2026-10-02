import { createFileRoute } from "@tanstack/react-router";
import { getIndexedAgent, syncRegistrySafe } from "@/lib/chain/indexer.server";
import { listFirewallsByAgent, syncFirewallSafe } from "@/lib/chain/firewall.server";

export const Route = createFileRoute("/api/agents/$agentId/firewall")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.agentId)) {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        await syncFirewallSafe();
        const firewalls = await listFirewallsByAgent(params.agentId);
        return Response.json({ firewalls }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
