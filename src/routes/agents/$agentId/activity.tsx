import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentActivityPage } from "@/lib/agents/functions";
import type { AgentActivityItem } from "@/lib/agents/types";
import { AgentFrame } from "@/components/agent-nav";
import { Shell } from "@/components/shell";
import { ErrorNote, Mono, SkeletonLines } from "@/components/ui";
import { TxValue } from "@/components/values";
import { formatUtc, proofStatusLabel, shortAddress } from "@/lib/format";

type ActivitySearch = { status?: "verified" | "unverified"; offset?: number };

export const Route = createFileRoute("/agents/$agentId/activity")({
  validateSearch: (search: Record<string, unknown>): ActivitySearch => ({
    status: search.status === "verified" || search.status === "unverified" ? search.status : undefined,
    offset: pageOffset(search.offset),
  }),
  component: ActivityPage,
});

function pageOffset(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(raw) || raw < 1) return 0;
  return Math.min(10_000, Math.floor(raw));
}

function ActivityPage() {
  const { agentId } = Route.useParams();
  const { status, offset: searchOffset } = Route.useSearch();
  const offset = searchOffset ?? 0;
  const [items, setItems] = useState<AgentActivityItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    getAgentActivityPage({ data: { agentId, status, offset } })
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load activity.");
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
    <AgentFrame agentId={agentId} name={name} section="activity">
      <p className="max-w-xl text-sm text-muted">Executions this agent performed. A reverted call is not included.</p>
      <div className="mt-4 flex gap-5 text-sm">
        <FilterLink agentId={agentId} status={undefined} current={status} label="All" />
        <FilterLink agentId={agentId} status="verified" current={status} label="Verified" />
        <FilterLink agentId={agentId} status="unverified" current={status} label="Not verified" />
      </div>
      {items.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm font-medium">{status ? "No executions match this filter." : "No executions yet"}</p>
          {!status ? (
            <p className="mt-2 max-w-md text-sm text-muted">Successful executions will appear here with their verification status.</p>
          ) : null}
          {!status ? (
            <Link to="/agents/$agentId/firewall" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
              View firewall
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {items.map((item) => (
            <li key={item.executionId} className="grid gap-1 py-3 text-sm md:grid-cols-5 md:items-center">
              <Link to="/proofs/$proofId" params={{ proofId: item.executionId }} className="hover:underline">
                <Mono>{item.selector}</Mono>
              </Link>
              <span className="text-muted">{shortAddress(item.target)}</span>
              <span className="text-muted">{item.proofStatus ? proofStatusLabel(item.proofStatus, item.anchored) : "No proof"}</span>
              <TxValue hash={item.txHash} />
              <span className="text-muted">{formatUtc(item.timestamp)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pager agentId={agentId} status={status} offset={offset} total={total} count={items.length} />
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
  status: "verified" | "unverified" | undefined;
  current: "verified" | "unverified" | undefined;
  label: string;
}) {
  return (
    <Link
      to="/agents/$agentId/activity"
      params={{ agentId }}
      search={{ status, offset: 0 }}
      className={`inline-flex h-11 items-center ${current === status ? "text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
}

function Pager({
  agentId,
  status,
  offset,
  total,
  count,
}: {
  agentId: string;
  status?: "verified" | "unverified";
  offset: number;
  total: number;
  count: number;
}) {
  if (total <= 50 && offset === 0) return null;
  return (
    <div className="mt-6 flex gap-5 text-sm">
      {offset > 0 ? (
        <Link to="/agents/$agentId/activity" params={{ agentId }} search={{ status, offset: Math.max(0, offset - 50) }} className="inline-flex h-11 items-center">
          Newer
        </Link>
      ) : null}
      {offset + count < total ? (
        <Link to="/agents/$agentId/activity" params={{ agentId }} search={{ status, offset: offset + 50 }} className="inline-flex h-11 items-center">
          Older
        </Link>
      ) : null}
    </div>
  );
}
