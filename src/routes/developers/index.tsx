import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getChainStatus } from "@/lib/agents/functions";
import type { ChainStatus } from "@/lib/agents/types";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { buttonClass, ErrorNote, Mono } from "@/components/ui";
import { MONAD_TESTNET } from "@/lib/chain/network";

export const Route = createFileRoute("/developers/")({ component: DevelopersPage });

const STEPS = ["Register", "Control", "Execute", "Verify"] as const;

function DevelopersPage() {
  const [status, setStatus] = useState<ChainStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChainStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read chain status.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell>
      <p className="type-caption text-faint">Developers</p>
      <h1 className="type-heading mt-2 text-balance md:text-3xl">Build with AgentTrace</h1>
      <p className="mt-3 max-w-xl text-sm text-pretty text-muted">
        Give your AI agents identity, controlled execution and verifiable history on Monad.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <Link to="/developers/api-keys" className={buttonClass("primary", "w-full sm:w-auto")}>
          Create API key
        </Link>
        <Link to="/developers/sandbox" className={buttonClass("secondary", "w-full sm:w-auto")}>
          Open sandbox
        </Link>
      </div>
      <ol className="mt-10 flex flex-wrap gap-x-3 gap-y-2 text-sm" aria-label="Integration">
        {STEPS.map((step, index) => (
          <li key={step} className="flex items-center gap-3">
            {index > 0 ? (
              <span className="text-faint" aria-hidden>
                →
              </span>
            ) : null}
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <DeveloperNav current="/developers" />
      {error ? (
        <div className="mt-8">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-sm font-medium">Monad testnet</h2>
        <p className="mt-2 text-sm text-muted">
          Chain <Mono>{MONAD_TESTNET.chainId}</Mono>. Mainnet is not available.
        </p>
        <dl className="mt-4 border-t border-border text-sm">
          <Row label="Registry" value={status ? (status.registry ? status.registry : "Not deployed") : "—"} />
          <Row label="Firewall" value={status ? (status.firewall ? status.firewall : "Not deployed") : "—"} />
          <Row label="Proof anchor" value={status ? (status.proofAnchor ? status.proofAnchor : "Not deployed") : "—"} />
          <Row label="Demo protocol" value={status ? (status.demoProtocol ? status.demoProtocol : "Not deployed") : "—"} />
        </dl>
        <p className="mt-4 max-w-xl text-sm text-muted">
          Until those contracts are deployed, the API will not return a confirmed agent, firewall, or execution. It does not invent ids or transaction hashes.
        </p>
      </section>
    </Shell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:gap-8">
      <dt className="text-xs tracking-widest text-muted uppercase sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 font-mono text-sm break-all">{value}</dd>
    </div>
  );
}
