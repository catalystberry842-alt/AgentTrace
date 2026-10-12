import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { getChainStatus } from "@/lib/agents/functions";
import type { ChainStatus } from "@/lib/agents/types";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { CodeBlock, ErrorNote } from "@/components/ui";
import { AddressValue } from "@/components/values";
import { IS_MAINNET, MONAD_TESTNET } from "@/lib/chain/network";

export const Route = createFileRoute("/developers/")({ component: DevelopersPage });

const NETWORK = IS_MAINNET ? "monad-mainnet" : "monad-testnet";

const SNIPPET = `import { traceCall } from "agenttrace-monad";

const r = await traceCall({
  network: "${NETWORK}",
  signer: process.env.AGENT_KEY, // the firewall's executor
  firewallId: 2,
  target, data,                  // the call your agent wanted to make
});
// off-policy calls throw FIREWALL_REJECTED before anything is sent
// r: { txHash, executionId, proofStatus, proofHash, anchorTxHash, proofUrl }`;

const SURFACES = [
  { title: "SDK · traceCall", text: "One function wraps an existing agent call: simulate through the firewall, send, verify the receipt, anchor the proof.", to: "/developers/sdk" as const, cta: "SDK reference" },
  { title: "MCP server", text: "Any MCP host (Claude Desktop, Cursor, agent runtimes) gets firewall-bound tools. The model cannot step outside the onchain policy.", to: "/developers/sdk" as const, cta: "MCP config" },
  { title: "HTTP API", text: "Public read API for agents, firewalls, executions, proofs and outcomes under /api/v1. No key needed to read.", to: "/developers/api" as const, cta: "Endpoints" },
];

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

  const contracts: [string, string | null | undefined][] = [
    ["AgentRegistry", status?.registry],
    ["AgentFirewall", status?.firewall],
    ["AgentProof", status?.proofAnchor],
    ["DemoProtocol", status?.demoProtocol],
  ];

  return (
    <Shell wide>
      <p className="type-caption text-faint">Developers</p>
      <h1 className="type-heading mt-2 text-balance md:text-3xl">Build with AgentTrace</h1>
      <p className="mt-3 max-w-2xl text-sm text-pretty text-muted">
        Give an existing agent an onchain identity, a permission firewall and receipt-verified proofs on {MONAD_TESTNET.label}, without changing how it decides what to do.
      </p>
      <DeveloperNav current="/developers" />

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {SURFACES.map((item) => (
          <Link key={item.title} to={item.to} className="group flex flex-col rounded-lg border border-border bg-surface p-5 hover:border-border-strong">
            <h2 className="text-sm font-medium">{item.title}</h2>
            <p className="mt-2 flex-1 text-sm text-muted">{item.text}</p>
            <span className="mt-4 text-sm text-accent group-hover:underline">{item.cta} →</span>
          </Link>
        ))}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section>
          <h2 className="text-sm font-medium">Quickstart</h2>
          <p className="mt-2 text-sm text-muted">The agent keeps its own key and logic. AgentTrace only bounds and records the call.</p>
          <CodeBlock language="ts" code={SNIPPET} />
        </section>
        <section>
          <h2 className="text-sm font-medium">
            Contracts · {MONAD_TESTNET.label} · chain {MONAD_TESTNET.chainId}
          </h2>
          {error ? (
            <div className="mt-4">
              <ErrorNote>{error}</ErrorNote>
            </div>
          ) : null}
          <dl className="mt-4 divide-y divide-border rounded-lg border border-border">
            {contracts.map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="min-w-0 text-right">
                  {status === null ? <span className="skeleton inline-block h-4 w-32" /> : value ? <AddressValue value={value} copy explorer /> : <span className="text-sm text-faint">Not deployed</span>}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-muted">
            Want to see the full path first? <Link to="/demo" className="text-fg underline-offset-4 hover:underline">Run the live demo</Link> with your wallet, or read the{" "}
            <Link to="/developers/docs" className="text-fg underline-offset-4 hover:underline">docs</Link>.
          </p>
        </section>
      </div>
    </Shell>
  );
}
