import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { deleteWebhook } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/webhooks/$webhookId")({
  server: {
    handlers: {
      DELETE: ({ request, params }) => withApi(request, "required", (ctx) => deleteWebhook(params.webhookId, ctx)),
    },
  },
});
