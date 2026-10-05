import { useEffect, useRef, useState } from "react";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { createFileRoute, Link } from "@tanstack/react-router";
import { TxStatus } from "@/components/tx-status";
import { CAPABILITIES, type Capability, type IntentStatus } from "@/lib/agents/types";
import { parseCreateInput } from "@/lib/agents/validate";
import { getChainStatus, refreshIntent, submitRegistration } from "@/lib/agents/functions";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Button, ConfirmDialog, ErrorNote, Field, SkeletonLines, TextArea, TextInput, buttonClass } from "@/components/ui";
import { formatAgentLabel } from "@/lib/format";
import { refreshOrResubmit } from "@/lib/agents/resilient";

export const Route = createFileRoute("/agents/new")({ component: NewAgentPage });

const STEPS = ["Identity", "Review"] as const;

type RecordState = {
  id: string;
  status: IntentStatus;
  txHash: string | null;
  chainAgentId: string | null;
  detail: string | null;
};

type Phase = "awaiting_signature" | "submitting" | null;

function NewAgentPage() {
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
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const [record, setRecord] = useState<RecordState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const lastSubmit = useRef<Parameters<typeof submitRegistration>[0] | null>(null);

  useEffect(() => {
    if (!record || record.status !== "pending" || !record.id) return;
    let stop = false;
    const timer = window.setInterval(() => {
      const resubmit = lastSubmit.current;
      void refreshOrResubmit(
        () => refreshIntent({ data: record.id }),
        resubmit ? () => submitRegistration(resubmit) : null,
      )
        .then((result) => {
          if (stop) return;
          setRecord({
            id: result.intent.id,
            status: result.intent.status,
            txHash: result.intent.txHash,
            chainAgentId: result.intent.chainAgentId,
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

  function toggle(capability: Capability) {
    setCapabilities((current) =>
      current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability],
    );
  }

  function next() {
    setError(null);
    const parsed = parseCreateInput({ name, description, capabilities, metadataURI });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setStep(1);
  }

  async function create() {
    const parsed = parseCreateInput({ name, description, capabilities, metadataURI });
    if (!parsed.ok) {
      setError(parsed.error);
      setStep(0);
      return;
    }
    setError(null);
    setRecord(null);
    setPhase("awaiting_signature");
    try {
      const chain = await getChainStatus();
      if (!chain.registry) {
        setPhase(null);
        setRecord({
          id: "",
          status: "failed",
          txHash: null,
          chainAgentId: null,
          detail: "Agent Registry is not deployed. No transaction was sent and no agent id was assigned.",
        });
        return;
      }
      const { sendRegisterTransaction } = await import("@/lib/chain/wallet");
      const hash = await sendRegisterTransaction({
        registry: chain.registry as `0x${string}`,
        name: parsed.value.name,
        description: parsed.value.description,
        metadataURI: parsed.value.metadataURI,
        capabilities: parsed.value.capabilities,
      });
      setPhase("submitting");
      lastSubmit.current = { data: { ...parsed.value, txHash: hash } };
      const result = await submitRegistration(lastSubmit.current);
      setRecord({
        id: result.intent.id,
        status: result.intent.status,
        txHash: result.intent.txHash,
        chainAgentId: result.intent.chainAgentId,
        detail: result.intent.error,
      });
    } catch (err) {
      setRecord({
        id: "",
        status: "failed",
        txHash: null,
        chainAgentId: null,
        detail: err instanceof Error ? err.message : "Agent creation failed.",
      });
    } finally {
      setPhase(null);
    }
  }

  if (phase) {
    return <TxStatus title="Creating Agent ID" phase={phase} />;
  }

  if (record?.status === "active" && record.chainAgentId) {
    return (
      <div>
        <TxStatus title={`${formatAgentLabel(record.chainAgentId)} created`} phase="confirmed" hash={record.txHash} />
        <div className="mt-8">
          <Link to="/agents/$agentId" params={{ agentId: record.chainAgentId }} className={buttonClass("primary")}>
            Continue
          </Link>
        </div>
      </div>
    );
  }

  if (record?.status === "pending") {
    return <TxStatus title="Creating Agent ID" phase="pending" hash={record.txHash} />;
  }

  if (record?.status === "failed") {
    return (
      <div>
        <TxStatus title="Agent creation failed" phase="failed" hash={record.txHash} detail={record.detail} />
        <Button
          type="button"
          className="mt-8"
          onClick={() => {
            setRecord(null);
            setError(null);
            setStep(1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-muted">
        Step {step + 1} of {STEPS.length}
      </p>
      <h1 className="type-heading mt-2">{step === 0 ? "Agent identity" : "Review"}</h1>
      {step === 0 ? (
        <p className="mt-3 max-w-md text-sm text-muted">
          Capabilities describe what this agent is designed to do. They do not grant execution permission.
        </p>
      ) : (
        <p className="mt-3 max-w-md text-sm text-muted">This will create a persistent Agent ID on Monad.</p>
      )}
      {error ? (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {step === 0 ? (
        <div className="mt-8 space-y-6">
          <Field label="Name" hint="Shown on the Agent Passport." required>
            <TextInput value={name} maxLength={64} autoFocus placeholder="Research Agent" onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Description" hint="What this agent is for. This does not grant permission to execute." required>
            <TextArea value={description} maxLength={280} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Metadata URI" hint="Optional. Use https or ipfs. Leave empty if you do not have one.">
            <TextInput value={metadataURI} spellCheck={false} placeholder="https://" onChange={(event) => setMetadataURI(event.target.value)} />
          </Field>
          <div>
            <p className="text-sm">Capabilities</p>
            <p className="mt-1 text-sm text-muted">Capability is not permission. A firewall decides what can execute.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {CAPABILITIES.map((capability) => {
                const selected = capabilities.includes(capability);
                return (
                  <button
                    key={capability}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggle(capability)}
                    className={`h-11 rounded-sm border px-3 text-sm ${selected ? "border-border-strong bg-subtle text-fg" : "border-border text-muted hover:text-fg"}`}
                  >
                    {capability}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <dl>
            <Review label="Agent" value={name.trim()} />
            <Review label="Description" value={description.trim()} />
            <Review label="Capabilities" value={capabilities.join(" · ")} />
            <Review label="Metadata" value={metadataURI.trim() || "None"} />
            <Review label="Network" value={MONAD_TESTNET.label} />
            <Review label="Owner" value="The wallet that signs this transaction. Not your Google account." />
          </dl>
          <p className="mt-6 max-w-md text-sm text-muted">This action will create a persistent Agent ID. It cannot be reused if the agent is later deactivated.</p>
        </div>
      )}
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        {step > 0 ? (
          <Button type="button" variant="secondary" onClick={() => setStep(0)}>
            Cancel
          </Button>
        ) : null}
        {step === 0 ? (
          <Button type="button" onClick={next}>
            Continue
          </Button>
        ) : (
          <Button type="button" onClick={() => setConfirmOpen(true)}>
            Create agent
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmOpen}
        title="Create agent"
        description="This creates a persistent Agent ID on Monad. The wallet that signs becomes the owner. The id is not reused if the agent is later deactivated."
        confirmLabel="Create agent"
        pending={Boolean(phase)}
        onOpenChange={setConfirmOpen}
        onConfirm={() => {
          setConfirmOpen(false);
          void create();
        }}
      >
        <p>Network: {MONAD_TESTNET.label}</p>
        <p className="mt-2">Agent: {name.trim() || "Unnamed"}</p>
      </ConfirmDialog>
    </div>
  );
}

function Review({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border py-3">
      <dt className="text-xs tracking-widest text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm text-pretty">{value}</dd>
    </div>
  );
}
