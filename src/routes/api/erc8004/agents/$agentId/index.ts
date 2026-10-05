import { createFileRoute } from "@tanstack/react-router";
import { syncRegistrySafe } from "@/lib/chain/indexer.server";

/** ERC-8004 registration file (agentURI) for an AgentTrace agent. */
export const Route = createFileRoute("/api/erc8004/agents/$agentId/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.agentId)) return Response.json({ error: "Agent not found." }, { status: 404 });
        await syncRegistrySafe().catch(() => undefined);
        const { registrationFile } = await import("@/lib/chain/erc8004.server");
        const file = await registrationFile(params.agentId);
        if (!file) return Response.json({ error: "Agent not found." }, { status: 404 });
        return Response.json(file, { headers: { "cache-control": "public, max-age=60", "access-control-allow-origin": "*" } });
      },
    },
  },
});
