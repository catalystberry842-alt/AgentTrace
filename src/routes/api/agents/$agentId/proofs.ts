import { createFileRoute } from "@tanstack/react-router";
import { getIndexedAgent, syncRegistrySafe } from "@/lib/chain/indexer.server";
import { listProofsForAgent } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/agents/$agentId/proofs")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^\d+$/.test(params.agentId) || params.agentId === "0") {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        const proofs = await listProofsForAgent(params.agentId, true);
        return Response.json({ proofs }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
