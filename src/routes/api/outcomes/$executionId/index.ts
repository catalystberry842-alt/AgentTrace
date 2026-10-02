import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { readOutcomes } from "@/lib/developer/outcome.server";

export const Route = createFileRoute("/api/outcomes/$executionId/")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => readOutcomes(params.executionId)),
    },
  },
});
