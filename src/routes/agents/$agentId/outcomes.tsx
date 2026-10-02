import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentOutcomesPage } from "@/lib/agents/functions";
import type { OutcomeRecord, OutcomeStatus } from "@/lib/agents/types";
import { AgentFrame } from "@/components/agent-nav";
import { Shell } from "@/components/shell";
import { ErrorNote, SkeletonLines, StatusText } from "@/components/ui";
import { formatUtc, statusTone } from "@/lib/format";

type OutcomeSearch = { status?: OutcomeStatus; offset?: number };

export const Route = createFileRoute("/agents/$agentId/outcomes")({
  validateSearch: (search: Record<string, unknown>): OutcomeSearch => ({
    status:
      search.status === "verified" || search.status === "failed" || search.status === "unverifiable" ? search.status : undefined,
    offset: pageOffset(search.offset),
  }),
  component: OutcomesPage,
});

function pageOffset(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(raw) || raw < 1) return 0;
  return Math.min(10_000, Math.floor(raw));
}

function outcomeLabel(status: OutcomeStatus): string {
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  return "Unverifiable";
}

function OutcomesPage() {
  const { agentId } = Route.useParams();
  const { status, offset: searchOffset } = Route.useSearch();
  const offset = searchOffset ?? 0;
  const [items, setItems] = useState<OutcomeRecord[] | null>(null);
  const [total, setTotal] = useState(0);
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    getAgentOutcomesPage({ data: { agentId, status, offset } })
      .then((result) => {
        if (cancelled) return;
        if (!result.agent) {
          setMissing(true);
          setItems([]);
          return;
        }
        setName(result.agent.name);
        setItems(result.items);
        setTotal(result.total);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load outcomes.");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, status, offset]);

  if (error) {
    return (
      <Shell wide>
        <ErrorNote>{error}</ErrorNote>
      </Shell>
    );
  }
  if (missing) {
    return (
      <Shell wide>
        <h1 className="text-2xl font-medium tracking-tight">Agent not found</h1>
        <p className="mt-3 text-sm text-muted">This identity is not indexed.</p>
      </Shell>
    );
  }
  if (!items) {
    return (
      <Shell wide>
        <SkeletonLines />
      </Shell>
    );
  }

  return (
    <AgentFrame agentId={agentId} name={name} section="outcomes">
      <p className="max-w-xl text-sm text-muted">
        An outcome is a protocol result. It is not the same as a verified execution, and it is not a score.
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <FilterLink agentId={agentId} status={undefined} current={status} label="All" />
        <FilterLink agentId={agentId} status="verified" current={status} label="Verified" />
        <FilterLink agentId={agentId} status="failed" current={status} label="Failed" />
        <FilterLink agentId={agentId} status="unverifiable" current={status} label="Unverifiable" />
      </div>
      {items.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm font-medium">{status ? "Nothing matches this filter." : "No verified outcomes yet"}</p>
          {!status ? (
            <p className="mt-2 max-w-md text-sm text-muted">Outcomes appear when AgentTrace can verify what happened after execution.</p>
          ) : null}
          {!status ? (
            <Link to="/agents/$agentId/activity" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
              View activity
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.outcomeId}>
              <Link
                to="/outcomes/$executionId"
                params={{ executionId: item.executionId }}
                className="grid gap-1 py-3 text-sm md:grid-cols-4 md:items-center"
              >
                <span>{item.expected || "Outcome"}</span>
                <span className="text-muted">Observed {item.observed || "—"}</span>
                <StatusText tone={statusTone(item.status)}>{outcomeLabel(item.status)}</StatusText>
                <span className="text-muted">{formatUtc(item.verifiedAt ?? item.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-6 flex gap-5 text-sm">
        {offset > 0 ? (
          <Link to="/agents/$agentId/outcomes" params={{ agentId }} search={{ status, offset: Math.max(0, offset - 50) }} className="inline-flex h-11 items-center">
            Newer
          </Link>
        ) : null}
        {offset + items.length < total ? (
          <Link to="/agents/$agentId/outcomes" params={{ agentId }} search={{ status, offset: offset + 50 }} className="inline-flex h-11 items-center">
            Older
          </Link>
        ) : null}
      </div>
    </AgentFrame>
  );
}

function FilterLink({
  agentId,
  status,
  current,
  label,
}: {
  agentId: string;
  status?: OutcomeStatus;
  current?: OutcomeStatus;
  label: string;
}) {
  return (
    <Link
      to="/agents/$agentId/outcomes"
      params={{ agentId }}
      search={{ status, offset: 0 }}
      className={`inline-flex h-11 items-center ${current === status ? "text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
}
