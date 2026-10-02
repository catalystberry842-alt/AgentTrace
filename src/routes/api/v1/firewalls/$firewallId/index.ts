import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { getFirewall } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/firewalls/$firewallId/")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => getFirewall(params.firewallId)),
    },
  },
});
