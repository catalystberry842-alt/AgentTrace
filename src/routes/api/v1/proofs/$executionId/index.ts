import { createFileRoute } from "@tanstack/react-router";
import { withApi } from "@/lib/developer/guard.server";
import { getProof } from "@/lib/developer/v1.server";

export const Route = createFileRoute("/api/v1/proofs/$executionId/")({
  server: {
    handlers: {
      GET: ({ request, params }) => withApi(request, "optional", () => getProof(params.executionId)),
    },
  },
});
