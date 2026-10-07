import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { ingestReceiptHint } from "@/lib/chain/receipt-hint.server";
import { verifyProtocolOutcome } from "@/lib/developer/outcome.server";

/**
 * POST /api/outcomes/:executionId/protocol  { "transactionHash": "0x..." (optional hint) }
 * Built-in outcome check for a known protocol (WMON on mainnet). The expectation is derived from
 * the execution by the server, so no API key is needed and the caller cannot change the verdict.
 */
export const Route = createFileRoute("/api/outcomes/$executionId/protocol")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withApi(request, "optional", async () => {
          await ingestReceiptHint(request, params.executionId);
          return verifyProtocolOutcome(params.executionId);
        }),
    },
  },
});
