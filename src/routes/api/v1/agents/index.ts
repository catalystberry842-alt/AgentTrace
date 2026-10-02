import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { postAgent } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/agents/")({
  server: {
    handlers: {
      POST: ({ request }) => withApi(request, "required", () => postAgent(request)),
    },
  },
});
