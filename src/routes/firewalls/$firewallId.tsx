import { useEffect, useState } from "react";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { createFileRoute, Link } from "@tanstack/react-router";
import { confirmFirewallTx, getChainStatus, getFirewall, verifyProof } from "@/lib/agents/functions";
import type { FirewallAction, FirewallRecord } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { AddressInput, AmountInput, Button, ChainError, Checkbox, CodeInput, ConfirmDialog, ErrorNote, Fact, Field, Mono, SkeletonLines, StatusText, TextInput } from "@/components/ui";
import { AddressValue, CopyButton, TxValue } from "@/components/values";
import { addressUrl, formatAgentId, formatDuration, formatWei, functionName, proofStatusLabel, shortHash, statusTone } from "@/lib/format";
import { toFunctionSelector } from "viem";
import { toast } from "sonner";
import { useWalletAccount } from "@/lib/chain/wallet-account";

export const Route = createFileRoute("/firewalls/$firewallId")({ component: FirewallPage });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

function FirewallPage() {
  const { firewallId } = Route.useParams();
  const [firewall, setFirewall] = useState<FirewallRecord | null | undefined>(undefined);
  const [actions, setActions] = useState<FirewallAction[]>([]);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load(id: string) {
    return getFirewall({ data: id }).then((result) => {
      setFirewall(result.firewall);
      setActions(result.actions);
      setDetail(result.detail);
    });
  }

  useEffect(() => {
    let cancelled = false;
    load(firewallId).catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this firewall.");
    });
    return () => {
      cancelled = true;
    };
  }, [firewallId]);

  return (
    <Shell>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      {!error && firewall === undefined ? <SkeletonLines /> : null}
      {!error && firewall === null ? <Missing detail={detail} /> : null}
      {firewall ? (
        <Record
          firewall={firewall}
          actions={actions}
          onReload={() => load(firewall.id)}
        />
      ) : null}
    </Shell>
  );
}

function policyHint(firewall: FirewallRecord, target: string, data: string): string {
  const normalized = target.trim().toLowerCase();
  const selector = data.trim().toLowerCase().slice(0, 10);
  if (!/^0x[a-f0-9]{40}$/.test(normalized)) return "Enter a target address.";
  if (!/^0x[a-f0-9]{8}$/.test(selector)) return "Calldata needs a 4-byte function selector.";
  const targetAllowed = firewall.allowedTargets.some((item) => item.active && item.target.toLowerCase() === normalized);
  const functionAllowed = firewall.allowedFunctions.some(
    (item) => item.active && item.target.toLowerCase() === normalized && item.selector.toLowerCase() === selector,
  );
  if (!targetAllowed) return "Indexed policy: this target is not allowed.";
  if (!functionAllowed) return "Indexed policy: this function is not allowed.";
  if (firewall.status === "paused") return "Indexed policy: this firewall is paused.";
  if (firewall.status !== "active") return "Indexed policy: this firewall is not active.";
  return "Indexed policy: this target and function are allowed.";
}

function Missing({ detail }: { detail: string }) {
  return (
    <div>
      <h1 className="text-2xl font-medium tracking-tight">Firewall not found</h1>
      <p className="mt-3 text-sm text-muted">{detail || "This firewall is not indexed."}</p>
      <Link to="/firewalls" className="mt-6 inline-flex h-11 items-center text-sm text-muted hover:text-fg">
        All firewalls
      </Link>
    </div>
  );
}

