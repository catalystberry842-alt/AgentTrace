import { createFileRoute } from "@tanstack/react-router";
import { getIndexedAgent, listAgentEvents, syncRegistrySafe } from "@/lib/chain/indexer.server";

export const Route = createFileRoute("/api/agents/$agentId/events")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^\d+$/.test(params.agentId) || params.agentId === "0") {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        const events = await listAgentEvents(params.agentId, 100);
        return Response.json(
          { agentId: params.agentId, events },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
