import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  attachRegistrationTx,
  getAgentLayers,
  getMyIntent,
  getPublicAgent,
  refreshIntent,
} from "@/lib/agents/functions";
import type { AgentReputation, ExecutionRecord, FirewallRecord, HistoryEntry, IndexedAgent, OutcomeRecord, ProofRecord, RegistrationIntent } from "@/lib/agents/types";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { AgentFrame } from "@/components/agent-nav";
import { Lifecycle, type StageState } from "@/components/lifecycle";
import { Shell } from "@/components/shell";
import { Button, ErrorNote, Fact, Mono, Note, NotFoundState, PassportSkeleton, Section, SkeletonLines, StatusText, buttonClass } from "@/components/ui";
import { AddressValue, CopyButton, TxValue } from "@/components/values";
import { formatAgentId, formatUtc, formatWei, statusLabel, statusTone } from "@/lib/format";

export const Route = createFileRoute("/agents/$agentId/")({ component: AgentRoute });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function AgentRoute() {
  const { agentId } = Route.useParams();
  const { user, isPending } = useCurrentUserState();
  const chainId = /^\d+$/.test(agentId);

  if (!chainId && !UUID.test(agentId)) {
    return (
      <Shell wide>
        <Missing />
      </Shell>
    );
  }
  if (!chainId && isPending) {
    return (
      <Shell wide>
        <PassportSkeleton />
      </Shell>
    );
  }
  if (!chainId && !user) return <RedirectToSignIn />;

  return chainId ? <PublicAgent agentId={agentId} /> : (
    <Shell wide>
      <IntentAgent intentId={agentId} />
    </Shell>
  );
}

function Missing() {
  return (
    <NotFoundState
      title="Agent not found"
      description="The requested agent does not exist or is no longer available."
      action={
        <Link to="/agents" className={buttonClass("secondary")}>
          Back to agents
        </Link>
      }
    />
  );
}

