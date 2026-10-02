import { createFileRoute } from "@tanstack/react-router";
import { requireUserId } from "@/lib/auth/verify.server";
import { anchorVerifiedProof } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/anchor")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const header = request.headers.get("authorization");
        const bearer = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
        try {
          await requireUserId(bearer);
        } catch {
          return Response.json({ error: "Sign in is required to request an anchor." }, { status: 401 });
        }
        const result = await anchorVerifiedProof(params.executionId);
        const status = result.proof ? 200 : 404;
        return Response.json(
          {
            anchored: result.anchored,
            reason: result.reason,
            txHash: result.txHash,
            proof: result.proof,
          },
          { status, headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
