import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getChainStatus, listConfigurableAgents, refreshFirewallIntent, submitFirewall } from "@/lib/agents/functions";
import type { FirewallIntentStatus } from "@/lib/agents/types";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Button, ErrorNote, SkeletonLines, StatusText, TextInput } from "@/components/ui";
import { CopyButton } from "@/components/values";
import { formatAgentId, shortHash, txUrl } from "@/lib/format";

export const Route = createFileRoute("/firewalls/new")({ component: NewFirewallPage });

const STEPS = ["Select agent", "Executor", "Permissions", "Review"] as const;

type AgentChoice = { agentId: string; name: string; owner: string };

type RecordState = {
  id: string;
  status: FirewallIntentStatus;
  txHash: string | null;
  chainFirewallId: string | null;
  detail: string | null;
};

function NewFirewallPage() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) {
    return (
      <Shell>
        <SkeletonLines />
      </Shell>
    );
  }
  if (!user) return <RedirectToSignIn />;
  return (
    <Shell>
      <CreateFlow />
    </Shell>
  );
}

function CreateFlow() {
  const [agents, setAgents] = useState<AgentChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [agentId, setAgentId] = useState("");
  const [executor, setExecutor] = useState("");
  const [allowValue, setAllowValue] = useState(false);
  const [maxTx, setMaxTx] = useState("0");
  const [maxPeriod, setMaxPeriod] = useState("0");
  const [period, setPeriod] = useState("86400");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [record, setRecord] = useState<RecordState | null>(null);

  useEffect(() => {
    let cancelled = false;
    listConfigurableAgents()
      .then((result) => {
        if (!cancelled) setAgents(result.agents);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Could not load your agents.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!record || record.status !== "pending" || !record.id) return;
    let stop = false;
    const timer = window.setInterval(() => {
      void refreshFirewallIntent({ data: record.id })
        .then((result) => {
          if (stop) return;
          setRecord({
            id: result.intent.id,
            status: result.intent.status,
            txHash: result.intent.txHash,
            chainFirewallId: result.intent.chainFirewallId,
            detail: result.intent.error,
          });
        })
        .catch((err: unknown) => {
          if (!stop) setError(err instanceof Error ? err.message : "Could not refresh the transaction.");
        });
    }, 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [record?.id, record?.status]);

  function next() {
    setError(null);
    if (step === 0 && !agentId) {
      setError("Select an agent.");
      return;
    }
    if (step === 1 && !/^0x[a-fA-F0-9]{40}$/.test(executor.trim())) {
      setError("Executor must be an address.");
      return;
    }
    if (step === 1 && /^0x0{40}$/i.test(executor.trim())) {
      setError("Executor cannot be the zero address.");
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
    setRecord(null);
    const draft = {
      agentId,
      executor: executor.trim(),
      allowValueTransfer: allowValue,
      maxValuePerTransaction: allowValue ? maxTx.trim() : "0",
      maxValuePerPeriod: allowValue ? maxPeriod.trim() : "0",
      periodDuration: period.trim(),
    };
    try {
      const chain = await getChainStatus();
      if (!chain.firewall) {
        setRecord({
          id: "",
          status: "failed",
          txHash: null,
          chainFirewallId: null,
          detail: "Agent Firewall is not deployed. No transaction was sent and no firewall id was assigned.",
        });
        return;
      }
      setBusy("Waiting for wallet…");
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
      setBusy("Creating firewall...");
      const result = await submitFirewall({ data: { ...draft, txHash: hash } });
      setRecord({
        id: result.intent.id,
        status: result.intent.status,
        txHash: result.intent.txHash,
        chainFirewallId: result.intent.chainFirewallId,
        detail: result.intent.error,
      });
    } catch (err) {
      setRecord({
        id: "",
        status: "failed",
        txHash: null,
        chainFirewallId: null,
        detail: err instanceof Error ? err.message : "Firewall creation failed.",
      });
    } finally {
      setBusy(null);
    }
  }

  if (agents === null && !loadError) return <SkeletonLines />;
  if (loadError) return <ErrorNote>{loadError}</ErrorNote>;
  if (agents && agents.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Create a firewall</h1>
        <p className="mt-3 max-w-md text-sm text-muted">
          No active agents are indexed for this account. A firewall can only be created for an agent you already
          own.
        </p>
        <Link to="/agents/new" className="mt-6 inline-flex h-11 items-center text-sm text-fg underline-offset-4 hover:underline">
          Create an agent
        </Link>
      </div>
    );
  }

  if (record?.status === "active" && record.chainFirewallId) {
    const href = txUrl(record.txHash);
    return (
      <div>
        <p className="text-sm text-muted">Firewall created</p>
        <h1 className="mt-2 text-3xl font-medium tracking-tight">Firewall {formatAgentId(record.chainFirewallId)}</h1>
        <p className="mt-2 font-mono text-xs text-faint">firewallId: {record.chainFirewallId}</p>
        <p className="mt-8 text-sm text-muted">Transaction</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {href ? (
            <a href={href} className="inline-flex h-11 items-center text-sm text-fg underline-offset-4 hover:underline" rel="noreferrer">
              View on Monad Explorer
            </a>
          ) : (
            <p className="text-sm text-muted">Explorer link unavailable.</p>
          )}
          {record.txHash ? <CopyButton value={record.txHash} label="transaction" /> : null}
        </div>
        {record.txHash ? <p className="mt-2 font-mono text-xs text-faint">{shortHash(record.txHash)}</p> : null}
        <div className="mt-8">
          <Link
            to="/agents/$agentId/firewall"
            params={{ agentId }}
            className="inline-flex h-11 items-center justify-center rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg"
          >
            Open firewall
          </Link>
        </div>
      </div>
    );
  }

  if (record?.status === "pending") {
    return (
      <div>
        <StatusText tone="pending">Pending</StatusText>
        <h1 className="mt-3 text-3xl font-medium tracking-tight">Creating firewall...</h1>
        <p className="mt-3 max-w-md text-sm text-muted">
          The transaction is on Monad. This page stays here until FirewallCreated is indexed. No firewall id is
          shown before that.
        </p>
        {record.txHash ? <p className="mt-6 font-mono text-xs text-faint">{shortHash(record.txHash)}</p> : null}
      </div>
    );
  }

  if (record?.status === "failed") {
    return (
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Firewall creation failed</h1>
        <p className="mt-3 max-w-md text-sm text-muted">{record.detail ?? "The firewall was not created."}</p>
        <div className="mt-8">
          <Button
            type="button"
            onClick={() => {
              setRecord(null);
              setError(null);
              setStep(3);
            }}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const selected = agents?.find((agent) => agent.agentId === agentId);

  return (
    <div>
      <p className="text-sm text-muted">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="mt-2 text-3xl font-medium tracking-tight">{STEPS[step]}</h1>
      {error ? (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {step === 0 ? (
        <div className="mt-8 flex flex-col gap-2">
          {agents?.map((agent) => {
            const on = agent.agentId === agentId;
            return (
              <button
                key={agent.agentId}
                type="button"
                aria-pressed={on}
                onClick={() => setAgentId(agent.agentId)}
                className={`flex h-11 items-center justify-between rounded-sm border px-3 text-left text-sm ${on ? "border-border-strong bg-subtle text-fg" : "border-border text-muted"}`}
              >
                <span>{agent.name}</span>
                <span className="font-mono text-xs">Agent {formatAgentId(agent.agentId)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {step === 1 ? (
        <div className="mt-8">
          <TextInput
            value={executor}
            autoFocus
            spellCheck={false}
            placeholder="0x…"
            onChange={(event) => setExecutor(event.target.value.trim())}
          />
          <p className="mt-3 text-sm text-muted">The executor can submit actions. It cannot change this firewall.</p>
        </div>
      ) : null}
      {step === 2 ? (
        <div className="mt-8 space-y-6">
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
          <p className="text-sm text-muted">
            Left off, this firewall cannot move value. No contracts or functions are allowed until you add them
            after the firewall exists.
          </p>
          {allowValue ? (
            <div className="space-y-4">
              <TextInput
                inputMode="numeric"
                value={maxTx}
                placeholder="Max wei per transaction"
                onChange={(event) => setMaxTx(event.target.value.replace(/[^\d]/g, ""))}
              />
              <TextInput
                inputMode="numeric"
                value={maxPeriod}
                placeholder="Max wei per period"
                onChange={(event) => setMaxPeriod(event.target.value.replace(/[^\d]/g, ""))}
              />
            </div>
          ) : null}
          <TextInput
            inputMode="numeric"
            value={period}
            placeholder="Period length in seconds"
            onChange={(event) => setPeriod(event.target.value.replace(/[^\d]/g, ""))}
          />
        </div>
      ) : null}
      {step === 3 ? (
        <dl className="mt-8">
          <Review label="Agent" value={selected ? `${selected.name} · Agent ${formatAgentId(selected.agentId)}` : agentId} />
          <Review label="Executor" value={executor} />
          <Review label="Value transfer" value={allowValue ? "Enabled" : "Disabled"} />
          <Review label="Per transaction" value={allowValue ? `${maxTx} wei` : "0 wei"} />
          <Review label="Per period" value={allowValue ? `${maxPeriod} wei` : "0 wei"} />
          <Review label="Period" value={`${period} seconds`} />
        </dl>
      ) : null}
      <div className="mt-10 flex gap-3">
        {step > 0 ? (
          <Button type="button" variant="ghost" onClick={() => setStep((value) => value - 1)} disabled={Boolean(busy)}>
            Back
          </Button>
        ) : null}
        {step < 3 ? (
          <Button type="button" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={() => void create()} disabled={Boolean(busy)}>
            {busy ?? "Create firewall"}
          </Button>
        )}
      </div>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-3">
      <dt className="text-xs tracking-widest text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-all">{value}</dd>
    </div>
  );
}
