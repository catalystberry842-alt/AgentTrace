import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getAgentLayers, getChainStatus, getFirewall, getPublicAgent, refreshFirewallIntent, submitFirewall } from "@/lib/agents/functions";
import type { FirewallAction, FirewallIntentStatus, FirewallRecord, IndexedAgent } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { AgentFrame } from "@/components/agent-nav";
import { FirewallControls } from "@/routes/firewalls/$firewallId";
import { Shell } from "@/components/shell";
import { TxStatus } from "@/components/tx-status";
import { Button, ErrorNote, Fact, FirewallSkeleton, Mono, NotFoundState, SkeletonLines, StatusText, buttonClass } from "@/components/ui";
import { AddressValue, TxValue } from "@/components/values";
import { formatAgentId, formatDuration, formatWei, statusTone } from "@/lib/format";

export const Route = createFileRoute("/agents/$agentId/firewall")({ component: AgentFirewallPage });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

type RecordState = {
  id: string;
  status: FirewallIntentStatus;
  txHash: string | null;
  chainFirewallId: string | null;
  detail: string | null;
};

function AgentFirewallPage() {
  const { agentId } = Route.useParams();
  const valid = /^[1-9]\d*$/.test(agentId);
  const [agent, setAgent] = useState<IndexedAgent | null | undefined>(valid ? undefined : null);
  const [firewalls, setFirewalls] = useState<FirewallRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    setAgent(undefined);
    setFirewalls(null);
    getPublicAgent({ data: agentId })
      .then(async (result) => {
        if (cancelled) return;
        setAgent(result.agent);
        if (!result.agent) {
          setFirewalls([]);
          return;
        }
        const layers = await getAgentLayers({ data: agentId });
        if (!cancelled) setFirewalls(layers.firewalls);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this firewall.");
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, valid, reloadKey]);

  if (!valid || agent === null) {
    return (
      <Shell wide>
        <NotFoundState title="Agent not found" description="The requested agent does not exist or is no longer available." action={<Link to="/agents" className={buttonClass("secondary")}>Back to agents</Link>} />
      </Shell>
    );
  }
  if (error) {
    return (
      <Shell wide>
        <ErrorNote>{error}</ErrorNote>
      </Shell>
    );
  }
  if (!agent || firewalls === null) {
    return (
      <Shell wide>
        <FirewallSkeleton />
      </Shell>
    );
  }

  const primary = firewalls[0] ?? null;
  return (
    <AgentFrame
      agentId={agent.agentId}
      name={agent.name}
      section="firewall"
      status={agent.active ? "Active" : "Inactive"}
      title={primary ? `Firewall ${formatAgentId(primary.id)}` : "Create firewall"}
      description={primary ? undefined : "What is this agent allowed to do?"}
    >
      {primary ? (
        <FirewallView
          firewalls={firewalls}
          onReload={async () => setReloadKey((value) => value + 1)}
        />
      ) : (
        <CreateFirewall agent={agent} onCreated={() => setReloadKey((value) => value + 1)} />
      )}
    </AgentFrame>
  );
}

