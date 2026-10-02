import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentProofPage } from "@/lib/agents/functions";
import type { ProofRecord } from "@/lib/agents/types";
import { AgentFrame } from "@/components/agent-nav";
import { Shell } from "@/components/shell";
import { ErrorNote, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { TxValue } from "@/components/values";
import { formatUtc, proofStatusLabel, shortHash } from "@/lib/format";

type ProofSearch = { status?: "verified" | "unverifiable" | "anchored" };

export const Route = createFileRoute("/agents/$agentId/proofs")({
  validateSearch: (search: Record<string, unknown>): ProofSearch => ({
    status:
      search.status === "verified" || search.status === "unverifiable" || search.status === "anchored" ? search.status : undefined,
  }),
  component: AgentProofsPage,
});

function AgentProofsPage() {
  const { agentId } = Route.useParams();
  const { status } = Route.useSearch();
  const [proofs, setProofs] = useState<ProofRecord[] | null>(null);
  const [name, setName] = useState("");
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setProofs(null);
    getAgentProofPage({ data: { agentId } })
      .then((result) => {
        if (cancelled) return;
        if (!result.agent) {
          setMissing(true);
          setProofs([]);
          return;
        }
        setName(result.agent.name);
        setProofs(result.proofs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load proofs.");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId]);

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
  if (!proofs) {
    return (
      <Shell wide>
        <SkeletonLines />
      </Shell>
    );
  }

  const visible = proofs.filter((proof) => {
    if (status === "verified") return proof.verificationStatus === "receipt_verified";
    if (status === "unverifiable") return proof.verificationStatus === "unverifiable";
    if (status === "anchored") return proof.anchored;
    return true;
  });

  return (
    <AgentFrame agentId={agentId} name={name} section="proofs">
      <p className="max-w-xl text-sm text-muted">Independent receipt checks for this agent. An indexed execution is not verified until the receipt is checked.</p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Filter agentId={agentId} status={undefined} current={status} label="All" />
        <Filter agentId={agentId} status="verified" current={status} label="Verified" />
        <Filter agentId={agentId} status="unverifiable" current={status} label="Unverifiable" />
        <Filter agentId={agentId} status="anchored" current={status} label="Anchored" />
      </div>
      {visible.length === 0 ? (
        <div className="mt-8">
          <p className="text-sm font-medium">{status ? "No proofs match this filter." : "No proofs yet"}</p>
          {!status ? (
            <p className="mt-2 max-w-md text-sm text-muted">Proofs are generated after AgentTrace verifies a real execution.</p>
          ) : null}
          {!status ? (
            <Link to="/agents/$agentId/firewall" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
              View firewall
            </Link>
          ) : null}
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-border border-y border-border">
          {visible.map((proof) => (
            <li key={proof.executionId} className="grid gap-1 py-3 text-sm md:grid-cols-5 md:items-center">
              <Link to="/proofs/$proofId" params={{ proofId: proof.executionId }} className="hover:underline">
                <Mono>{shortHash(proof.executionId)}</Mono>
              </Link>
              <Mono>{proof.functionSelector}</Mono>
              <StatusText tone={proof.verificationStatus === "unverifiable" ? "danger" : proof.verificationStatus === "receipt_verified" ? "ok" : "pending"}>
                {proofStatusLabel(proof.verificationStatus, proof.anchored)}
              </StatusText>
              <TxValue hash={proof.txHash} />
              <span className="text-muted">{formatUtc(proof.blockTimestamp ?? proof.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </AgentFrame>
  );
}

function Filter({
  agentId,
  status,
  current,
  label,
}: {
  agentId: string;
  status?: ProofSearch["status"];
  current?: ProofSearch["status"];
  label: string;
}) {
  return (
    <Link
      to="/agents/$agentId/proofs"
      params={{ agentId }}
      search={{ status }}
      className={`inline-flex h-11 items-center ${current === status ? "text-fg" : "text-muted hover:text-fg"}`}
    >
      {label}
    </Link>
  );
}
