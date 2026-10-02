import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/directory")({
  component: function RedirectDirectory() {
    return <Navigate to="/agents" />;
  },
});
