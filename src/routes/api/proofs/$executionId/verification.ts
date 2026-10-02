import { createFileRoute } from "@tanstack/react-router";
import { getExecutionProof } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/verification")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const proof = await getExecutionProof(params.executionId);
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
