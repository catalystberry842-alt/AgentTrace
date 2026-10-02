import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentReputation } from "@/lib/agents/functions";
import type { AgentReputation, HistoryEntry } from "@/lib/agents/types";
import { Shell } from "@/components/shell";
import { HistoryList, VerifiedHistory } from "@/components/history";
import { ErrorNote, SkeletonLines } from "@/components/ui";
import { formatAgentLabel } from "@/lib/format";

export const Route = createFileRoute("/agents/$agentId/reputation")({ component: ReputationPage });

function ReputationPage() {
  const { agentId } = Route.useParams();
  const [reputation, setReputation] = useState<AgentReputation | null | undefined>(undefined);
  const [timeline, setTimeline] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentReputation({ data: agentId })
      .then((result) => {
        if (cancelled) return;
        setReputation(result.reputation);
        setTimeline(result.timeline);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load verified history.");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  return (
    <Shell>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!error && reputation === undefined ? <SkeletonLines /> : null}
      {!error && reputation === null ? (
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Agent not found</h1>
          <p className="mt-3 text-sm text-muted">This identity is not indexed.</p>
        </div>
      ) : null}
      {reputation ? (
        <article>
          <p className="text-sm text-muted">
            <Link to="/agents/$agentId" params={{ agentId }} className="hover:text-fg hover:underline">
              {formatAgentLabel(agentId)}
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-medium tracking-tight">Verified history</h1>
          <div className="mt-8">
            <VerifiedHistory reputation={reputation} />
          </div>
          <p className="mt-6 max-w-xl text-sm text-muted">
            A reverted firewall call is not an execution. An execution counts as verified only after the receipt check. A failed outcome is a missed condition, not a verdict. An unverifiable outcome is kept separate.
          </p>
          <section className="mt-10">
            <h2 className="text-sm font-medium">History</h2>
            <div className="mt-3">
              <HistoryList entries={timeline} />
            </div>
          </section>
        </article>
      ) : null}
    </Shell>
  );
}
