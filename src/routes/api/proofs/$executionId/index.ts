import { createFileRoute } from "@tanstack/react-router";
import { getExecutionProof } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const proof = await getExecutionProof(params.executionId);
        if (!proof) return Response.json({ error: "Proof not found." }, { status: 404 });
        return Response.json({ proof }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
