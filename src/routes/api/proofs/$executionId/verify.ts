import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ingestFirewallReceipt } from "@/lib/chain/firewall.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { verifyIndexedExecution } from "@/lib/chain/proof.server";

// Optional body { "transactionHash": "0x..." }: if this instance has not indexed the execution yet,
// the server reads that receipt from Monad itself before verifying. The hash is only a hint; the
// proof still comes from the receipt and the AgentAction log, never from the caller.
async function ingestHint(request: Request, executionId: string) {
  let hash: unknown;
  try {
    hash = ((await request.json()) as { transactionHash?: unknown })?.transactionHash;
  } catch {
    return;
  }
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) return;
  const sql = await getSql();
  const found = await sql<{ execution_id: string }>`
    select execution_id from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId.toLowerCase()}
  `;
  if (!found.length) await ingestFirewallReceipt(sql, hash.toLowerCase() as `0x${string}`).catch(() => undefined);
}

export const Route = createFileRoute("/api/proofs/$executionId/verify")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        await ingestHint(request, params.executionId);
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
