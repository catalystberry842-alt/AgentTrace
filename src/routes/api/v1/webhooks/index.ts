import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { getWebhooks, postWebhook } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/webhooks/")({
  server: {
    handlers: {
      GET: ({ request }) => withApi(request, "required", (ctx) => getWebhooks(ctx)),
      POST: ({ request }) => withApi(request, "required", (ctx) => postWebhook(request, ctx)),
    },
  },
});
