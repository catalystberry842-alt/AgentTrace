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
import { formatAgentId, formatAgentLabel, formatUtc, formatWei, proofStatusLabel, txUrl } from "@/lib/format";

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
        <p className="mt-3 max-w-xl text-sm text-muted">Can this execution be independently verified?</p>
      </header>
      <dl className="mt-8 border-t border-border">
        <Fact label="Agent">{proof.agentName || formatAgentLabel(proof.agentId)}</Fact>
        <Fact label="Firewall">{formatAgentId(proof.firewallId)}</Fact>
        <Fact label="Executor">
          <AddressValue value={proof.executor} copy explorer />
        </Fact>
        <Fact label="Target">
          <AddressValue value={proof.target} copy explorer />
        </Fact>
        <Fact label="Function">
          <Mono>{proof.functionSelector}</Mono>
        </Fact>
        <Fact label="Transaction">
          <TxValue hash={proof.txHash} copy />
        </Fact>
      </dl>
      <p className="mt-4 max-w-xl text-sm text-muted">
        {proof.verificationStatus === "receipt_verified"
          ? "Proof: AgentTrace verified that the transaction executed successfully. This is not an outcome."
          : proof.verificationStatus === "unverifiable"
            ? "Proof: AgentTrace could not match this execution to a consistent receipt."
            : "Proof: the receipt has not been verified yet."}
      </p>

      <dl className="mt-8 border-t border-border">
        <Fact label="Transaction">{proof.checks.some((item) => item.name === "transactionExists" && item.passed) ? "The transaction exists." : "Not confirmed by a receipt check."}</Fact>
        <Fact label="Execution">AgentTrace indexed an AgentAction.</Fact>
        <Fact label="Proof">
          {proof.verificationStatus === "receipt_verified"
            ? "The receipt was checked independently."
            : proof.verificationStatus === "unverifiable"
              ? "The evidence is inconsistent."
              : proof.verificationStatus === "temporary_error"
                ? "The receipt could not be read yet."
                : "The receipt has not been verified yet."}
        </Fact>
        <Fact label="Anchor">{proof.anchored ? "The proof hash is committed onchain." : "Not anchored"}</Fact>
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Agent</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Name">{proof.agentName || "—"}</Fact>
          <Fact label="Agent ID">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link to="/agents/$agentId" params={{ agentId: proof.agentId }} className="hover:underline">
                <Mono>{formatAgentId(proof.agentId)}</Mono>
              </Link>
              <CopyButton value={proof.agentId} label="agent id" />
            </span>
          </Fact>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Firewall</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Firewall ID">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Link to="/firewalls/$firewallId" params={{ firewallId: proof.firewallId }} className="hover:underline">
                <Mono>Firewall {formatAgentId(proof.firewallId)}</Mono>
              </Link>
              <CopyButton value={proof.firewallId} label="firewall id" />
            </span>
          </Fact>
          <Fact label="Status">{proof.firewallStatus ? proof.firewallStatus : "Not indexed"}</Fact>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Executor</h2>
        <div className="mt-3 border-t border-border">
          <Fact label="Address">
            <AddressValue value={proof.executor} copy />
          </Fact>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Action</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Target">
            <AddressValue value={proof.target} copy />
          </Fact>
          <Fact label="Function">Selector recorded on the execution</Fact>
          <Fact label="Value">{formatWei(proof.value)}</Fact>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Transaction</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Status">{proof.checks.some((item) => item.name === "transactionExists" && item.passed) ? "Confirmed" : "Not confirmed by a receipt check"}</Fact>
          <Fact label="Hash">
            <TxValue hash={proof.txHash} copy />
          </Fact>
          <Fact label="Timestamp">{formatUtc(proof.blockTimestamp)}</Fact>
          <Fact label="Explorer">
            {href ? (
              <a href={href} className="underline-offset-4 hover:underline" rel="noreferrer">
                View transaction
              </a>
            ) : (
              "No explorer link."
            )}
          </Fact>
        </dl>
      </section>

      <details className="mt-10 border-t border-border pt-4">
        <summary className="flex h-11 cursor-pointer items-center text-sm">View details</summary>
        <dl className="mt-2 border-t border-border">
          <Fact label="Selector">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Mono>{proof.functionSelector}</Mono>
              <CopyButton value={proof.functionSelector} label="selector" />
            </span>
          </Fact>
          <Fact label="Block">{proof.blockNumber}</Fact>
          <Fact label="Calldata hash">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Mono>{proof.calldataHash}</Mono>
              <CopyButton value={proof.calldataHash} label="calldata hash" />
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
          <Fact label="Method">{proof.verificationMethod ?? "—"}</Fact>
          <Fact label="Execution ID">
            <span className="inline-flex flex-wrap items-center gap-2">
              <Mono>{proof.executionId}</Mono>
              <CopyButton value={proof.executionId} label="execution id" />
            </span>
          </Fact>
        </dl>
      </details>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Proof</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Verified">{formatUtc(proof.verifiedAt)}</Fact>
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Verification</h2>
        {proof.lastError && proof.verificationStatus === "temporary_error" ? (
          <p className="mt-3 text-sm text-muted">{proof.lastError}</p>
        ) : null}
        {proof.checks.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            {phase === "Verifying execution" ? "Verifying execution" : "Receipt has not been verified yet."}
          </p>
        ) : (
          <ul className="mt-3 border-t border-border">
            {proof.checks.map((check) => (
              <li key={check.name} className="flex items-start gap-3 border-b border-border py-3 text-sm">
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
    </article>
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
