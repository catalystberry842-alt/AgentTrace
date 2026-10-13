import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listConfigurableAgents, listMyIntents, listProofs } from "@/lib/agents/functions";
import type { ProofRecord, RegistrationIntent } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { LiveDot, LiveStatsStrip, StepExplorer, VerifyBox, usePolling } from "@/components/landing-live";
import { buttonClass, EmptyState, ErrorNote, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { formatAgentId, formatUtc, functionName, proofStatusLabel, statusLabel, statusTone } from "@/lib/format";
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

const EX = IS_MAINNET
  ? { agent: "1", firewall: "1", erc: "1", proof: "0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e" }
  : { agent: "13", firewall: "9", erc: "6", proof: "0xc9269fe97a92dadba1b32be0f755a88bb76f7fd3734260084940fa168cea030a" };

const STEPS = [
  { title: "Identity", text: "A permanent agent id, owned by a wallet.", where: "AgentRegistry", detail: "registerAgent() mints a sequential agent id owned by the wallet that signed it. The passport shows owner, capabilities and the registration transaction.", href: `/agents/${EX.agent}`, cta: `Agent #${EX.agent.padStart(3, "0")}` },
  { title: "Control", text: "Allowed contracts, functions, and value.", where: "AgentFirewall", detail: "The firewall holds the allow-list of targets and 4-byte selectors plus value caps. Anything else reverts before it reaches the target.", href: `/firewalls/${EX.firewall}`, cta: `Firewall #${EX.firewall.padStart(3, "0")}` },
  { title: "Execution", text: "The call runs only through the firewall.", where: "AgentAction event", detail: "execute() forwards the call and emits AgentAction with the execution id and calldata hash, so every action has one canonical onchain record.", href: `/agents/${EX.agent}/activity`, cta: "Agent activity" },
  { title: "Proof", text: "Receipt re-checked (14 checks), hash anchored onchain.", where: "AgentProof", detail: "AgentTrace re-reads the receipt, runs 14 checks, then anchors the proof hash in AgentProof. Anyone can rebuild it with the box below.", href: `/proofs/${EX.proof}`, cta: "A verified proof" },
  { title: "Outcome verdict", text: "Did the call achieve its purpose, not just succeed?", where: "Outcome adapters", detail: "An outcome adapter checks the protocol effect (e.g. the Deposited event and amount). What cannot be checked is unverifiable, never verified.", href: `/outcomes/${EX.proof}`, cta: "Its outcome" },
  { title: "Publish", text: "Verdicts written where any wallet or agent reads them.", where: "ERC-8004 registries", detail: "Proof and outcome verdicts go to the canonical ERC-8004 Validation and Reputation registries on Monad, readable without trusting this site.", href: `/agents/${EX.erc}`, cta: "ERC-8004 record" },
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
    status: IS_MAINNET ? "Live · 2-of-2 on mainnet" : "Live on mainnet",
    live: true,
  },
  {
    title: "Per-agent vaults",
    text: "Each agent calls through its own vault, so protocol payouts never sit in a shared contract. Session keys expire.",
    status: "Live on mainnet",
    live: true,
  },
] as const;

