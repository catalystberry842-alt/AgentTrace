import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { AgentReputation, HistoryEntry } from "@/lib/agents/types";
import { HISTORY_METHOD } from "@/lib/agents/history-copy";
import { formatUtc } from "@/lib/format";

export function VerifiedHistory({ reputation }: { reputation: AgentReputation }) {
  const agentId = reputation.agentId;
  return (
    <div>
      <p className="max-w-xl text-sm text-pretty text-muted">{HISTORY_METHOD}</p>
      <dl className="mt-4 border-t border-border">
        <Metric label="Verified executions">
          <Link to="/agents/$agentId/activity" params={{ agentId }} search={{ status: "verified" }}>
            {reputation.verifiedExecutions}
          </Link>
        </Metric>
        <Metric label="Verified outcomes">
          <Link to="/agents/$agentId/outcomes" params={{ agentId }} search={{ status: "verified" }}>
            {reputation.verifiedOutcomes}
          </Link>
        </Metric>
        <Metric label="Failed outcomes">
          <Link to="/agents/$agentId/outcomes" params={{ agentId }} search={{ status: "failed" }}>
            {reputation.failedOutcomes}
          </Link>
        </Metric>
        <Metric label="Unverifiable outcomes">
          <Link to="/agents/$agentId/outcomes" params={{ agentId }} search={{ status: "unverifiable" }}>
            {reputation.unverifiableOutcomes}
          </Link>
        </Metric>
        <Metric label="Executions">
          <Link to="/agents/$agentId/activity" params={{ agentId }}>
            {reputation.totalExecutions}
          </Link>
        </Metric>
        <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:gap-8">
          <dt className="text-xs tracking-widest text-muted uppercase sm:w-40 sm:shrink-0">First activity</dt>
          <dd className="text-sm">{formatUtc(reputation.firstActivityAt)}</dd>
        </div>
        <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:gap-8">
          <dt className="text-xs tracking-widest text-muted uppercase sm:w-40 sm:shrink-0">Last activity</dt>
          <dd className="text-sm">{formatUtc(reputation.lastActivityAt)}</dd>
        </div>
      </dl>
      <p className="mt-4 text-sm">
        <Link
          to="/agents/$agentId/reputation"
          params={{ agentId }}
          className="text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          How this history is calculated
        </Link>
      </p>
    </div>
  );
}

function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:items-baseline sm:gap-8">
      <dt className="text-xs tracking-widest text-muted uppercase sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="font-mono text-sm underline-offset-4 hover:underline">{children}</dd>
    </div>
  );
}

export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-muted">No indexed history yet.</p>;
  return (
    <ul className="divide-y divide-border border-y border-border">
      {entries.map((entry) => (
        <li key={entry.id} className="grid gap-1 py-3 text-sm">
          <span className="text-xs tracking-widest text-faint uppercase">{entry.category}</span>
          <a href={entry.href} className="hover:underline">
            {entry.label}
          </a>
          <span className="text-muted">{formatUtc(entry.at)}</span>
        </li>
      ))}
    </ul>
  );
}