function Record({
  firewall,
  actions,
  onReload,
}: {
  firewall: FirewallRecord;
  actions: FirewallAction[];
  onReload: () => Promise<unknown>;
}) {
  const targets = firewall.allowedTargets.filter((target) => target.active);
  const functions = firewall.allowedFunctions.filter((rule) => rule.active);
  const status =
    firewall.status === "active" ? "Active" : firewall.status === "paused" ? "Paused" : "Inactive";
  return (
    <article>
      <header>
        <p className="font-mono text-xs tracking-widest text-faint">FIREWALL</p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">Firewall {formatAgentId(firewall.id)}</h1>
        <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <StatusText tone={statusTone(firewall.status)}>{status}</StatusText>
          <span aria-hidden>·</span>
          <span>
            {targets.length} {targets.length === 1 ? "target" : "targets"} · {functions.length}{" "}
            {functions.length === 1 ? "function" : "functions"} · value transfers {firewall.allowValueTransfer ? "on" : "off"}
          </span>
        </p>
        <p className="mt-3 max-w-xl text-sm text-pretty text-muted">
          The onchain rules for this agent. AgentFirewall rejects any call outside them before it reaches the target.
        </p>
      </header>

      <dl className="mt-8 border-t border-border">
        <Fact label="Agent">
          <Link to="/agents/$agentId" params={{ agentId: firewall.agentId }} className="hover:underline">
            {firewall.agentName || "Agent"} <Mono>{formatAgentId(firewall.agentId)}</Mono>
          </Link>
        </Fact>
        <Fact label="Executor">
          <AddressValue value={firewall.executor} copy explorer />
        </Fact>
        {firewall.creationTxHash ? (
          <Fact label="Created in">
            <TxValue hash={firewall.creationTxHash} copy />
          </Fact>
        ) : null}
      </dl>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Policy</h2>
        <dl className="mt-3 border-t border-border">
          <Fact label="Value transfers">{firewall.allowValueTransfer ? "Allowed" : "Disabled. Calls cannot send MON."}</Fact>
          {firewall.allowValueTransfer ? (
            <>
              <Fact label="Per transaction">{formatWei(firewall.maxValuePerTransaction)}</Fact>
              <Fact label="Per period">{`${formatWei(firewall.maxValuePerPeriod)} / ${formatDuration(firewall.periodDuration)}`}</Fact>
              <Fact label="Spent this period">{formatWei(firewall.spentInPeriod)}</Fact>
            </>
          ) : null}
        </dl>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Allowed targets</h2>
        {targets.length ? (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {targets.map((target) => (
              <li key={target.target} className="py-3 text-sm">
                <span className="flex flex-wrap items-center gap-x-3">
                  <Mono>{target.target}</Mono>
                  {addressUrl(target.target) ? (
                    <a href={addressUrl(target.target) ?? undefined} className="text-xs text-muted hover:text-fg" rel="noreferrer">
                      Explorer
                    </a>
                  ) : null}
                </span>
                {target.name ? <span className="mt-1 block text-muted">{target.name}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">None</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Allowed functions</h2>
        {functions.length ? (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {functions.map((rule) => (
              <li key={`${rule.target}-${rule.selector}`} className="py-3 text-sm">
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <Mono>{functionName(rule.selector) ?? rule.selector}</Mono>
                  {functionName(rule.selector) ? <span className="type-technical text-xs text-faint">{rule.selector}</span> : null}
                </span>
                <span className="mt-1 block break-all text-muted">
                  {targets.find((t) => t.target.toLowerCase() === rule.target.toLowerCase())?.name || rule.target}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted">None</p>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-medium">Execution history</h2>
        {actions.length === 0 ? (
          <p className="mt-3 text-sm text-muted">Executions will appear when your agent performs an authorized action.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border border-y border-border">
            {actions.map((action) => (
              <li key={action.executionId} className="grid gap-1 py-3 text-sm sm:grid-cols-[1fr_auto] sm:items-baseline sm:gap-x-6">
                <Link to="/proofs/$proofId" params={{ proofId: action.executionId }} className="min-w-0 hover:underline">
                  <Mono>{functionName(action.selector)?.split("(")[0] ?? action.selector}</Mono>
                  <span className="ml-3 text-muted">{shortHash(action.executionId)}</span>
                </Link>
                <StatusText tone={action.proofStatus === "receipt_verified" ? "ok" : action.proofStatus === "unverifiable" ? "danger" : "muted"}>
                  {action.proofStatus ? proofStatusLabel(action.proofStatus, action.anchored) : "No proof"}
                </StatusText>
                <span className="text-xs text-muted sm:col-span-2">
                  {formatWei(action.value)} · <TxValue hash={action.txHash} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FirewallControls firewall={firewall} onReload={onReload} />
    </article>
  );
}

export function FirewallControls({ firewall, onReload }: { firewall: FirewallRecord; onReload: () => Promise<unknown> }) {
  const { user, isPending } = useCurrentUserState();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [executor, setExecutor] = useState("");
  const [allowValue, setAllowValue] = useState(firewall.allowValueTransfer);
  const [maxTx, setMaxTx] = useState(firewall.maxValuePerTransaction);
  const [maxPeriod, setMaxPeriod] = useState(firewall.maxValuePerPeriod);
  const [period, setPeriod] = useState(firewall.periodDuration);
  const [target, setTarget] = useState("");
  const [targetName, setTargetName] = useState("");
  const [fnTarget, setFnTarget] = useState("");
  const [selector, setSelector] = useState("");
  const [execTarget, setExecTarget] = useState("");
  const [execValue, setExecValue] = useState("0");
  const [execData, setExecData] = useState("");
  const [phase, setPhase] = useState<string | null>(null);
  const [txPhase, setTxPhase] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "pause" | "deactivate" | "execute">(null);
  const [executionId, setExecutionId] = useState<string | null>(null);
  const wallet = useWalletAccount();

  async function run(
    label: string,
    call: {
      functionName:
        | "setExecutor"
        | "updatePolicy"
        | "allowTarget"
        | "disableTarget"
        | "allowFunction"
        | "disableFunction"
        | "pauseFirewall"
        | "unpauseFirewall"
        | "deactivateFirewall";
      args: readonly unknown[];
    },
  ) {
    if (!user) {
      if (authEnabled && google && !isPending) {
        void signIn(google.providerId, { callbackURL: `/firewalls/${firewall.id}` });
      }
      return;
    }
    setBusy(label);
    setError(null);
    setNote(null);
    setTxHash(null);
    setTxPhase(null);
    try {
      const chain = await getChainStatus();
      if (!chain.firewall) {
        setTxPhase("Failed");
        setError("Agent Firewall is not deployed. No transaction was sent.");
        return;
      }
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const hash = await sendFirewallTransaction({
        to: chain.firewall as `0x${string}`,
        functionName: call.functionName,
        args: call.args,
      });
      setTxHash(hash);
      setTxPhase("Submitted");
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
      setTxPhase("Waiting for confirmation");
      const result = await confirmFirewallTx({ data: { txHash: hash, firewallId: firewall.id } });
      if (result.state === "indexed") {
        await onReload();
        setTxPhase("Confirmed");
        toast.success("Firewall updated");
        return;
      }
      setTxPhase("Failed");
      if (result.state === "pending") {
        setError("The transaction is not confirmed yet. The firewall was not updated here.");
        return;
      }
      setError(result.error);
    } catch (err) {
      setTxPhase("Failed");
      setError(err instanceof Error ? err.message : "The action was rejected.");
    } finally {
      setBusy(null);
    }
  }

  function selectorBytes(value: string): `0x${string}` | null {
    const trimmed = value.trim();
    if (/^0x[a-fA-F0-9]{8}$/.test(trimmed)) return trimmed.toLowerCase() as `0x${string}`;
    if (/^[A-Za-z_][A-Za-z0-9_]*\(.*\)$/.test(trimmed)) {
      try {
        return toFunctionSelector(trimmed).toLowerCase() as `0x${string}`;
      } catch {
        return null;
      }
    }
    return null;
  }

  const id = BigInt(firewall.id);

  async function executeAction() {
    if (!user) {
      if (authEnabled && google && !isPending) {
        void signIn(google.providerId, { callbackURL: `/firewalls/${firewall.id}` });
      }
      return;
    }
    const target = execTarget.trim();
    const data = execData.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
      setError("Enter a valid EVM address.");
      return;
    }
    if (!/^\d+$/.test(execValue)) {
      setError("Enter an amount greater than or equal to 0.");
      return;
    }
    if (!/^0x[a-fA-F0-9]*$/.test(data) || data.length < 10 || (data.length - 2) % 2 !== 0) {
      setError("Calldata must be hex and include a 4-byte selector.");
      return;
    }
    setBusy("Execute");
    setError(null);
    setNote(null);
    setPhase(null);
    setTxPhase(null);
    setTxHash(null);
    setExecutionId(null);
    try {
      const chain = await getChainStatus();
      if (!chain.firewall) {
        setTxPhase("Failed");
        setError("Agent Firewall is not deployed. No transaction was sent.");
        return;
      }
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const value = BigInt(execValue);
      const hash = await sendFirewallTransaction({
        to: chain.firewall as `0x${string}`,
        functionName: "execute",
        args: [id, target as `0x${string}`, value, data as `0x${string}`],
        value,
      });
      setTxHash(hash);
      setTxPhase("Submitted");
      await new Promise((resolve) => {
        window.setTimeout(resolve, 0);
      });
      setTxPhase("Waiting for confirmation");
      const result = await confirmFirewallTx({ data: { txHash: hash, firewallId: firewall.id } });
      if (result.state === "pending") {
        setTxPhase("Failed");
        setError("The transaction is not confirmed yet. The execution was not indexed.");
        return;
      }
      if (result.state !== "indexed") {
        setTxPhase("Failed");
        setPhase(null);
        setError(result.error);
        return;
      }
      setTxPhase("Confirmed");
      toast.success("Transaction confirmed");
      // The confirming request already decoded the AgentAction; another server instance may
      // not have indexed it yet, so do not depend on a second lookup.
      const executionId = result.executionIds[0];
      const action = executionId ? { executionId, txHash: hash } : null;
      await onReload();
      if (!action) {
        setPhase(null);
        setError("The transaction confirmed, but no AgentAction was indexed. A failed execution is not a proof.");
        return;
      }
      setExecutionId(action.executionId);
      setPhase("Execution detected");
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve(undefined));
      });
      setPhase("Verifying execution");
      const verified = await verifyProof({ data: action });
      await onReload();
      if (verified.proof.anchored) setPhase("Proof anchored");
      else if (verified.proof.verificationStatus === "receipt_verified") setPhase("Execution verified");
      else if (verified.proof.verificationStatus === "temporary_error") setPhase("Verification delayed");
      else if (verified.proof.verificationStatus === "unverifiable") setPhase("Unverifiable");
      else setPhase("Execution detected");
    } catch (err) {
      setTxPhase((current) => (current === "Confirmed" ? current : "Failed"));
      setPhase(null);
      setError(err instanceof Error ? err.message : "The execution was rejected.");
    } finally {
      setBusy(null);
    }
  }

  const disabled = isPending || Boolean(busy);
  const connected = wallet.address?.toLowerCase() ?? null;
  // Controls are for the owner (configuration) and the executor (execute). The contract enforces
  // this anyway; everyone else sees who manages the firewall instead of forms they cannot use.
  const canManage =
    Boolean(connected) &&
    (connected === firewall.owner.toLowerCase() || connected === firewall.executor.toLowerCase());
  if (!canManage) {
    return (
      <section id="edit-permissions" className="mt-10 border-t border-border pt-6">
        <h2 className="text-sm font-medium">Management</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Only the owner can change this firewall, and only the executor can run actions through it. Monad enforces both.
        </p>
        <dl className="mt-4 max-w-xl text-sm">
          <Fact label="Owner">
            <AddressValue value={firewall.owner} copy explorer />
          </Fact>
        </dl>
        {wallet.ready && wallet.available && !connected ? (
          <Button type="button" variant="secondary" className="mt-4" onClick={() => void wallet.connect()}>
            Connect owner wallet
          </Button>
        ) : null}
        {wallet.error ? <p className="mt-2 text-sm text-muted">{wallet.error}</p> : null}
      </section>
    );
  }

  return (
    <section id="edit-permissions" className="mt-10 border-t border-border pt-6">
      <h2 className="text-sm font-medium">Permissions</h2>
      <p className="mt-2 max-w-xl text-sm text-muted">
        Submitted onchain. Nothing here changes until the transaction confirms and the event is indexed.
      </p>
      <div className="mt-8 max-w-xl space-y-4">
        <Field label="Executor" hint="Address allowed to submit executions through this firewall.">
          <AddressInput value={executor} onChange={(event) => setExecutor(event.target.value.trim())} />
        </Field>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          loading={busy === "Executor"}
          onClick={() => {
            if (!/^0x[a-fA-F0-9]{40}$/.test(executor) || /^0x0{40}$/i.test(executor)) {
              setError("Enter a valid EVM address.");
              return;
            }
            void run("Executor", { functionName: "setExecutor", args: [id, executor as `0x${string}`] });
          }}
        >
          {busy === "Executor" ? "Updating…" : "Set executor"}
        </Button>
      </div>

      <div className="mt-8 max-w-xl space-y-4">
        <h3 className="text-sm font-medium">Value limits</h3>
        <Checkbox label="Allow value transfer" checked={allowValue} onChange={(event) => setAllowValue(event.target.checked)} />
        <Field label="Maximum value per transaction" hint="Maximum amount of wei this firewall allows in one execution.">
          <AmountInput value={maxTx} onChange={(event) => setMaxTx(event.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="Maximum value per period" hint="Maximum amount of wei this firewall allows across one period.">
          <AmountInput value={maxPeriod} onChange={(event) => setMaxPeriod(event.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="Period duration" hint="Period length in seconds. Must be greater than 0.">
          <AmountInput value={period} onChange={(event) => setPeriod(event.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          loading={busy === "Policy"}
          onClick={() => {
            const tx = allowValue ? maxTx : "0";
            const cap = allowValue ? maxPeriod : "0";
            if (!/^[1-9]\d*$/.test(period)) {
              setError("Period duration must be greater than 0.");
              return;
            }
            if (allowValue && (!/^[1-9]\d*$/.test(tx) || !/^\d+$/.test(cap) || BigInt(cap) < BigInt(tx))) {
              setError("Enter an amount greater than or equal to 0.");
              return;
            }
            void run("Policy", {
              functionName: "updatePolicy",
              args: [id, allowValue, BigInt(tx || "0"), BigInt(cap || "0"), BigInt(period)],
            });
          }}
        >
          {busy === "Policy" ? "Updating…" : "Update policy"}
        </Button>
      </div>

      <div id="add-target" className="mt-8 max-w-xl space-y-4">
        <Field label="Target" hint="Contract address this agent is allowed to call.">
          <AddressInput value={target} onChange={(event) => setTarget(event.target.value.trim())} />
        </Field>
        <Field label="Target name" hint="A label for this target. The contract checks the address, not the name.">
          <TextInput value={targetName} maxLength={64} onChange={(event) => setTargetName(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
                setError("Enter a valid EVM address.");
                return;
              }
              void run("Allow target", { functionName: "allowTarget", args: [id, target as `0x${string}`, targetName.slice(0, 64)] });
            }}
          >
            {busy === "Allow target" ? "Waiting…" : "Allow target"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
                setError("Enter a valid EVM address.");
                return;
              }
              void run("Disable target", { functionName: "disableTarget", args: [id, target as `0x${string}`] });
            }}
          >
            {busy === "Disable target" ? "Waiting…" : "Disable target"}
          </Button>
        </div>
      </div>

      <div id="add-function" className="mt-8 max-w-xl space-y-4">
        <Field label="Target" hint="Address the function rule applies to.">
          <AddressInput value={fnTarget} onChange={(event) => setFnTarget(event.target.value.trim())} />
        </Field>
        <Field label="Function" hint="4-byte selector, or a signature such as transfer(address,uint256).">
          <CodeInput value={selector} placeholder="0xa9059cbb" onChange={(event) => setSelector(event.target.value)} />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            disabled={disabled}
            onClick={() => {
              const parsed = selectorBytes(selector);
              if (!/^0x[a-fA-F0-9]{40}$/.test(fnTarget) || !parsed) {
                setError("Enter a valid target address and function selector.");
                return;
              }
              void run("Allow function", { functionName: "allowFunction", args: [id, fnTarget as `0x${string}`, parsed] });
            }}
          >
            {busy === "Allow function" ? "Waiting…" : "Allow function"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              const parsed = selectorBytes(selector);
              if (!/^0x[a-fA-F0-9]{40}$/.test(fnTarget) || !parsed) {
                setError("Enter a valid target address and function selector.");
                return;
              }
              void run("Disable function", { functionName: "disableFunction", args: [id, fnTarget as `0x${string}`, parsed] });
            }}
          >
            {busy === "Disable function" ? "Waiting…" : "Disable function"}
          </Button>
        </div>
      </div>

      <div id="execute-action" className="mt-8 max-w-xl space-y-4">
        <h3 className="text-sm font-medium">Execute</h3>
        <Field label="Target" hint="Must already be an allowed target.">
          <AddressInput value={execTarget} onChange={(event) => setExecTarget(event.target.value.trim())} />
        </Field>
        <Field label="Value" hint="Amount of wei sent with this execution.">
          <AmountInput value={execValue} onChange={(event) => setExecValue(event.target.value.replace(/[^\d]/g, ""))} />
        </Field>
        <Field label="Calldata" hint="Hex calldata, including the 4-byte function selector.">
          <CodeInput value={execData} onChange={(event) => setExecData(event.target.value.trim())} />
        </Field>
        <Button type="button" disabled={disabled} onClick={() => setConfirm("execute")}>
          Review action
        </Button>
        {txPhase ? <p className="text-sm text-muted">{txPhase}</p> : null}
        {txPhase === "Confirmed" && txHash ? (
          <p className="text-sm">
            <TxValue hash={txHash} copy />
          </p>
        ) : null}
        {phase ? <p className="text-sm text-muted">{phase}</p> : null}
        {executionId ? (
          <Link to="/proofs/$proofId" params={{ proofId: executionId }} className="inline-flex h-11 items-center text-sm text-muted hover:text-fg">
            View proof
          </Link>
        ) : null}
      </div>

      <div className="mt-12 border-t border-border pt-8">
        <h3 className="text-sm font-medium">Danger zone</h3>
        <p className="mt-2 max-w-xl text-sm text-muted">Pause stops new executions. Deactivate ends this firewall on Monad.</p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button type="button" variant="danger" disabled={disabled} onClick={() => setConfirm("pause")}>
            Pause firewall
          </Button>
          <Button type="button" variant="secondary" disabled={disabled} loading={busy === "Unpause"} onClick={() => void run("Unpause", { functionName: "unpauseFirewall", args: [id] })}>
            {busy === "Unpause" ? "Unpausing…" : "Unpause firewall"}
          </Button>
          <Button type="button" variant="danger" disabled={disabled} onClick={() => setConfirm("deactivate")}>
            Deactivate firewall
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirm === "pause"}
        title={`Pause Firewall ${formatAgentId(firewall.id)}`}
        description="The executor cannot run actions until this firewall is unpaused. Existing execution history stays available."
        confirmLabel="Pause firewall"
        destructive
        pending={Boolean(busy)}
        onOpenChange={(open) => setConfirm(open ? "pause" : null)}
        onConfirm={() => {
          setConfirm(null);
          void run("Pause", { functionName: "pauseFirewall", args: [id] });
        }}
      >
        <p>Network: {MONAD_TESTNET.label}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "deactivate"}
        title={`Deactivate Firewall ${formatAgentId(firewall.id)}`}
        description="This stops the firewall on Monad. Existing execution history remains available. New executions will not be allowed."
        confirmLabel="Deactivate firewall"
        destructive
        pending={Boolean(busy)}
        onOpenChange={(open) => setConfirm(open ? "deactivate" : null)}
        onConfirm={() => {
          setConfirm(null);
          void run("Deactivate", { functionName: "deactivateFirewall", args: [id] });
        }}
      >
        <p>Network: {MONAD_TESTNET.label}</p>
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm === "execute"}
        title="Execute action"
        description="This submits an execution through the firewall. The contract decides whether it is allowed. This page does not approve it."
        confirmLabel="Execute action"
        pending={Boolean(busy)}
        onOpenChange={(open) => setConfirm(open ? "execute" : null)}
        onConfirm={() => {
          setConfirm(null);
          void executeAction();
        }}
      >
        <p>Network: {MONAD_TESTNET.label}</p>
        <p className="mt-2">Target {execTarget || "Not set"}</p>
        <p className="mt-1">Value {execValue || "0"} wei</p>
        <p className="mt-2">{policyHint(firewall, execTarget, execData)}</p>
      </ConfirmDialog>

      {note ? <p className="mt-4 text-sm text-muted">{note}</p> : null}
      {error ? (
        <div className="mt-4">
          <ChainError raw={error} />
        </div>
      ) : null}
    </section>
  );
}
