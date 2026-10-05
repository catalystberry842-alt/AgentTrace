import { useEffect, useState } from "react";
import { Erc8004Validation } from "@/components/erc8004";
import { createFileRoute, Link } from "@tanstack/react-router";
import { anchorProof, getProof, verifyProof } from "@/lib/agents/functions";
import type { ProofRecord } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Button, ErrorNote, Fact, Mono, NotFoundState, ProofSkeleton, Status, buttonClass } from "@/components/ui";
import { AddressValue, CopyButton, TxValue } from "@/components/values";
import { formatAgentId, formatAgentLabel, formatUtc, formatWei, functionName, proofStatusLabel, txUrl } from "@/lib/format";

export const Route = createFileRoute("/proofs/$proofId")({ component: ProofPage });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

const CHECK_LABELS: Record<string, string> = {
  transactionExists: "Transaction exists",
  receiptExists: "Receipt exists",
  transactionSucceeded: "Transaction succeeded",
  actionEventExists: "AgentAction event exists",
  agentExists: "Agent exists",
  agentMatches: "Agent matches execution",
  firewallMatches: "Firewall matches execution",
  executorAuthorized: "Executor authorized",
  targetMatches: "Target matches",
  selectorMatches: "Function selector matches",
  executionIdMatches: "Execution ID matches",
  blockMatches: "Block matches",
  valueMatches: "Value matches",
  calldataHashMatches: "Calldata hash matches",
};

function ProofPage() {
  const { proofId } = Route.useParams();
  const [proof, setProof] = useState<ProofRecord | null | undefined>(undefined);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);

  function load(id: string) {
    return getProof({ data: id }).then((result) => {
      setProof(result.proof);
      setDetail(result.detail);
      return result.proof;
    });
  }

  useEffect(() => {
    let cancelled = false;
    setProof(undefined);
    setPhase(null);
    load(proofId)
      .then((row) => {
        if (cancelled || !row) return;
        if (!needsVerify(row)) return;
        setPhase("Verifying execution");
        return verifyProof({ data: row.executionId }).then((result) => {
          if (!cancelled) setProof(result.proof);
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this proof.");
      })
      .finally(() => {
        if (!cancelled) setPhase(null);
      });
    return () => {
      cancelled = true;
    };
  }, [proofId]);

  return (
    <Shell>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!error && proof === undefined ? <ProofSkeleton /> : null}
      {!error && proof === null ? <Missing detail={detail} /> : null}
      {proof ? <Record proof={proof} phase={phase} onChange={setProof} onPhase={setPhase} onError={setError} /> : null}
    </Shell>
  );
}

function needsVerify(proof: ProofRecord): boolean {
  return proof.verificationStatus === "executed" || proof.verificationStatus === "requested" || proof.verificationStatus === "temporary_error";
}

function Missing({ detail }: { detail: string }) {
  return (
    <NotFoundState
      title="Proof not found"
      description={detail || "This execution is not indexed. A transaction hash alone is not a proof."}
      action={
        <Link to="/proofs" className={buttonClass("secondary")}>
          Back to proofs
        </Link>
      }
    />
  );
}

