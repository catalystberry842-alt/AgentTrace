import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getOutcome } from "@/lib/agents/functions";
import type { OutcomeRecord } from "@/lib/agents/types";
import { Shell } from "@/components/shell";
import { ErrorNote, Fact, NotFoundState, OutcomeSkeleton, Status, buttonClass } from "@/components/ui";
import { formatAgentLabel } from "@/lib/format";

export const Route = createFileRoute("/outcomes/$executionId")({ component: OutcomePage });

function label(status: OutcomeRecord["status"]): string {
  if (status === "verified") return "Verified";
  if (status === "failed") return "Failed";
  return "Unverifiable";
}

function OutcomePage() {
  const { executionId } = Route.useParams();
  const [outcome, setOutcome] = useState<OutcomeRecord | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOutcome({ data: executionId })
      .then((result) => {
        if (cancelled) return;
        setOutcome(result.outcome);
        setName(result.agentName);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this outcome.");
      });
    return () => {
      cancelled = true;
    };
  }, [executionId]);

  return (
    <Shell>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!error && outcome === undefined ? <OutcomeSkeleton /> : null}
      {!error && outcome === null ? (
        <NotFoundState
          title="No outcome"
          description="No outcome is recorded for this execution. AgentTrace does not invent one."
          action={
            <Link to="/proofs/$proofId" params={{ proofId: executionId }} className={buttonClass("secondary")}>
              Back to proof
            </Link>
          }
        />
      ) : null}
      {outcome ? (
        <article>
          <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Breadcrumb">
            <Link to="/agents" className="hover:text-fg">
              Agents
            </Link>
            <span aria-hidden>/</span>
            <Link to="/agents/$agentId" params={{ agentId: outcome.agentId }} className="hover:text-fg">
              {name || formatAgentLabel(outcome.agentId)}
            </Link>
            <span aria-hidden>/</span>
            <Link to="/agents/$agentId/outcomes" params={{ agentId: outcome.agentId }} search={{ status: undefined, offset: 0 }} className="hover:text-fg">
              Outcomes
            </Link>
            <span aria-hidden>/</span>
            <span className="text-fg">Execution</span>
          </nav>
          <h1 className="type-heading mt-4">Outcome</h1>
          <p className="mt-3 max-w-xl text-sm text-muted">What happened after the execution? An outcome is not a proof.</p>
          <p className="mt-4">
            <Status status={outcome.status === "verified" ? "verified" : outcome.status === "failed" ? "failed" : "unverifiable"} label={label(outcome.status)} />
          </p>
          <section className="mt-8 border-t border-border pt-6">
            <h2 className="type-caption text-faint">Proof</h2>
            <p className="mt-2 max-w-xl text-sm text-muted">Did the execution happen? That answer lives on the execution proof, not here.</p>
            <Link to="/proofs/$proofId" params={{ proofId: outcome.executionId }} className="mt-2 inline-flex h-11 items-center text-sm hover:underline">
              View execution proof
            </Link>
          </section>
          <section className="mt-2">
            <h2 className="type-caption text-faint">Outcome</h2>
            <dl className="mt-2 border-t border-border">
              <Fact label="Expected result">{outcome.expected || "—"}</Fact>
              <Fact label="Observed result">{outcome.observed || "—"}</Fact>
              <Fact label="Status">{label(outcome.status)}</Fact>
              <Fact label="Evidence">{outcome.evidence || "—"}</Fact>
            </dl>
          </section>
          {outcome.reason ? <p className="mt-6 max-w-xl text-sm text-muted">{outcome.reason}</p> : null}
          <p className="mt-4 max-w-xl text-sm text-muted">
            {outcome.status === "verified"
              ? "AgentTrace verified what happened after execution. This is not the execution proof."
              : outcome.status === "unverifiable"
                ? "AgentTrace could not judge this protocol outcome. That is not a failed execution, and it is not verified."
                : "A condition in the expected outcome was not met. The execution proof is separate."}
          </p>
        </article>
      ) : null}
    </Shell>
  );
}
