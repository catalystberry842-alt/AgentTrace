import { createFileRoute } from "@tanstack/react-router";
import { Directory } from "@/components/directory";
import { Shell } from "@/components/shell";

export const Route = createFileRoute("/agents/")({
  component: function AgentsPage() {
    return (
      <Shell wide>
        <Directory />
      </Shell>
    );
  },
});
