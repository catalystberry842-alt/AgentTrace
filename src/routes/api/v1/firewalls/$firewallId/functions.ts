import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { postFirewallAllow } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/firewalls/$firewallId/functions")({
  server: {
    handlers: {
      POST: ({ request, params }) => withApi(request, "required", () => postFirewallAllow(params.firewallId, "function", request)),
    },
  },
});
