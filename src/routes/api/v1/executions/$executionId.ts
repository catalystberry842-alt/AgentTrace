import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { getExecution } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/executions/$executionId")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => getExecution(params.executionId)),
    },
  },
});
