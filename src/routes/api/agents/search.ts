import { createFileRoute } from "@tanstack/react-router";
import { searchIndexedAgents, syncRegistrySafe } from "@/lib/chain/indexer.server";

export const Route = createFileRoute("/api/agents/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const query = new URL(request.url).searchParams.get("q") ?? "";
        await syncRegistrySafe();
        const agents = await searchIndexedAgents(query);
        return Response.json(
          { query, agents },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
