import { createFileRoute } from "@tanstack/react-router";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { configuredProofAnchor, listExecutionProofs, settlePendingProofs } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/")({
  server: {
    handlers: {
      GET: async () => {
        await settlePendingProofs(1);
        const proofs = await listExecutionProofs(100);
        return Response.json(
          { chainId: MONAD_TESTNET.chainId, proofAnchor: configuredProofAnchor(), proofs },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
