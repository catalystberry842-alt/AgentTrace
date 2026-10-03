import { createFileRoute } from "@tanstack/react-router";
import { syncFirewallSafe } from "@/lib/chain/firewall.server";
import { getExecutionProof, verifyIndexedExecution } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/verification")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        // Cold instances start empty; index and settle this proof before answering.
        await syncFirewallSafe();
        const id = params.executionId.trim().toLowerCase();
        const proof = (await verifyIndexedExecution(id).catch(() => null)) ?? (await getExecutionProof(id));
        if (!proof) return Response.json({ error: "Proof not found." }, { status: 404 });
        return Response.json(
          {
            executionId: proof.executionId,
            status: proof.verificationStatus,
            anchored: proof.anchored,
            proofHash: proof.proofHash,
            verificationMethod: proof.verificationMethod,
            verifiedAt: proof.verifiedAt,
            checks: proof.checks,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