function Record({
  proof,
  phase,
  onChange,
  onPhase,
  onError,
}: {
  proof: ProofRecord;
  phase: string | null;
  onChange: (proof: ProofRecord) => void;
  onPhase: (phase: string | null) => void;
  onError: (error: string | null) => void;
}) {
  const { user, isPending } = useCurrentUserState();
  const [anchorNote, setAnchorNote] = useState<string | null>(null);
  const href = txUrl(proof.txHash);
  const status = proofStatusLabel(proof.verificationStatus, proof.anchored);

  async function anchor() {
    if (!user) {
      if (authEnabled && google) void signIn(google.providerId, { callbackURL: `/proofs/${proof.executionId}` });
      return;
    }
    onError(null);
    setAnchorNote(null);
    onPhase("Anchoring proof");
    try {
      const result = await anchorProof({ data: { executionId: proof.executionId, txHash: proof.txHash } });
      if (result.proof) onChange(result.proof);
      setAnchorNote(result.anchored ? "Proof anchored." : result.reason);
    } catch (err) {
      onError(err instanceof Error ? err.message : "The anchor was rejected.");
    } finally {
      onPhase(null);
    }
  }

  return (
    <article>
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/agents" className="hover:text-fg">
          Agents
        </Link>
        <span aria-hidden>/</span>
        <Link to="/agents/$agentId" params={{ agentId: proof.agentId }} className="hover:text-fg">
          {proof.agentName || formatAgentLabel(proof.agentId)}
        </Link>
        <span aria-hidden>/</span>
        <Link to="/agents/$agentId/proofs" params={{ agentId: proof.agentId }} search={{ status: undefined }} className="hover:text-fg">
          Proofs
        </Link>
        <span aria-hidden>/</span>
        <span className="text-fg">Execution</span>
      </nav>
      <header className="mt-6">
        <Status status={proofStatusKey(proof)} label={phase ?? status} />
        <h1 className="type-heading mt-4">
          <Mono>{shortId(proof.executionId)}</Mono>
        </h1>
        <p className="mt-3 max-w-xl text-sm text-pretty text-muted">
          {proof.verificationStatus === "receipt_verified"
            ? "AgentTrace re-read this transaction and its receipt from Monad and every check matched. That proves the call ran as recorded; whether it achieved its goal is a separate outcome check."
            : proof.verificationStatus === "unverifiable"
              ? "AgentTrace could not match this execution to a consistent receipt, so no proof hash exists."
              : "AgentTrace has not finished checking the receipt for this execution yet."}
        </p>
      </header>

      <div className="mt-8 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
        <Evidence label="Transaction" ok={proof.checks.some((item) => item.name === "transactionSucceeded" && item.passed)}>
          {formatUtc(proof.blockTimestamp)}
        </Evidence>
        <Evidence label="Receipt checks" ok={proof.verificationStatus === "receipt_verified"}>
          {proof.checks.length ? `${proof.checks.filter((check) => check.passed).length} of ${proof.checks.length} passed` : "Pending"}
        </Evidence>
        <Evidence label="Anchored onchain" ok={proof.anchored}>
          {proof.anchorTxHash ? <TxValue hash={proof.anchorTxHash} /> : "Not yet"}
        </Evidence>
        <Evidence label="Outcome" ok={null}>
          <Link to="/outcomes/$executionId" params={{ executionId: proof.executionId }} className="hover:underline">
            View outcome check
          </Link>
        </Evidence>
      </div>

      <dl className="mt-8 border-t border-border">
        <Fact label="Agent">
          <Link to="/agents/$agentId" params={{ agentId: proof.agentId }} className="hover:underline">
            {proof.agentName || "Agent"} <Mono>{formatAgentId(proof.agentId)}</Mono>
          </Link>
        </Fact>
        <Fact label="Firewall">
          <Link to="/firewalls/$firewallId" params={{ firewallId: proof.firewallId }} className="hover:underline">
            Firewall <Mono>{formatAgentId(proof.firewallId)}</Mono>
          </Link>
        </Fact>
        <Fact label="Executor">
          <AddressValue value={proof.executor} copy explorer />
        </Fact>
        <Fact label="Call">
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <Mono>{functionName(proof.functionSelector) ?? proof.functionSelector}</Mono>
            <span className="text-muted">on</span>
            <AddressValue value={proof.target} copy explorer />
          </span>
        </Fact>
        <Fact label="Value">{formatWei(proof.value)}</Fact>
        <Fact label="Transaction">
          <span className="inline-flex flex-wrap items-center gap-x-3">
            <TxValue hash={proof.txHash} copy />
            {href ? (
              <a href={href} className="text-xs text-muted hover:text-fg" rel="noreferrer">
                Explorer
              </a>
            ) : null}
          </span>
        </Fact>
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Receipt checks</h2>
        {proof.lastError && proof.verificationStatus === "temporary_error" ? (
          <p className="mt-3 text-sm text-muted">{proof.lastError}</p>
        ) : null}
        {proof.checks.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {phase === "Verifying execution" ? "Verifying execution" : "Receipt has not been verified yet."}
          </p>
        ) : (
          <ul className="mt-3 grid border-t border-border sm:grid-cols-2 sm:gap-x-8">
            {proof.checks.map((check) => (
              <li key={check.name} className="flex items-start gap-3 border-b border-border py-2.5 text-sm">
                <span className={check.passed ? "text-ok" : "text-danger"} aria-hidden>
                  {check.passed ? "✓" : "×"}
                </span>
                <span>
                  <span className={check.passed ? "text-fg" : "text-fg"}>{CHECK_LABELS[check.name] ?? check.name}</span>
                  {!check.passed && check.details ? <span className="mt-1 block text-muted">{check.details}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {needsVerify(proof) ? (
          <div className="mt-4">
            <Button
              type="button"
              disabled={Boolean(phase)}
              onClick={() => {
                onError(null);
                onPhase("Verifying execution");
                void verifyProof({ data: proof.executionId })
                  .then((result) => onChange(result.proof))
                  .catch((err: unknown) => onError(err instanceof Error ? err.message : "Verification failed."))
                  .finally(() => onPhase(null));
              }}
            >
              {phase === "Verifying execution" ? "Verifying execution" : "Verify execution"}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-sm font-medium">Anchor</h2>
        <p className="mt-2 text-sm text-muted">
          {proof.anchored ? "The verified proof hash was committed onchain." : "Not anchored"}
        </p>
        {proof.anchorTxHash ? (
          <p className="mt-3 text-sm">
            <TxValue hash={proof.anchorTxHash} copy />
          </p>
        ) : null}
        {proof.verificationStatus === "receipt_verified" && !proof.anchored ? (
          <div className="mt-4">
            <Button type="button" variant="secondary" disabled={isPending || Boolean(phase)} onClick={() => void anchor()}>
              {phase === "Anchoring proof" ? "Anchoring proof" : "Anchor proof"}
            </Button>
          </div>
        ) : null}
        {anchorNote ? <p className="mt-3 text-sm text-muted">{anchorNote}</p> : null}
      </section>
      <Erc8004Validation executionId={proof.executionId} txHash={proof.txHash} owner={proof.executor} />
      <details className="mt-10 border-t border-border pt-2">
        <summary className="flex h-11 cursor-pointer items-center text-sm text-muted hover:text-fg">Technical details</summary>
        <dl className="mt-2 border-t border-border">
          <Fact label="Execution ID">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Mono>{proof.executionId}</Mono>
              <CopyButton value={proof.executionId} label="execution id" />
            </span>
          </Fact>
          <Fact label="Proof hash">
            {proof.proofHash ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                <Mono>{proof.proofHash}</Mono>
                <CopyButton value={proof.proofHash} label="proof hash" />
              </span>
            ) : (
              "Not generated"
            )}
          </Fact>
          <Fact label="Calldata hash">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Mono>{proof.calldataHash}</Mono>
              <CopyButton value={proof.calldataHash} label="calldata hash" />
            </span>
          </Fact>
          <Fact label="Selector">
            <Mono>{proof.functionSelector}</Mono>
          </Fact>
          <Fact label="Block">{proof.blockNumber}</Fact>
          <Fact label="Verified at">{formatUtc(proof.verifiedAt)}</Fact>
          <Fact label="Method">{proof.verificationMethod ?? "—"}</Fact>
        </dl>
      </details>
    </article>
  );
}

function Evidence({ label, ok, children }: { label: string; ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="bg-bg p-4">
      <p className="flex items-center gap-2 font-mono text-[11px] tracking-widest text-faint uppercase">
        {ok === null ? null : <span className={ok ? "text-ok" : "text-faint"} aria-hidden>{ok ? "✓" : "○"}</span>}
        {label}
      </p>
      <div className="mt-2 text-sm text-fg">{children}</div>
    </div>
  );
}

function shortId(value: string): string {
  if (value.length < 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function proofStatusKey(proof: ProofRecord): "verified" | "unverifiable" | "processing" | "pending" {
  if (proof.verificationStatus === "receipt_verified") return "verified";
  if (proof.verificationStatus === "unverifiable") return "unverifiable";
  if (proof.verificationStatus === "temporary_error" || proof.verificationStatus === "requested") return "processing";
  return "pending";
}
