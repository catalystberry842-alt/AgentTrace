import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { getAgent, patchAgent } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/agents/$agentId")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => getAgent(params.agentId)),
      PATCH: ({ request, params }) => withApi(request, "required", () => patchAgent(params.agentId)),
    },
  },
});
