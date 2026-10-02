import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { apiError } from "@/lib/developer/errors";
import { verifyOutcome } from "@/lib/developer/outcome.server";

export const Route = createFileRoute("/api/outcomes/$executionId/verify")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        withApi(request, "required", async () => {
          const text = await request.clone().text();
          let body: unknown = {};
          if (text) {
            try {
              body = JSON.parse(text) as unknown;
            } catch {
              return apiError(400, "INVALID_REQUEST", "The request body must be JSON.");
            }
          }
          return verifyOutcome(params.executionId, body);
        }),
    },
  },
});
