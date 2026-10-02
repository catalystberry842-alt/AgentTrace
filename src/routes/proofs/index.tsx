import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listProofs } from "@/lib/agents/functions";
import type { ProofRecord } from "@/lib/agents/types";
import { Shell } from "@/components/shell";
import { EmptyState, ErrorNote, Mono, StatusText, TableSkeleton, TextInput, buttonClass } from "@/components/ui";
import { formatAgentId, formatUtc, proofStatusLabel } from "@/lib/format";

export const Route = createFileRoute("/proofs/")({ component: ProofsPage });

const FILTERS = ["All", "Verified", "Unverifiable", "Anchored"] as const;
type Filter = (typeof FILTERS)[number];

function ProofsPage() {
  const [proofs, setProofs] = useState<ProofRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listProofs()
      .then((result) => {
        if (cancelled) return;
        setProofs(result.proofs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load proofs.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needle = query.trim().toLowerCase();
  const visible = (proofs ?? []).filter((proof) => {
    if (filter === "Verified" && proof.verificationStatus !== "receipt_verified") return false;
    if (filter === "Anchored" && !proof.anchored) return false;
    if (filter === "Unverifiable" && proof.verificationStatus !== "unverifiable") return false;
    if (!needle) return true;
    return (
      proof.executionId.toLowerCase().includes(needle) ||
      proof.agentId.includes(needle) ||
      proof.agentName.toLowerCase().includes(needle) ||
      proof.txHash.toLowerCase().includes(needle)
    );
  });

  return (
    <Shell wide>
      <header>
        <h1 className="text-2xl font-medium tracking-tight md:text-3xl">Proofs</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">Verified evidence of agent executions.</p>
      </header>
      <div className="mt-8">
        <TextInput
          value={query}
          placeholder="Search agent, execution or transaction"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-4 flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={filter === item}
              onClick={() => setFilter(item)}
              className={`h-11 rounded-sm border px-3 text-sm ${filter === item ? "border-border-strong bg-subtle text-fg" : "border-border text-muted"}`}
            >
              {item}
            </button>
          ))}
        </div>
        {error ? (
          <div className="mt-6">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}
        {proofs === null && !error ? <TableSkeleton /> : null}
        {proofs && visible.length === 0 ? (
          <EmptyState
            title="No proofs yet"
            description={needle || filter !== "All" ? "Nothing matches this filter." : "Proofs are generated after AgentTrace verifies a real execution."}
            action={
              !needle && filter === "All" ? (
                <Link to="/agents" className={buttonClass("tertiary", "px-0")}>
                  Explore agents
                </Link>
              ) : null
            }
          />
        ) : null}
        {visible.length > 0 ? (
          <div className="mt-6">
            <div className="hidden grid-cols-5 gap-3 border-b border-border py-3 text-xs tracking-widest text-faint uppercase md:grid">
              <span>Agent</span>
              <span>Execution</span>
              <span>Action</span>
              <span>Status</span>
              <span>Timestamp</span>
            </div>
            <ul className="divide-y divide-border border-y border-border md:border-t-0">
              {visible.map((proof) => (
                <li key={proof.executionId}>
                  <Link
                    to="/proofs/$proofId"
                    params={{ proofId: proof.executionId }}
                    className="grid gap-2 py-4 text-sm md:grid-cols-5 md:items-center md:gap-3"
                  >
                    <span>
                      {proof.agentName || "Agent"} <span className="text-muted">{formatAgentId(proof.agentId)}</span>
                    </span>
                    <Mono>{shortId(proof.executionId)}</Mono>
                    <Mono>{proof.functionSelector}</Mono>
                    <StatusText tone={toneFor(proof)}>{proofStatusLabel(proof.verificationStatus, proof.anchored)}</StatusText>
                    <span className="text-muted">{formatUtc(proof.blockTimestamp ?? proof.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

function shortId(value: string): string {
  if (value.length < 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function toneFor(proof: ProofRecord): "ok" | "pending" | "muted" | "danger" {
  if (proof.verificationStatus === "unverifiable") return "danger";
  if (proof.verificationStatus === "requested" || proof.verificationStatus === "temporary_error") return "pending";
  if (proof.verificationStatus === "receipt_verified") return "ok";
  return "muted";
}
