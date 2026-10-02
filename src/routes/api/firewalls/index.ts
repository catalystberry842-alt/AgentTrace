import { createFileRoute } from "@tanstack/react-router";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { configuredFirewall, listIndexedFirewalls, syncFirewallSafe } from "@/lib/chain/firewall.server";

export const Route = createFileRoute("/api/firewalls/")({
  server: {
    handlers: {
      GET: async () => {
        const indexer = await syncFirewallSafe();
        const firewalls = await listIndexedFirewalls(100);
        return Response.json(
          {
            chainId: MONAD_TESTNET.chainId,
            firewall: configuredFirewall(),
            indexer,
            firewalls,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
