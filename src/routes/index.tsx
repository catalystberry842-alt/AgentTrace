import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listConfigurableAgents, listMyIntents } from "@/lib/agents/functions";
import type { RegistrationIntent } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { buttonClass, EmptyState, ErrorNote, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { formatAgentId, statusLabel, statusTone } from "@/lib/format";
import { IS_MAINNET, MONAD_TESTNET } from "@/lib/chain/network";

export const Route = createFileRoute("/")({ component: Home });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

const REPO = "https://github.com/catalystberry842-alt/AgentTrace";

/** Real executions on each network, shown as live examples. */
const SHOWCASE = IS_MAINNET
  ? {
      proof: "0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e",
      agentProof: "0x8361810c1d8b7f3f932a1b8e005dc0cd9d84980432319f540276fde7216ab798",
    }
  : {
      proof: "0x3242aeadc1ae0b511746852d623e71db91e3a49dbbe27662a886d65260c204df",
      agentProof: "0x05eb59f6cf91d1ce47ece012c044e0df3f8a4205a1c33a962f7089d0c11fa030",
    };

const STEPS = [
  { title: "Identity", text: "A permanent agent id, owned by a wallet.", where: "AgentRegistry" },
  { title: "Control", text: "Allowed contracts, functions, and value.", where: "AgentFirewall" },
  { title: "Execution", text: "The call runs only through the firewall.", where: "AgentAction event" },
  { title: "Proof", text: "Receipt re-checked (14 checks), hash anchored onchain.", where: "AgentProof" },
  { title: "Outcome verdict", text: "Did the call achieve its purpose, not just succeed?", where: "Outcome adapters" },
  { title: "Publish", text: "Verdicts written where any wallet or agent reads them.", where: "ERC-8004 registries" },
] as const;

const TRUST = [
  {
    title: "One-click setup",
    text: "Connect once, confirm once (EIP-5792 batch). A scoped session key acts for the agent; everything after that verifies itself.",
    status: "Live in /demo",
    live: true,
  },
  {
    title: "Verifier quorum",
    text: "Proofs anchor only when k-of-n independent verifiers agree. Conflicts are marked disputed; anyone can challenge onchain.",
    status: "Tested · deploying",
    live: false,
  },
  {
    title: "Per-agent vaults",
    text: "Each agent calls through its own vault, so protocol payouts never sit in a shared contract. Session keys expire.",
    status: "Tested · deploying",
    live: false,
  },
] as const;

const SNIPPET = `import { traceCall } from "agenttrace-monad";

const r = await traceCall({
  network: "${IS_MAINNET ? "monad-mainnet" : "monad-testnet"}",
  signer: process.env.AGENT_KEY, // executor
  firewallId: 2,
  target, data,  // your agent's call
});

r.proofStatus  // "receipt_verified"
r.anchorTxHash // anchored in AgentProof
// off-policy: FIREWALL_REJECTED,
// nothing sent`;

function Home() {
  const { user, isPending } = useCurrentUserState();
  // Wallet-only deployments have no account to own a dashboard; everyone sees the product page.
  if (authEnabled && !isPending && user) return <YourAgents />;
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
      <section className="pt-2">
        <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-faint uppercase">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
          Live on {MONAD_TESTNET.label} · chain {MONAD_TESTNET.chainId}
        </p>
        <h1 className="type-display mt-5 max-w-2xl text-balance">Every agent leaves a trace.</h1>
        <p className="mt-5 max-w-xl text-base text-pretty text-muted">
          AgentTrace is an independent validator for onchain agents. It fences what an agent may call, checks from the
          Monad receipt whether the call achieved its purpose, and publishes that verdict to the shared ERC-8004
          registries, so anyone can read an agent's record without trusting this site.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link to="/proofs/$proofId" params={{ proofId: SHOWCASE.proof }} className={primaryClass}>
            See a verified execution
          </Link>
          <Link to="/demo" className={secondaryClass}>
            One-click demo
          </Link>
          {pending ? <div className="h-11 w-full animate-pulse rounded-sm bg-subtle sm:w-40" /> : null}
          {!pending && !authEnabled ? (
            <Link to="/agents/new" className={buttonClass("tertiary", "w-full justify-start px-0 sm:w-auto")}>
              Register an agent
            </Link>
          ) : null}
          {!pending && authEnabled && google ? (
            <button type="button" disabled={signingIn} onClick={createAgent} className={buttonClass("tertiary", "w-full justify-start px-0 sm:w-auto")}>
              {signingIn ? "Continuing…" : "Register an agent"}
            </button>
          ) : null}
        </div>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </section>

      <section className="mt-16 border-t border-border pt-8" aria-labelledby="how">
        <h2 id="how" className="text-sm font-medium">
          How one agent action is checked
        </h2>
        <ol className="mt-4 divide-y divide-border border-y border-border">
          {STEPS.map((step, index) => (
            <li key={step.title} className="grid grid-cols-[2.25rem_1fr] gap-x-4 gap-y-1 py-3 text-sm sm:grid-cols-[2.25rem_7rem_1fr_11rem] sm:items-baseline">
              <span className="font-mono text-xs text-faint">{String(index + 1).padStart(2, "0")}</span>
              <span className="font-medium">{step.title}</span>
              <span className="col-start-2 text-muted sm:col-start-auto">{step.text}</span>
              <span className="type-technical col-start-2 text-xs text-faint sm:col-start-auto sm:text-right">{step.where}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 grid gap-10 border-t border-border pt-8 md:grid-cols-[1fr_1.1fr]" aria-labelledby="any-agent">
        <div>
          <h2 id="any-agent" className="text-sm font-medium">
            Works with agents you already run
          </h2>
          <p className="mt-3 text-sm text-pretty text-muted">
            One SDK call routes an agent's transaction through its firewall and returns the proof. The same call ships as an MCP
            server, so Claude, Cursor, or any MCP host gets onchain tools that cannot step outside the policy.
          </p>
          <p className="mt-3 text-sm text-pretty text-muted">
            In a scripted MCP session the Treasury Agent read its policy, made a deposit that came back verified and
            anchored, and was refused a withdraw before anything was sent.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/proofs/$proofId" params={{ proofId: SHOWCASE.agentProof }} className="hover:underline">
              Agent's verified deposit
            </Link>
            <a href={`${REPO}/tree/main/agents/mcp-firewall`} className="text-muted hover:text-fg" rel="noreferrer">
              MCP server
            </a>
            <a href={`${REPO}/blob/main/docs/sdk.md`} className="text-muted hover:text-fg" rel="noreferrer">
              SDK docs
            </a>
          </div>
        </div>
        <pre className="type-technical overflow-x-auto rounded-sm border border-border bg-subtle/40 p-4 text-xs leading-relaxed text-muted">
          <code>{SNIPPET}</code>
        </pre>
      </section>

      <section className="mt-14 border-t border-border pt-8" aria-labelledby="trust">
        <h2 id="trust" className="text-sm font-medium">
          Trust model
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-pretty text-muted">
          What AgentTrace still asks you to trust, and how each part is being removed.
        </p>
        <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
          {TRUST.map((item) => (
            <li key={item.title} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr_9rem] sm:items-baseline sm:gap-4">
              <span className="font-medium">{item.title}</span>
              <span className="text-muted">{item.text}</span>
              <span className={`text-xs sm:text-right ${item.live ? "text-ok" : "text-faint"}`}>{item.status}</span>
            </li>
          ))}
        </ul>
        <a href={`${REPO}/blob/main/docs/trust-upgrades.md`} className="mt-3 inline-block text-sm text-muted hover:text-fg" rel="noreferrer">
          How disputes, vaults and session keys work
        </a>
      </section>

      <section className="mt-14 grid gap-10 border-t border-border pt-8 md:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium">Why an independent validator</h2>
          <p className="mt-3 text-sm text-pretty text-muted">
            An agent's own logs say what it meant to do. AgentTrace answers four questions from the chain instead: which agent
            acted, what it was allowed to do, what actually ran, and whether the intended result happened. A successful
            call and a verified outcome are separate verdicts.
          </p>
          <p className="mt-3 text-sm text-pretty text-muted">
            Verdicts go to the shared ERC-8004 Validation and Reputation registries, so a wallet, marketplace, or other agent can
            read an agent's record without trusting this interface.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-medium">Why Monad</h2>
          <dl className="mt-3 divide-y divide-border border-y border-border text-sm">
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Proof anchor</dt>
              <dd>179,045 gas · ≈0.018 MON at 102 gwei</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Firewall execute</dt>
              <dd>154,784 gas · ≈0.016 MON</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Finality</dt>
              <dd>2 blocks · ≈600 ms (Monad docs)</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Contracts</dt>
              <dd className="text-right">4 Solidity contracts on chain {MONAD_TESTNET.chainId}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-faint">Gas from real Monad receipts. Every step is an onchain write, so cost and finality decide whether this is practical.</p>
        </div>
      </section>
    </Shell>
  );
}
