import { createFileRoute } from "@tanstack/react-router";
import { getIndexedFirewall, syncFirewallSafe } from "@/lib/chain/firewall.server";

export const Route = createFileRoute("/api/firewalls/$firewallId/functions")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.firewallId)) {
          return Response.json({ error: "Firewall not found." }, { status: 404 });
        }
        await syncFirewallSafe();
        const firewall = await getIndexedFirewall(params.firewallId);
        if (!firewall) return Response.json({ error: "Firewall not found." }, { status: 404 });
        return Response.json(
          { firewallId: firewall.id, functions: firewall.allowedFunctions },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
