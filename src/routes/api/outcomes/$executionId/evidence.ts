import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { readOutcomeEvidence } from "@/lib/developer/outcome.server";

export const Route = createFileRoute("/api/outcomes/$executionId/evidence")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => readOutcomeEvidence(params.executionId)),
    },
  },
});
