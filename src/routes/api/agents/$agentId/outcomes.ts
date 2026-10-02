import { createFileRoute } from "@tanstack/react-router";
import { getIndexedAgent, syncRegistrySafe } from "@/lib/chain/indexer.server";
import { listAgentOutcomes } from "@/lib/chain/reputation.server";
import type { OutcomeStatus } from "@/lib/agents/types";

export const Route = createFileRoute("/api/agents/$agentId/outcomes")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        if (!/^\d+$/.test(params.agentId) || params.agentId === "0") {
          return Response.json({ error: "Agent not found." }, { status: 404 });
        }
        await syncRegistrySafe();
        const agent = await getIndexedAgent(params.agentId);
        if (!agent) return Response.json({ error: "Agent not found." }, { status: 404 });
        const url = new URL(request.url);
        const raw = url.searchParams.get("status");
        const status = raw === "verified" || raw === "failed" || raw === "unverifiable" ? (raw as OutcomeStatus) : undefined;
        if (raw && !status) return Response.json({ error: "Status must be verified, failed, or unverifiable." }, { status: 400 });
        const outcomes = await listAgentOutcomes(params.agentId, status);
        return Response.json(outcomes, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