/** AgentFirewallV2 onchain argument cap: one real call allowed, one rejected by the contract. */
const ARGCAP = IS_MAINNET
  ? {
      explorer: "https://monadvision.com",
      contract: "0xf1b0365586d1867133c991046e2fd3006efe16e5",
      rule: "Agent #003 may call WMON.approve with amount ≤ 0.001 WMON",
      allowed: { label: "approve 0.0005 WMON · executed", tx: "0x8f6042f2280cefddd7dc8d4d3c1615bddffbaa548de276226276dbe5a6ab0acb" },
      blocked: { label: "approve 0.005 WMON · reverted onchain, ArgumentTooHigh", tx: "0x0d4b47c32fe3541a5758ec3c28e8736f949a1b38b28c54796faa9284faba3c32" },
      quorum: { label: "Allowed call anchored by 2-of-2 verifier quorum", tx: "0x5386516093a4d1a9d760bf322a0b57232612762ff2f23b245ba6f25884148ada" },
    }
  : {
      explorer: "https://testnet.monadvision.com",
      contract: "0x5b027151faa45e83ac1790a8bf5671388c640fb9",
      rule: "Agent #012 may call DemoProtocol.deposit with amount ≤ 500",
      allowed: { label: "deposit 100 · executed", tx: "0x347c1512b9ce49b8447271b596a5043eba6664a6a5f07902402ef99e133ed5e9" },
      blocked: null as null | { label: string; tx: string },
      quorum: null as null | { label: string; tx: string },
    };

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
    <Shell wide>
      <section className="grid gap-12 pt-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16 lg:pt-6">
        <div>
          <p className="flex items-center gap-2 font-mono text-xs tracking-widest text-faint uppercase">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
            Live on {MONAD_TESTNET.label} · chain {MONAD_TESTNET.chainId}
          </p>
          <h1 className="type-display mt-5 max-w-xl text-balance">A firewall and an onchain receipt for every AI agent call.</h1>
          <ol className="mt-5 flex max-w-lg flex-col gap-1.5 font-mono text-xs text-muted sm:flex-row sm:flex-wrap sm:gap-x-4">
            <li><span className="text-faint">1</span> Set what the agent may call</li>
            <li><span className="text-faint">2</span> It calls only through the firewall</li>
            <li><span className="text-faint">3</span> Each call gets a verified, anchored receipt</li>
          </ol>
          <p className="mt-5 max-w-lg text-base text-pretty text-muted">
            AgentTrace fences what an onchain agent may call, checks from the Monad receipt whether the call achieved its
            purpose, and publishes that verdict to the shared ERC-8004 registries, so anyone can read an agent's record
            without trusting this site.
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
              <Link to="/agents/new" className={buttonClass("tertiary", "w-full justify-start px-0 sm:w-auto sm:px-2")}>
                Register an agent →
              </Link>
            ) : null}
            {!pending && authEnabled && google ? (
              <button type="button" disabled={signingIn} onClick={createAgent} className={buttonClass("tertiary", "w-full justify-start px-0 sm:w-auto")}>
                {signingIn ? "Continuing…" : "Register an agent"}
              </button>
            ) : null}
          </div>
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </div>
        <RecentProofs />
      </section>

      <LiveStatsStrip />

      <div className="mt-6">
        <VerifyBox example={EX.proof} />
      </div>

      <section className="mt-16 border-t border-border pt-8" aria-labelledby="argcap">
        <h2 id="argcap" className="text-sm font-medium">
          Onchain amount cap, live
        </h2>
        <p className="mt-3 max-w-2xl text-sm text-pretty text-muted">
          {ARGCAP.rule}. The limit lives in{" "}
          <a href={`${ARGCAP.explorer}/address/${ARGCAP.contract}`} className="font-mono text-fg hover:underline" rel="noreferrer">
            AgentFirewallV2 {ARGCAP.contract.slice(0, 10)}…
          </a>
          , so a call above it reverts in the contract, not in this app.
        </p>
        <ul className="mt-4 divide-y divide-border border-y border-border text-sm">
          {[
            { tone: "text-ok", mark: "Allowed", row: ARGCAP.allowed },
            ...(ARGCAP.blocked ? [{ tone: "text-danger", mark: "Rejected", row: ARGCAP.blocked }] : []),
            ...(ARGCAP.quorum ? [{ tone: "text-ok", mark: "Anchored", row: ARGCAP.quorum }] : []),
          ].map(({ tone, mark, row }) => (
            <li key={row.tx} className="flex flex-col gap-1 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span>
                <span className={`mr-3 font-mono text-xs ${tone}`}>{mark}</span>
                {row.label}
              </span>
              <a href={`${ARGCAP.explorer}/tx/${row.tx}`} className="font-mono text-xs text-muted hover:text-fg" rel="noreferrer">
                {row.tx.slice(0, 10)}…
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-14 border-t border-border pt-8" aria-labelledby="how">
        <h2 id="how" className="text-sm font-medium">
          How one agent action is checked
        </h2>
        <StepExplorer steps={STEPS} />
      </section>

      <section className="mt-14 grid gap-10 border-t border-border pt-8 lg:grid-cols-[1fr_1.1fr] lg:gap-16" aria-labelledby="any-agent">
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
        <pre className="type-technical overflow-x-auto rounded-lg border border-border bg-surface p-5 text-xs leading-relaxed text-muted">
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
        <ul className="mt-5 grid gap-4 text-sm md:grid-cols-3">
          {TRUST.map((item) => (
            <li key={item.title} className="flex flex-col rounded-lg border border-border bg-surface p-5">
              <span className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{item.title}</span>
                <span className={`text-xs ${item.live ? "text-ok" : "text-faint"}`}>{item.status}</span>
              </span>
              <span className="mt-2 text-muted">{item.text}</span>
            </li>
          ))}
        </ul>
        <a href={`${REPO}/blob/main/docs/trust-upgrades.md`} className="mt-3 inline-block text-sm text-muted hover:text-fg" rel="noreferrer">
          How disputes, vaults and session keys work
        </a>
      </section>

      <section className="mt-14 grid gap-10 border-t border-border pt-8 lg:grid-cols-2 lg:gap-16">
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
              <dt className="text-muted">Proof anchor (one verifier)</dt>
              <dd>179,045 gas · ≈0.018 MON at 102 gwei</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Proof anchor (2-of-2 quorum)</dt>
              <dd>248,697 + 110,178 gas · ≈0.037 MON</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Firewall execute</dt>
              <dd>154,784 gas · ≈0.016 MON</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Block interval</dt>
              <dd>≈0.30 s (measured, 10,000 mainnet blocks)</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 py-2.5">
              <dt className="text-muted">Finality</dt>
              <dd>2 blocks · ≈600 ms (Monad docs)</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-pretty text-faint">
            Gas from real Monad mainnet receipts (13 Oct 2026, 102 gwei). A per-call receipt means two extra writes per agent
            action: the firewall call and the anchor. At about 0.034 MON (0.016 + 0.018) and under a second per action that is practical for every
            call, not a sample.
          </p>
        </div>
      </section>
    </Shell>
  );
}

const loadProofs = () => listProofs();

function RecentProofs() {
  const [proofs, setProofs] = useState<ProofRecord[] | null>(null);
  const [error, setError] = useState(false);
  const live = usePolling(loadProofs, 15_000);
  useEffect(() => {
    if (live.data) setProofs(live.data.proofs.slice(0, 6));
    if (live.error && !live.data) setError(true);
  }, [live.data, live.error]);
  return (
    <div className="min-w-0 self-start rounded-lg border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <h2 className="flex items-center gap-3 text-sm font-medium">
          Latest executions <LiveDot />
        </h2>
        <Link to="/proofs" className="text-xs text-muted hover:text-fg">
          All proofs →
        </Link>
      </div>
      {error ? <p className="px-5 py-6 text-sm text-muted">Could not read proofs right now.</p> : null}
      {proofs === null && !error ? (
        <div className="space-y-3 px-5 py-5" aria-hidden>
          {[0, 1, 2, 3].map((n) => (
            <span key={n} className="skeleton block h-8 w-full" />
          ))}
        </div>
      ) : null}
      {proofs && proofs.length === 0 ? <p className="px-5 py-6 text-sm text-muted">No executions indexed yet.</p> : null}
      {proofs && proofs.length > 0 ? (
        <ul className="divide-y divide-border">
          {proofs.map((proof) => (
            <li key={proof.executionId}>
              <Link
                to="/proofs/$proofId"
                params={{ proofId: proof.executionId }}
                className="grid grid-cols-1 gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-subtle sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
              >
                <span className="truncate">
                  {proof.agentName || "Agent"} <span className="font-mono text-xs text-faint">{formatAgentId(proof.agentId)}</span>
                </span>
                <StatusText tone={proof.verificationStatus === "receipt_verified" ? "ok" : proof.verificationStatus === "unverifiable" ? "danger" : "pending"}>
                  {proofStatusLabel(proof.verificationStatus, proof.anchored)}
                </StatusText>
                <span className="truncate font-mono text-xs text-muted">
                  {proof.executionId.slice(0, 10)}…{proof.executionId.slice(-6)} · {functionName(proof.functionSelector) ?? proof.functionSelector}
                </span>
                <span className="text-xs text-faint sm:text-right">{formatUtc(proof.blockTimestamp ?? proof.createdAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
