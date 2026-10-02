import { createFileRoute } from "@tanstack/react-router";
import { getIndexedAgent, syncRegistrySafe } from "@/lib/chain/indexer.server";
import { deriveAgentReputation } from "@/lib/chain/reputation.server";

export const Route = createFileRoute("/api/agents/$agentId/reputation")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.agentId)) {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        const reputation = await deriveAgentReputation(params.agentId);
        return Response.json(reputation, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
