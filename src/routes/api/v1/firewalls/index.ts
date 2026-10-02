import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { postFirewall } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/firewalls/")({
  server: {
    handlers: {
      POST: ({ request }) => withApi(request, "required", () => postFirewall(request)),
    },
  },
});
