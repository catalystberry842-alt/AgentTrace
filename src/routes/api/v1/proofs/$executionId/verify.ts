import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { postProofVerify } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/proofs/$executionId/verify")({
  server: {
    handlers: {
      POST: ({ request, params }) => withApi(request, "required", () => postProofVerify(params.executionId)),
    },
  },
});
