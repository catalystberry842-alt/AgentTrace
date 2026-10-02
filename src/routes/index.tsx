import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listConfigurableAgents, listMyIntents } from "@/lib/agents/functions";
import type { RegistrationIntent } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { buttonClass, EmptyState, ErrorNote, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { formatAgentId, statusLabel, statusTone } from "@/lib/format";

export const Route = createFileRoute("/")({ component: Home });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

const FLOW = ["Identity", "Control", "Execution", "Proof", "Outcome"] as const;

const LAYERS = [
  { title: "Identity", text: "Give every agent a persistent onchain identity." },
  { title: "Control", text: "Define exactly what an agent is allowed to do." },
  { title: "Proof", text: "Create independently verifiable evidence of execution." },
  { title: "Outcome", text: "Verify measurable results." },
] as const;

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (!isPending && user) return <YourAgents />;
  return <Landing pending={isPending} />;
}

function YourAgents() {
  const [agents, setAgents] = useState<{ agentId: string; name: string }[] | null>(null);
  const [intents, setIntents] = useState<RegistrationIntent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listConfigurableAgents(), listMyIntents()])
      .then(([owned, mine]) => {
        if (cancelled) return;
        setAgents(owned.agents);
        setIntents(mine.intents);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load your agents.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const indexed = new Set((agents ?? []).map((agent) => agent.agentId));
  const pending = (intents ?? []).filter((intent) => !intent.chainAgentId || !indexed.has(intent.chainAgentId));
  const empty = agents !== null && intents !== null && agents.length === 0 && pending.length === 0;

  return (
    <Shell>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-medium tracking-tight md:text-3xl">Your agents</h1>
          <p className="mt-2 max-w-md text-sm text-muted">Manage agent identities, permissions and verified activity.</p>
        </div>
        {empty ? null : (
          <Link to="/agents/new" className={buttonClass("primary", "w-full sm:w-auto")}>
            Create agent
          </Link>
        )}
      </header>
      {error ? (
        <div className="mt-8">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {agents === null || intents === null ? (
        <div className="mt-8">
          <SkeletonLines />
        </div>
      ) : null}
      {empty ? (
        <EmptyState
          title="No agents yet"
          description="Create an agent to establish your first onchain identity."
          action={
            <Link to="/agents/new" className={buttonClass("primary", "w-full sm:w-auto")}>
              Create agent
            </Link>
          }
        />
      ) : null}
      {agents && agents.length > 0 ? (
        <ul className="mt-8 divide-y divide-border border-y border-border">
          {agents.map((agent) => (
            <li key={agent.agentId}>
              <Link to="/agents/$agentId" params={{ agentId: agent.agentId }} className="flex min-h-14 flex-col justify-center gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                <span className="font-medium">{agent.name || "Agent"}</span>
                <span className="flex items-center gap-4 text-muted">
                  <Mono>{formatAgentId(agent.agentId)}</Mono>
                  <StatusText tone="ok">Active</StatusText>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {pending.length > 0 ? (
        <ul className={`${agents && agents.length > 0 ? "" : "mt-8"} divide-y divide-border border-y border-border`}>
          {pending.map((intent) => (
            <li key={intent.id}>
              <Link
                to="/agents/$agentId"
                params={{ agentId: intent.chainAgentId ?? intent.id }}
                className="flex min-h-14 flex-col justify-center gap-1 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="font-medium">{intent.name}</span>
                <span className="flex items-center gap-4 text-muted">
                  <Mono>{intent.chainAgentId ? formatAgentId(intent.chainAgentId) : "Not onchain"}</Mono>
                  <StatusText tone={statusTone(intent.status)}>{statusLabel(intent.status)}</StatusText>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </Shell>
  );
}

function Landing({ pending }: { pending: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  function createAgent() {
    if (!google) return;
    setSigningIn(true);
    setError(null);
    void signIn(google.providerId, { callbackURL: "/agents/new" }).catch((err: unknown) => {
      setSigningIn(false);
      setError(err instanceof Error ? err.message : "Sign-in failed");
    });
  }

  const primaryClass = buttonClass("primary", "w-full sm:w-auto");
  const secondaryClass = buttonClass("secondary", "w-full sm:w-auto");

  return (
    <Shell>
      <section>
        <h1 className="type-display text-balance">AgentTrace</h1>
        <p className="mt-4 text-lg text-fg">Every agent leaves a trace.</p>
        <p className="mt-3 max-w-md text-sm text-pretty text-muted">An onchain identity and provenance layer for AI agents on Monad.</p>
        <p className="mt-3 max-w-sm text-sm text-pretty text-muted">
          Control what your agents can do.
          <br />
          Prove what they actually did.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          {pending ? <div className="h-11 w-full animate-pulse rounded-sm bg-subtle sm:w-40" /> : null}
          {!pending && authEnabled && google ? (
            <button type="button" disabled={signingIn} onClick={createAgent} className={primaryClass}>
              {signingIn ? "Continuing…" : "Create your first agent"}
            </button>
          ) : null}
          {!pending ? (
            <Link to="/agents" className={secondaryClass}>
              Explore agents
            </Link>
          ) : null}
          {!pending ? (
            <Link to="/demo" className={buttonClass("tertiary", "w-full justify-start px-0 sm:w-auto")}>
              Run the demo
            </Link>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      <ol className="mt-14 flex flex-wrap gap-x-3 gap-y-2 text-sm" aria-label="Infrastructure">
        {FLOW.map((item, index) => (
          <li key={item} className="flex items-center gap-3">
            {index > 0 ? (
              <span className="text-faint" aria-hidden>
                →
              </span>
            ) : null}
            <span>{item}</span>
          </li>
        ))}
      </ol>

      <section className="mt-10 grid gap-8 border-t border-border pt-8 sm:grid-cols-2">
        {LAYERS.map((layer) => (
          <div key={layer.title}>
            <h2 className="text-sm font-medium">{layer.title}</h2>
            <p className="mt-2 text-sm text-pretty text-muted">{layer.text}</p>
          </div>
        ))}
      </section>

      <section className="mt-14 max-w-xl border-t border-border pt-8">
        <h2 className="text-sm font-medium">Why AgentTrace</h2>
        <p className="mt-3 text-sm text-pretty text-muted">
          AI agents can execute actions, but proving which agent acted, what permissions it had, what it actually executed, and what happened afterward is difficult.
        </p>
        <p className="mt-3 text-sm text-pretty text-muted">
          AgentTrace keeps those answers separate: an onchain identity, a firewall of allowed calls, the execution itself, an independent proof that the execution happened, and a separate check of the outcome.
        </p>
      </section>

      <section className="mt-10 max-w-xl">
        <h2 className="text-sm font-medium">Why Monad</h2>
        <p className="mt-3 text-sm text-pretty text-muted">
          Permissions are enforced by a Solidity contract, not by the browser. Monad testnet is EVM-compatible, so AgentRegistry, AgentFirewall, AgentProof, and DemoProtocol are ordinary contracts on chain 10143. AgentTrace reads their events from the public testnet RPC. A claim in the interface is not treated as proof.
        </p>
      </section>
    </Shell>
  );
}