function PublicAgent({ agentId }: { agentId: string }) {
  const [agent, setAgent] = useState<IndexedAgent | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPublicAgent({ data: agentId })
      .then((result) => {
        if (cancelled) return;
        setAgent(result.agent);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this agent.");
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
  if (agent === undefined) {
    return (
      <Shell wide>
        <PassportSkeleton />
      </Shell>
    );
  }
  if (!agent) {
    return (
      <Shell wide>
        <Missing />
      </Shell>
    );
  }
  return <AgentProfile agent={agent} />;
}

function IntentAgent({ intentId }: { intentId: string }) {
  const [intent, setIntent] = useState<RegistrationIntent | null | undefined>(undefined);
  const [registry, setRegistry] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getMyIntent({ data: intentId })
      .then((result) => {
        if (cancelled) return;
        setIntent(result.intent);
        setRegistry(result.registry);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this agent.");
      });
    return () => {
      cancelled = true;
    };
  }, [intentId]);

  useEffect(() => {
    if (intent?.status !== "pending") return;
    const timer = window.setInterval(() => {
      void refreshIntent({ data: intentId })
        .then((result) => {
          setIntent(result.intent);
          setRegistry(result.registry);
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [intent?.status, intentId]);

  async function refresh() {
    setBusy("Refresh status");
    setError(null);
    try {
      const result = await refreshIntent({ data: intentId });
      setIntent(result.intent);
      setRegistry(result.registry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh this record.");
    } finally {
      setBusy(null);
    }
  }

  async function register() {
    if (!intent) return;
    if (!registry) {
      setError("Agent Registry is not deployed. No transaction was sent and no agent id was assigned.");
      return;
    }
    setBusy("Waiting for wallet…");
    setError(null);
    try {
      const { sendRegisterTransaction } = await import("@/lib/chain/wallet");
      const hash = await sendRegisterTransaction({
        registry: registry as `0x${string}`,
        name: intent.name,
        description: intent.description,
        metadataURI: intent.metadataURI,
        capabilities: intent.capabilities,
      });
      setBusy("Creating agent identity...");
      const result = await attachRegistrationTx({ data: { intentId: intent.id, txHash: hash } });
      setIntent(result.intent);
      setRegistry(result.registry);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent creation failed.");
    } finally {
      setBusy(null);
    }
  }

  if (error && !intent) return <ErrorNote>{error}</ErrorNote>;
  if (intent === undefined) return <SkeletonLines />;
  if (!intent) return <Missing />;

  return (
    <article>
      <header>
        <h1 className="text-2xl font-medium tracking-tight">{intent.name}</h1>
        <p className="mt-3">
          <StatusText tone={statusTone(intent.status)}>{statusLabel(intent.status)}</StatusText>
        </p>
      </header>
      <div className="mt-6">
        <Setup intent={intent} />
      </div>
      {error ? (
        <div className="mt-4">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      <div className="mt-6 flex flex-wrap gap-3">
        {intent.status === "pending" ? (
          <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void refresh()}>
            {busy ?? "Refresh status"}
          </Button>
        ) : null}
        {intent.status === "draft" || intent.status === "failed" ? (
          <Button type="button" disabled={Boolean(busy)} onClick={() => void register()}>
            {busy ?? "Submit registration"}
          </Button>
        ) : null}
        {intent.chainAgentId ? (
          <Link
            to="/agents/$agentId"
            params={{ agentId: intent.chainAgentId }}
            className="inline-flex h-11 items-center text-sm text-muted hover:text-fg"
          >
            View onchain record
          </Link>
        ) : null}
      </div>
      <Section title="Identity">
        <dl>
          <Fact label="Record">
            <Mono>{intent.id}</Mono>
          </Fact>
          <Fact label="Agent ID">
            {intent.chainAgentId ? <Mono>{intent.chainAgentId}</Mono> : "Assigned when the registry transaction confirms."}
          </Fact>
          <Fact label="Created">{formatUtc(intent.createdAt)}</Fact>
        </dl>
      </Section>
      <Section title="Owner">
        <dl>
          <Fact label="Address">
            <AddressValue value={intent.ownerAddress} />
          </Fact>
        </dl>
        {!intent.ownerAddress ? (
          <p className="pt-3 text-sm text-muted">
            Not set. A wallet is requested only when registration is submitted.
          </p>
        ) : null}
      </Section>
      <Section title="Capabilities">
        <p className="text-sm">{intent.capabilities.join(", ")}</p>
      </Section>
      <Section title="Metadata">
        <MetadataValue value={intent.metadataURI} />
      </Section>
      <Section title="Description">
        <p className="text-sm text-pretty">{intent.description}</p>
      </Section>
      {intent.txHash ? (
        <Section title="Transaction">
          <TxValue hash={intent.txHash} />
        </Section>
      ) : null}
    </article>
  );
}

function Setup({ intent }: { intent: RegistrationIntent }) {
  if (intent.status === "draft") {
    return (
      <Note>
        This is a draft. It is not an onchain identity until a registry transaction is confirmed and indexed.
      </Note>
    );
  }
  if (intent.status === "pending") {
    return (
      <Note>
        Creating agent identity. This stays pending until AgentRegistered is read from Monad and indexed.
      </Note>
    );
  }
  if (intent.status === "failed") {
    return <Note>{intent.error ?? "Agent creation failed. No agent id was assigned."}</Note>;
  }
  if (intent.status === "inactive") {
    return <Note>This identity was deactivated on Monad. The id is not reused.</Note>;
  }
  return <Note>This identity is active. The agent id comes from the indexed AgentRegistered event.</Note>;
}

function AgentProfile({ agent }: { agent: IndexedAgent }) {
  const [layers, setLayers] = useState<{
    executions: ExecutionRecord[];
    proofs: ProofRecord[];
    firewalls: FirewallRecord[];
    reputation: AgentReputation | null;
    timeline: HistoryEntry[];
    outcomes: OutcomeRecord[];
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAgentLayers({ data: agent.agentId })
      .then((result) => {
        if (!cancelled) setLayers(result);
      })
      .catch(() => {
        if (!cancelled) {
          setLayers({ executions: [], proofs: [], firewalls: [], reputation: null, timeline: [], outcomes: [] });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent.agentId]);

  const firewalls = layers?.firewalls ?? [];
  const executions = layers?.executions ?? [];
  const reputation = layers?.reputation ?? null;
  const activeFirewall = firewalls.find((item) => item.status === "active");
  const controlReady = Boolean(
    activeFirewall &&
      activeFirewall.allowedTargets.some((target) => target.active) &&
      activeFirewall.allowedFunctions.some((rule) => rule.active),
  );
  const hasExecution = executions.length > 0 || (reputation?.totalExecutions ?? 0) > 0;
  const hasProof = (reputation?.verifiedExecutions ?? 0) > 0;
  const hasOutcome = (reputation?.verifiedOutcomes ?? 0) > 0;

  return (
    <AgentFrame
      agentId={agent.agentId}
      name={agent.name}
      section="overview"
      status={agent.active ? "Active" : "Inactive"}
      description={agent.description || "No description."}
    >
      {layers && firewalls.length === 0 ? (
        <div className="mb-10">
          <p className="text-sm font-medium">Your agent identity is ready.</p>
          <p className="mt-2 max-w-xl text-sm text-muted">Next, create a firewall to control what this agent is allowed to execute.</p>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link to="/agents/$agentId/firewall" params={{ agentId: agent.agentId }} className={buttonClass("primary", "w-full sm:w-auto")}>
              Create firewall
            </Link>
            <a href="#identity" className={buttonClass("tertiary", "justify-start px-0")}>
              View identity
            </a>
          </div>
        </div>
      ) : null}
      {layers ? (
        <Lifecycle
          stages={{
            Identity: { state: "complete", detail: agent.active ? "Complete" : "Inactive" },
            Control: stage(controlReady, true, "Configured", firewalls.length ? "Finish setup" : "Set up"),
            Execution: stage(hasExecution, controlReady, "Recorded", "No activity"),
            Proof: stage(hasProof, hasExecution, "Verified", "No verified executions"),
            Outcome: stage(hasOutcome, hasProof, "Verified", "No verified outcomes"),
          }}
        />
      ) : (
        <div className="h-20 animate-pulse rounded-sm bg-subtle" aria-hidden />
      )}
      <div className="mt-10 grid gap-x-10 md:grid-cols-[1.3fr_1fr_1fr]">
        <div id="identity">
          <Section title="Identity">
          <dl>
            <Fact label="Owner">
              <AddressValue value={agent.owner} copy explorer />
            </Fact>
            <Fact label="Capabilities">{agent.capabilities.length ? agent.capabilities.join(" · ") : "None recorded."}</Fact>
            <Fact label="Network">Monad testnet</Fact>
            <Fact label="Created">
              <span className="whitespace-nowrap">{formatUtc(agent.registeredAt)}</span>
            </Fact>
            {agent.txHash ? (
              <Fact label="Registration">
                <TxValue hash={agent.txHash} copy />
              </Fact>
            ) : null}
          </dl>
        </Section>
        </div>
        <Section title="Control">
          {layers === null ? (
            <div className="h-16 animate-pulse rounded-sm bg-subtle" aria-hidden />
          ) : firewalls.length === 0 ? (
            <p className="text-sm text-muted">No firewall configured</p>
          ) : (
            firewalls.map((item) => <FirewallSummary key={item.id} firewall={item} agentId={agent.agentId} />)
          )}
        </Section>
        <Section title="Verified history">
          {reputation ? (
            <dl>
              <Fact label="Executions">{reputation.verifiedExecutions} verified</Fact>
              <Fact label="Outcomes">{reputation.verifiedOutcomes} verified</Fact>
              <Fact label="Last activity">
                <span className="whitespace-nowrap">{formatUtc(reputation.lastActivityAt)}</span>
              </Fact>
            </dl>
          ) : (
            <div className="h-16 animate-pulse rounded-sm bg-subtle" aria-hidden />
          )}
        </Section>
      </div>

      <Section title="Recent activity">
        {layers === null ? (
          <div className="h-10 animate-pulse rounded-sm bg-subtle" aria-hidden />
        ) : executions.length === 0 ? (
          <div>
            <p className="text-sm font-medium">No executions yet</p>
            <p className="mt-2 text-sm text-muted">
              {firewalls.length === 0
                ? "Create a firewall before this agent can execute anything."
                : "Successful executions will appear here with their verification status."}
            </p>
            {firewalls.length > 0 ? (
              <Link to="/agents/$agentId/firewall" params={{ agentId: agent.agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
                View firewall
              </Link>
            ) : null}
          </div>
        ) : (
          <div>
            <ul className="divide-y divide-border border-y border-border">
              {executions.slice(0, 5).map((row) => (
                <li key={row.id} className="grid gap-1 py-3 text-sm md:grid-cols-4 md:items-center">
                  <Link to="/proofs/$proofId" params={{ proofId: row.id }} className="hover:underline">
                    <Mono>{row.action}</Mono>
                  </Link>
                  <span className="text-muted">{formatWei(row.value)}</span>
                  <span className="text-muted">{formatUtc(row.timestamp)}</span>
                  <TxValue hash={row.txHash} />
                </li>
              ))}
            </ul>
            <Link to="/agents/$agentId/activity" params={{ agentId: agent.agentId }} className="mt-3 inline-flex h-11 items-center text-sm text-muted hover:text-fg">
              All activity
            </Link>
          </div>
        )}
      </Section>
    </AgentFrame>
  );
}

function FirewallSummary({ firewall, agentId }: { firewall: FirewallRecord; agentId: string }) {
  const targets = firewall.allowedTargets.filter((target) => target.active);
  const functions = firewall.allowedFunctions.filter((rule) => rule.active);
  const ready = targets.length > 0 && functions.length > 0 && firewall.status === "active";
  return (
    <div>
      <p className="text-sm">
        <Link to="/agents/$agentId/firewall" params={{ agentId }} className="hover:underline">
          Firewall {formatAgentId(firewall.id)}
        </Link>
      </p>
      <p className="mt-2 text-sm text-muted">
        Executor <AddressValue value={firewall.executor} />
        {" · "}
        {firewall.status === "active" ? "Active" : firewall.status === "paused" ? "Paused" : "Inactive"}
        {" · "}
        {targets.length ? `${targets.length} target${targets.length === 1 ? "" : "s"}` : "No targets allowed"}
        {" · "}
        {functions.length ? `${functions.length} function${functions.length === 1 ? "" : "s"}` : "No functions allowed"}
      </p>
      {targets.length === 0 ? (
        <Link to="/agents/$agentId/firewall" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
          Add target
        </Link>
      ) : null}
      {targets.length > 0 && functions.length === 0 ? (
        <Link to="/agents/$agentId/firewall" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
          Add function
        </Link>
      ) : null}
      {ready ? (
        <Link to="/agents/$agentId/firewall" params={{ agentId }} className="mt-3 inline-flex h-11 items-center text-sm hover:underline">
          Ready for execution
        </Link>
      ) : null}
    </div>
  );
}

function stage(done: boolean, unlocked: boolean, doneLabel: string, waiting: string): { state: StageState; detail: string } {
  if (done) return { state: "complete", detail: doneLabel };
  if (unlocked) return { state: "current", detail: waiting };
  return { state: "later", detail: waiting };
}

function MetadataValue({ value }: { value: string }) {
  if (!value) return <p className="text-sm text-muted">None</p>;
  if (value.startsWith("https://")) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <a href={value} className="text-sm break-all underline-offset-4 hover:underline" rel="noreferrer">
          {value}
        </a>
        <CopyButton value={value} label="metadata URI" />
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Mono>{value}</Mono>
      <CopyButton value={value} label="metadata" />
    </span>
  );
}
