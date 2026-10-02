import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { verifyOutcome } from "@/lib/developer/outcome.server";

export const Route = createFileRoute("/api/v1/outcomes/$executionId/verify")({
  server: {
    handlers: {
      POST: async ({ request, params }) =>
        withApi(request, "required", async () => {
          const text = await request.clone().text();
          let body: unknown = {};
          if (text) {
            try {
              body = JSON.parse(text) as unknown;
            } catch {
              const { apiError } = await import("@/lib/developer/errors");
              return apiError(400, "INVALID_REQUEST", "The request body must be JSON.");
            }
          }
          return verifyOutcome(params.executionId, body);
        }),
    },
  },
});
