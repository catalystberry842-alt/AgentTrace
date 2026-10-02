import { createFileRoute } from "@tanstack/react-router";
import { listAgentsByOwner, syncRegistrySafe } from "@/lib/chain/indexer.server";

export const Route = createFileRoute("/api/agents/owner/$address")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const address = params.address;
        if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
          return Response.json({ error: "Invalid address." }, { status: 400 });
        }
        await syncRegistrySafe();
        const agents = await listAgentsByOwner(address);
        return Response.json(
          { owner: address.toLowerCase(), agents },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
