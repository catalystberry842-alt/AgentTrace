import { createFileRoute } from "@tanstack/react-router";
import { ingestReceiptHint } from "@/lib/chain/receipt-hint.server";
import { verifyIndexedExecution } from "@/lib/chain/proof.server";

export const Route = createFileRoute("/api/proofs/$executionId/verify")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        await ingestReceiptHint(request, params.executionId);
        const proof = await verifyIndexedExecution(params.executionId, true);
        if (!proof) {
          return Response.json(
            { error: "No AgentAction is indexed for this execution. A transaction hash is not a proof." },
            { status: 404 },
          );
        }
        return Response.json(
          {
            status: proof.verificationStatus,
            executionId: proof.executionId,
            agentId: proof.agentId,
            firewallId: proof.firewallId,
            transactionHash: proof.txHash,
            proofHash: proof.proofHash,
            checks: Object.fromEntries(proof.checks.map((check) => [check.name, check.passed])),
            checkDetails: proof.checks,
            verifiedAt: proof.verifiedAt,
            verificationMethod: proof.verificationMethod,
            anchored: proof.anchored,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
