import { createFileRoute } from "@tanstack/react-router";
import { getIndexedFirewall } from "@/lib/chain/firewall.server";
import { listProofsForFirewall } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/firewalls/$firewallId/proofs")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        if (!/^[1-9]\d*$/.test(params.firewallId)) {
          return Response.json({ error: "Firewall not found." }, { status: 404 });
        }
        const firewall = await getIndexedFirewall(params.firewallId);
        if (!firewall) return Response.json({ error: "Firewall not found." }, { status: 404 });
        const proofs = await listProofsForFirewall(params.firewallId);
        return Response.json({ proofs }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
