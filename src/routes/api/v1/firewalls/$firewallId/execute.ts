import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { postExecute } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/firewalls/$firewallId/execute")({
  server: {
    handlers: {
      POST: ({ request, params }) => withApi(request, "required", () => postExecute(params.firewallId, request)),
    },
  },
});
