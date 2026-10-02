import { createFileRoute } from "@tanstack/react-router";
import { getIndexedFirewall, listFirewallActions, syncFirewallSafe } from "@/lib/chain/firewall.server";

export const Route = createFileRoute("/api/firewalls/$firewallId/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.firewallId)) {
          return Response.json({ error: "Firewall not found." }, { status: 404 });
        }
        await syncFirewallSafe();
        const firewall = await getIndexedFirewall(params.firewallId);
        if (!firewall) return Response.json({ error: "Firewall not found." }, { status: 404 });
        const actions = await listFirewallActions(params.firewallId);
        return Response.json({ firewall, actions }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