function FirewallView({ firewalls, onReload }: { firewalls: FirewallRecord[]; onReload: () => Promise<unknown> }) {
  const [selectedId, setSelectedId] = useState(firewalls[0]?.id ?? "");
  const [record, setRecord] = useState<FirewallRecord | null>(firewalls.find((item) => item.id === selectedId) ?? firewalls[0] ?? null);
  const [actions, setActions] = useState<FirewallAction[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = firewalls.find((item) => item.id === selectedId) ?? firewalls[0];
    if (!current) return;
    setSelectedId(current.id);
    let cancelled = false;
    getFirewall({ data: current.id })
      .then((result) => {
        if (cancelled) return;
        setRecord(result.firewall);
        setActions(result.actions);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this firewall.");
      });
    return () => {
      cancelled = true;
    };
  }, [firewalls, selectedId]);

  if (!record) return null;
  const targets = record.allowedTargets.filter((target) => target.active);
  const functions = record.allowedFunctions.filter((rule) => rule.active);
  const status = record.status === "active" ? "Active" : record.status === "paused" ? "Paused" : "Inactive";
  const ready = record.status === "active" && targets.length > 0 && functions.length > 0;
  const primary =
    record.status === "paused"
      ? { href: "#edit-permissions", label: "Unpause firewall" }
      : targets.length === 0
        ? { href: "#add-target", label: "Add target" }
        : functions.length === 0
          ? { href: "#add-function", label: "Add function" }
          : { href: "#execute-action", label: "Execute action" };

  return (
    <div>
      {firewalls.length > 1 ? (
        <div className="mb-6 flex flex-wrap gap-2">
          {firewalls.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === record.id}
              className={`h-11 rounded-sm border px-3 text-sm ${item.id === record.id ? "border-border-strong bg-subtle" : "border-border text-muted"}`}
              onClick={() => setSelectedId(item.id)}
            >
              Firewall {formatAgentId(item.id)}
            </button>
          ))}
        </div>
      ) : null}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <StatusText tone={statusTone(record.status)}>{status}</StatusText>
        <span className="text-muted">What is this agent allowed to do?</span>
      </p>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <a href={primary.href} className={buttonClass("primary", "w-full sm:w-auto")}>
          {primary.label}
        </a>
        <a href="#edit-permissions" className={buttonClass("tertiary", "justify-start px-0")}>
          Edit firewall
        </a>
      </div>
      {!ready ? (
        <p className="mt-6 text-sm">
          {targets.length === 0 ? "No targets allowed. " : functions.length === 0 ? "No functions allowed. " : record.status === "paused" ? "This firewall is paused. " : "Not ready for execution. "}
          {targets.length === 0 ? (
            <a href="#add-target" className="underline-offset-4 hover:underline">
              Add target
            </a>
          ) : functions.length === 0 ? (
            <a href="#add-function" className="underline-offset-4 hover:underline">
              Add function
            </a>
          ) : (
            <a href="#edit-permissions" className="underline-offset-4 hover:underline">
              Review permissions
            </a>
          )}
        </p>
      ) : (
        <p className="mt-6 text-sm text-muted">Ready for execution.</p>
      )}
      {error ? (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      <dl className="mt-8 border-t border-border">
        <Fact label="Executor">
          <AddressValue value={record.executor} copy />
        </Fact>
        <Fact label="Value transfers">{record.allowValueTransfer ? "Allowed" : "Disabled"}</Fact>
        <Fact label="Maximum transaction value">
          {record.allowValueTransfer ? formatWei(record.maxValuePerTransaction) : "Value transfer disabled"}
        </Fact>
        <Fact label="Maximum period spend">
          {record.allowValueTransfer
            ? `${formatWei(record.maxValuePerPeriod)} / ${formatDuration(record.periodDuration)}`
            : "Value transfer disabled"}
        </Fact>
        <Fact label="Spent in period">{formatWei(record.spentInPeriod)}</Fact>
      </dl>
      <section className="mt-10">
        <h2 className="text-sm font-medium">Allowed targets</h2>
        {targets.length ? (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {targets.map((target) => (
              <li key={target.target} className="py-3 text-sm">
                <span>{target.name || "Target"}</span>
                <span className="mt-1 block">
                  <Mono>{target.target}</Mono>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            None.{" "}
            <a href="#add-target" className="text-fg underline-offset-4 hover:underline">
              Add target
            </a>
          </p>
        )}
      </section>
      <section className="mt-10">
        <h2 className="text-sm font-medium">Allowed functions</h2>
        {functions.length ? (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {functions.map((rule) => (
              <li key={`${rule.target}-${rule.selector}`} className="py-3 text-sm">
                <Mono>{rule.selector}</Mono>
                <span className="mt-1 block break-all text-muted">{rule.target}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">
            None.{" "}
            <a href="#add-function" className="text-fg underline-offset-4 hover:underline">
              Add function
            </a>
          </p>
        )}
      </section>
      <section className="mt-10">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-sm font-medium">Recent executions</h2>
          <Link to="/agents/$agentId/activity" params={{ agentId: record.agentId }} className="text-sm text-muted hover:text-fg">
            All activity
          </Link>
        </div>
        {actions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            No activity yet.{" "}
            {ready ? (
              <a href="#execute-action" className="text-fg underline-offset-4 hover:underline">
                Execute an action
              </a>
            ) : (
              "Configure a target and a function first."
            )}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {actions.slice(0, 5).map((action) => (
              <li key={action.executionId} className="grid gap-1 py-3 text-sm md:grid-cols-4">
                <Link to="/proofs/$proofId" params={{ proofId: action.executionId }} className="hover:underline">
                  <Mono>{action.selector}</Mono>
                </Link>
                <span className="break-all text-muted">{action.target}</span>
                <span className="text-muted">{formatWei(action.value)}</span>
                <TxValue hash={action.txHash} />
              </li>
            ))}
          </ul>
        )}
      </section>
      <FirewallControls
        firewall={record}
        onReload={async () => {
          const fresh = await getFirewall({ data: record.id });
          if (fresh.firewall) setRecord(fresh.firewall);
          setActions(fresh.actions);
          await onReload();
        }}
      />
    </div>
  );
}

function CreateFirewall({ agent, onCreated }: { agent: IndexedAgent; onCreated: () => void }) {
  const { user, isPending } = useCurrentUserState();
  const [executor, setExecutor] = useState("");
  const [allowValue, setAllowValue] = useState(false);
  const [maxTx, setMaxTx] = useState("0");
  const [maxPeriod, setMaxPeriod] = useState("0");
  const [period, setPeriod] = useState("86400");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"awaiting_signature" | "submitting" | null>(null);
  const [record, setRecord] = useState<RecordState | null>(null);

  const created = useRef(onCreated);
  created.current = onCreated;

  useEffect(() => {
    if (!record || record.status !== "pending" || !record.id) return;
    let stop = false;
    const timer = window.setInterval(() => {
      void refreshFirewallIntent({ data: record.id })
        .then((result) => {
          if (stop) return;
          const next = {
            id: result.intent.id,
            status: result.intent.status,
            txHash: result.intent.txHash,
            chainFirewallId: result.intent.chainFirewallId,
            detail: result.intent.error,
          };
          setRecord(next);
          if (next.status === "active") created.current();
        })
        .catch((err: unknown) => {
          if (!stop) setError(err instanceof Error ? err.message : "Could not refresh the transaction.");
        });
    }, 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [record]);

  if (isPending) return <SkeletonLines />;
  if (!user) {
    return (
      <div>
        <p className="text-sm text-muted">No firewall configured.</p>
        {authEnabled && google ? (
          <button
            type="button"
            className="mt-4 inline-flex h-11 items-center justify-center rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg"
            onClick={() => void signIn(google.providerId, { callbackURL: `/agents/${agent.agentId}/firewall` })}
          >
            Sign in to create a firewall
          </button>
        ) : (
          <p className="mt-3 text-sm text-muted">Sign in is not available.</p>
        )}
      </div>
    );
  }

  if (phase) return <TxStatus title="Creating firewall" phase={phase} />;

  if (record?.status === "pending") {
    return <TxStatus title="Creating firewall" phase="pending" hash={record.txHash} />;
  }

  if (record?.status === "failed") {
    return (
      <div>
        <TxStatus title="Firewall creation failed" phase="failed" hash={record.txHash} detail={record.detail} />
        <Button type="button" className="mt-8" onClick={() => setRecord(null)}>
          Retry
        </Button>
      </div>
    );
  }

  const txLimit = allowValue ? maxTx.trim() : "0";
  const periodLimit = allowValue ? maxPeriod.trim() : "0";

  function advance() {
    setError(null);
    if (step === 0 && (!/^0x[a-fA-F0-9]{40}$/.test(executor.trim()) || /^0x0{40}$/i.test(executor.trim()))) {
      setError("Executor must be a non-zero address.");
      return;
    }
    if (step === 2) {
      if (!/^[1-9]\d*$/.test(period.trim())) {
        setError("Period length must be greater than zero.");
        return;
      }
      if (allowValue && (!/^[1-9]\d*$/.test(maxTx.trim()) || !/^\d+$/.test(maxPeriod.trim()))) {
        setError("Enter a per-transaction limit and a period limit.");
        return;
      }
    }
    setStep((value) => Math.min(value + 1, 3));
  }

  async function create() {
    setError(null);
    const draft = {
      agentId: agent.agentId,
      executor: executor.trim(),
      allowValueTransfer: allowValue,
      maxValuePerTransaction: allowValue ? maxTx.trim() : "0",
      maxValuePerPeriod: allowValue ? maxPeriod.trim() : "0",
      periodDuration: period.trim(),
    };
    setPhase("awaiting_signature");
    try {
      const chain = await getChainStatus();
      if (!chain.firewall) {
        setPhase(null);
        setRecord({
          id: "",
          status: "failed",
          txHash: null,
          chainFirewallId: null,
          detail: "Agent Firewall is not deployed. No transaction was sent and no firewall id was assigned.",
        });
        return;
      }
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const hash = await sendFirewallTransaction({
        to: chain.firewall as `0x${string}`,
        functionName: "createFirewall",
        args: [
          BigInt(draft.agentId),
          draft.executor as `0x${string}`,
          draft.allowValueTransfer,
          BigInt(draft.maxValuePerTransaction),
          BigInt(draft.maxValuePerPeriod),
          BigInt(draft.periodDuration),
        ],
      });
      setPhase("submitting");
      const result = await submitFirewall({ data: { ...draft, txHash: hash } });
      const next = {
        id: result.intent.id,
        status: result.intent.status,
        txHash: result.intent.txHash,
        chainFirewallId: result.intent.chainFirewallId,
        detail: result.intent.error,
      };
      setRecord(next);
      if (next.status === "active") onCreated();
    } catch (err) {
      setRecord({
        id: "",
        status: "failed",
        txHash: null,
        chainFirewallId: null,
        detail: err instanceof Error ? err.message : "Firewall creation failed.",
      });
    } finally {
      setPhase(null);
    }
  }

  const titles = ["Who can execute?", "What can it do?", "Value limits", "Review"] as const;

  return (
    <div>
      <p className="text-sm text-muted">
        Step {step + 1} of {titles.length} · {agent.name}
      </p>
      <h2 className="mt-2 text-2xl font-medium tracking-tight">{titles[step]}</h2>
      {error ? (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {step === 0 ? (
        <label className="mt-8 block">
          <span className="text-sm text-muted">Executor address</span>
          <input
            value={executor}
            spellCheck={false}
            placeholder="0x…"
            onChange={(event) => setExecutor(event.target.value.trim())}
            className="mt-2 h-11 w-full rounded-sm border border-border bg-elevated px-3 text-sm outline-none focus-visible:border-border-strong"
          />
          <span className="mt-2 block max-w-md text-sm text-muted">The executor is the identity allowed to submit actions through this firewall. It cannot change the firewall.</span>
        </label>
      ) : null}
      {step === 1 ? (
        <div className="mt-6 max-w-md space-y-3 text-sm text-muted">
          <p>Targets are contracts this agent is allowed to interact with.</p>
          <p>Functions are specific actions allowed on those contracts.</p>
          <p>This transaction does not allow any contract yet. After the firewall exists, you allow a target and a function in separate transactions.</p>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="mt-8 space-y-4">
          <label className="flex h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={allowValue}
              onChange={(event) => {
                const next = event.target.checked;
                setAllowValue(next);
                if (!next) {
                  setMaxTx("0");
                  setMaxPeriod("0");
                } else if (maxTx === "0") {
                  setMaxTx("");
                  setMaxPeriod("");
                }
              }}
            />
            Allow value transfer
          </label>
          <p className="max-w-md text-sm text-muted">
            {allowValue ? "Set a maximum in wei per transaction and per period." : "Left off, this firewall cannot move value."}
          </p>
          {allowValue ? (
            <>
              <input
                inputMode="numeric"
                value={maxTx}
                placeholder="Maximum value per transaction, wei"
                onChange={(event) => setMaxTx(event.target.value.replace(/[^\d]/g, ""))}
                className="h-11 w-full rounded-sm border border-border bg-elevated px-3 text-sm outline-none"
              />
              <input
                inputMode="numeric"
                value={maxPeriod}
                placeholder="Maximum value per period, wei"
                onChange={(event) => setMaxPeriod(event.target.value.replace(/[^\d]/g, ""))}
                className="h-11 w-full rounded-sm border border-border bg-elevated px-3 text-sm outline-none"
              />
            </>
          ) : null}
          <label className="block">
            <span className="text-sm text-muted">Period duration, seconds</span>
            <input
              inputMode="numeric"
              value={period}
              onChange={(event) => setPeriod(event.target.value.replace(/[^\d]/g, ""))}
              className="mt-2 h-11 w-full rounded-sm border border-border bg-elevated px-3 text-sm outline-none"
            />
          </label>
        </div>
      ) : null}
      {step === 3 ? (
        <div className="mt-6">
          <p className="text-sm text-muted">This firewall will be created with:</p>
          <dl className="mt-4 border-t border-border">
            <Fact label="Executor">{executor}</Fact>
            <Fact label="Targets">None yet. Added after this transaction.</Fact>
            <Fact label="Functions">None yet. Added after this transaction.</Fact>
            <Fact label="Value">{allowValue ? `Up to ${txLimit} wei per transaction` : "Value transfer disabled"}</Fact>
            <Fact label="Period">{allowValue ? `${periodLimit} wei per ${period} seconds` : `${period} seconds`}</Fact>
            <Fact label="Network">Monad testnet</Fact>
          </dl>
          <p className="mt-4 max-w-md text-sm text-muted">Creating the firewall does not allow any contract. The contract is the authority for every later action.</p>
        </div>
      ) : null}
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        {step > 0 ? (
          <Button type="button" variant="secondary" onClick={() => setStep((value) => value - 1)}>
            {step === 3 ? "Cancel" : "Back"}
          </Button>
        ) : null}
        {step < 3 ? (
          <Button type="button" onClick={advance}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={() => void create()}>
            Create firewall
          </Button>
        )}
      </div>
    </div>
  );
}
