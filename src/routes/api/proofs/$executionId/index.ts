import { createFileRoute } from "@tanstack/react-router";
import { syncFirewallSafe } from "@/lib/chain/firewall.server";
import { getExecutionProof, verifyIndexedExecution } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Cold instances start empty; index and settle this proof before answering.
        await syncFirewallSafe();
        const id = params.executionId.trim().toLowerCase();
        const proof = (await verifyIndexedExecution(id).catch(() => null)) ?? (await getExecutionProof(id));
        if (!proof) return Response.json({ error: "Proof not found." }, { status: 404 });
        return Response.json({ proof }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
