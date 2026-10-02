import { createFileRoute } from "@tanstack/react-router";
import { getIndexedFirewall, syncFirewallSafe } from "@/lib/chain/firewall.server";

export const Route = createFileRoute("/api/firewalls/$firewallId/policy")({
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
          {
            firewallId: firewall.id,
            policy: {
              allowValueTransfer: firewall.allowValueTransfer,
              maxValuePerTransaction: firewall.maxValuePerTransaction,
              maxValuePerPeriod: firewall.maxValuePerPeriod,
              spentInPeriod: firewall.spentInPeriod,
              periodStart: firewall.periodStartUnix,
              periodDuration: firewall.periodDuration,
            },
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
