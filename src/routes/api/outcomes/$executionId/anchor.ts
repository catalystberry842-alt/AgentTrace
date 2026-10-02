import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { refuseOutcomeAnchor } from "@/lib/developer/outcome.server";

export const Route = createFileRoute("/api/outcomes/$executionId/anchor")({
  server: {
    handlers: {
      POST: ({ request, params }) => withApi(request, "required", () => refuseOutcomeAnchor(params.executionId)),
    },
  },
});
