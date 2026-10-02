import { createFileRoute } from "@tanstack/react-router";
import { listAgentsWithHistory } from "@/lib/chain/reputation.server";

export const Route = createFileRoute("/api/reputation/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const offset = Number(url.searchParams.get("offset") ?? "0");
        const limit = Number(url.searchParams.get("limit") ?? "50");
        const page = await listAgentsWithHistory(
          Number.isFinite(limit) ? limit : 50,
          Number.isFinite(offset) ? offset : 0,
        );
        return Response.json(
          { agents: page.agents, total: page.total, limit: page.limit, offset: page.offset },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
