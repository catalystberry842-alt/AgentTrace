import { createFileRoute } from "@tanstack/react-router";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { configuredRegistry, listIndexedAgents, syncRegistrySafe } from "@/lib/chain/indexer.server";

export const Route = createFileRoute("/api/agents/")({
  server: {
    handlers: {
      GET: async () => {
        const indexer = await syncRegistrySafe();
        const agents = await listIndexedAgents(100);
        return Response.json(
          {
            chainId: MONAD_TESTNET.chainId,
            registry: configuredRegistry(),
            indexer,
            agents,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
