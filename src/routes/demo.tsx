import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { encodeFunctionData } from "viem";
import {
  confirmFirewallTx,
  getChainStatus,
  getFirewall,
  readDemoState,
  refreshFirewallIntent,
  refreshIntent,
  submitFirewall,
  submitRegistration,
  verifyDemoDeposit,
  verifyProof,
} from "@/lib/agents/functions";
import type { Capability } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Button, ChainError, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { demoProtocolAbi } from "@/lib/chain/abi";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { formatAgentId, formatAgentLabel, proofStatusLabel, txUrl } from "@/lib/format";

export const Route = createFileRoute("/demo")({ component: DemoPage });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");
const STORAGE = "agenttrace.demo";
const AGENT = {
  name: "Research Agent",
  description: "An example AI agent operating through AgentTrace.",
  capabilities: ["Research", "Data"] as Capability[],
  metadataURI: "",
};

type Saved = {
  intentId: string | null;
  agentId: string | null;
  firewallIntentId: string | null;
  firewallId: string | null;
  executor: string | null;
  executionId: string | null;
  txHash: string | null;
  proofStatus: string | null;
  outcomeStatus: string | null;
  observed: string | null;
};

type Failed = { step: string; detail: string; txHash: string | null; retry: "agent" | "firewall" | "permission" | "deposit" | "withdraw" };
type Checks = {
  targetAllowed: boolean;
  depositAllowed: boolean;
  swapAllowed: boolean;
  withdrawAllowed: boolean;
  valueTransferDisabled: boolean;
  executor: string | null;
};

const empty: Saved = {
  intentId: null,
  agentId: null,
  firewallIntentId: null,
  firewallId: null,
  executor: null,
  executionId: null,
  txHash: null,
  proofStatus: null,
  outcomeStatus: null,
  observed: null,
};

function loadSaved(): Saved {
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Saved>;
    return { ...empty, ...parsed };
  } catch {
    return empty;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function DemoPage() {
  const { user, isPending } = useCurrentUserState();
  const [ready, setReady] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [gateNote, setGateNote] = useState<"rpc" | "missing" | null>(null);
  const [gateRetry, setGateRetry] = useState(0);
  const [demoAddress, setDemoAddress] = useState<string | null>(null);
  const [firewallAddress, setFirewallAddress] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved>(empty);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSaved(loadSaved());
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    window.localStorage.setItem(STORAGE, JSON.stringify(saved));
  }, [ready, saved]);

  useEffect(() => {
    let cancelled = false;
    function load() {
      setConfigured(null);
      getChainStatus()
        .then((status) => {
          if (cancelled) return;
          setDemoAddress(status.demoProtocol);
          setFirewallAddress(status.firewall);
          if (!status.rpcOk) {
            setConfigured(false);
            setGateNote("rpc");
            return;
          }
          const ready = Boolean(status.registry && status.firewall && status.demoProtocol);
          setConfigured(ready);
          setGateNote(ready ? null : "missing");
        })
        .catch(() => {
          if (cancelled) return;
          setConfigured(false);
          setGateNote("rpc");
        });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [gateRetry]);

  useEffect(() => {
    if (!saved.firewallId) {
      setChecks(null);
      return;
    }
    let cancelled = false;
    readDemoState({ data: saved.firewallId })
      .then((result) => {
        if (cancelled) return;
        setChecks(result.checks);
        setCheckError(result.error);
        if (result.demoProtocol) setDemoAddress(result.demoProtocol);
        if (result.firewall) setFirewallAddress(result.firewall);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCheckError(err instanceof Error ? err.message : "The firewall could not be read.");
      });
    return () => {
      cancelled = true;
    };
  }, [saved.firewallId, phase]);

  const executorAuthorized = Boolean(
    checks?.executor && saved.executor && checks.executor === saved.executor.toLowerCase(),
  );
  const permissionReady = Boolean(checks?.targetAllowed && checks.depositAllowed && checks.valueTransferDisabled && executorAuthorized);
  const depositSelectorReady = Boolean(checks && checks.depositAllowed && !checks.withdrawAllowed);

  function reset() {
    window.localStorage.removeItem(STORAGE);
    setSaved(empty);
    setPhase(null);
    setFailed(null);
    setBlocked(null);
    setChecks(null);
  }

  async function createAgent() {
    if (!configured) return;
    setBusy(true);
    setFailed(null);
    setPhase("Submitting transaction");
    try {
      const { sendRegisterTransaction } = await import("@/lib/chain/wallet");
      const { getSigner } = await import("@/lib/chain/wallet");
      const signer = await getSigner();
      const executor = (await signer.getAddress()).toLowerCase();
      const status = await getChainStatus();
      if (!status.registry) throw new Error("Agent Registry is not deployed. No transaction was sent.");
      const hash = await sendRegisterTransaction({
        registry: status.registry as `0x${string}`,
        name: AGENT.name,
        description: AGENT.description,
        metadataURI: "",
        capabilities: AGENT.capabilities,
      });
      setPhase("Waiting for confirmation");
      const submitted = await submitRegistration({
        data: { ...AGENT, txHash: hash },
      });
      let intent = submitted.intent;
      for (let attempt = 0; attempt < 8 && intent.status === "pending"; attempt += 1) {
        setPhase("Transaction confirmed. Waiting for AgentTrace indexing...");
        await sleep(2000);
        const next = await refreshIntent({ data: intent.id });
        intent = next.intent;
      }
      if (!intent.chainAgentId) {
        throw new Error(intent.error ?? "The registry transaction is not indexed yet. No agent id was assigned.");
      }
      setSaved((current) => ({
        ...current,
        intentId: intent.id,
        agentId: intent.chainAgentId,
        executor,
        txHash: intent.txHash,
      }));
      setPhase(null);
    } catch (err) {
      setFailed({
        step: "Create agent",
        detail: err instanceof Error ? err.message : "Agent creation failed.",
        txHash: null,
        retry: "agent",
      });
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function createFirewall() {
    if (!saved.agentId || !saved.executor || !firewallAddress) return;
    setBusy(true);
    setFailed(null);
    setPhase("Submitting transaction");
    try {
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const hash = await sendFirewallTransaction({
        to: firewallAddress as `0x${string}`,
        functionName: "createFirewall",
        args: [BigInt(saved.agentId), saved.executor as `0x${string}`, false, 0n, 0n, 86400n],
      });
      setPhase("Waiting for confirmation");
      const submitted = await submitFirewall({
        data: {
          agentId: saved.agentId,
          executor: saved.executor as `0x${string}`,
          allowValueTransfer: false,
          maxValuePerTransaction: "0",
          maxValuePerPeriod: "0",
          periodDuration: "86400",
          txHash: hash,
        },
      });
      let intent = submitted.intent;
      for (let attempt = 0; attempt < 8 && !intent.chainFirewallId && intent.status === "pending"; attempt += 1) {
        setPhase("Transaction confirmed. Waiting for AgentTrace indexing...");
        await sleep(2000);
        const next = await refreshFirewallIntent({ data: intent.id });
        intent = next.intent;
      }
      if (!intent.chainFirewallId) {
        throw new Error(intent.error ?? "The firewall transaction is not indexed yet. No firewall id was assigned.");
      }
      setSaved((current) => ({
        ...current,
        firewallIntentId: intent.id,
        firewallId: intent.chainFirewallId,
        txHash: intent.txHash,
      }));
      setPhase(null);
    } catch (err) {
      setFailed({
        step: "Create firewall",
        detail: err instanceof Error ? err.message : "Firewall creation failed.",
        txHash: null,
        retry: "firewall",
      });
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function configurePermission() {
    if (!saved.firewallId || !firewallAddress || !demoAddress) return;
    setBusy(true);
    setFailed(null);
    setPhase("Submitting transaction");
    try {
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const to = firewallAddress as `0x${string}`;
      const id = BigInt(saved.firewallId);
      const target = demoAddress as `0x${string}`;
      if (!checks?.targetAllowed) {
        const hash = await sendFirewallTransaction({
          to,
          functionName: "allowTarget",
          args: [id, target, "AgentTrace Demo Protocol"],
        });
        setPhase("Waiting for confirmation");
        await waitIndexed(hash, saved.firewallId);
      }
      const deposit = encodeFunctionData({ abi: demoProtocolAbi, functionName: "deposit", args: [1n, 1n] }).slice(0, 10);
      setPhase("Submitting transaction");
      const allowed = await sendFirewallTransaction({
        to,
        functionName: "allowFunction",
        args: [id, target, deposit as `0x${string}`],
      });
      setPhase("Waiting for confirmation");
      await waitIndexed(allowed, saved.firewallId);
      const next = await readDemoState({ data: saved.firewallId });
      setChecks(next.checks);
      setCheckError(next.error);
      if (!next.checks?.targetAllowed || !next.checks.depositAllowed) {
        throw new Error("The firewall did not confirm the deposit permission.");
      }
      if (next.checks.withdrawAllowed) {
        throw new Error("Withdraw is allowed. The demo requires that function to stay blocked.");
      }
      setPhase(null);
    } catch (err) {
      setFailed({
        step: "Configure permission",
        detail: err instanceof Error ? err.message : "The permission was not confirmed.",
        txHash: null,
        retry: "permission",
      });
      setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function runDeposit() {
    if (!saved.agentId || !saved.firewallId || !firewallAddress || !demoAddress || !permissionReady) return;
    setBusy(true);
    setFailed(null);
    setBlocked(null);
    setPhase("Submitting transaction");
    let hash: `0x${string}` | null = null;
    try {
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const data = encodeFunctionData({
        abi: demoProtocolAbi,
        functionName: "deposit",
        args: [BigInt(saved.agentId), 100n],
      });
      hash = await sendFirewallTransaction({
        to: firewallAddress as `0x${string}`,
        functionName: "execute",
        args: [BigInt(saved.firewallId), demoAddress as `0x${string}`, 0n, data],
      });
      setSaved((current) => ({ ...current, txHash: hash }));
      setPhase("Waiting for confirmation");
      let indexed = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const result = await confirmFirewallTx({ data: { txHash: hash, firewallId: saved.firewallId } });
        if (result.state === "indexed") {
          indexed = true;
          break;
        }
        if (result.state === "reverted" || result.state === "empty") {
          throw new Error("error" in result ? result.error : "The transaction did not create an agent action.");
        }
        setPhase("Waiting for confirmation");
        await sleep(2000);
      }
      if (!indexed) throw new Error("The transaction is confirmed or still pending. Indexing did not finish. Nothing was marked verified.");
      setPhase("Indexing action");
      const fresh = await getFirewall({ data: saved.firewallId });
      const action = fresh.actions.find((row) => row.txHash.toLowerCase() === hash?.toLowerCase());
      if (!action) throw new Error("Transaction confirmed. Waiting for AgentTrace indexing...");
      setSaved((current) => ({ ...current, executionId: action.executionId, txHash: hash }));
      setPhase("Verifying execution");
      let proof = await verifyProof({ data: action.executionId });
      for (
        let attempt = 0;
        attempt < 4 &&
        (proof.proof.verificationStatus === "temporary_error" ||
          proof.proof.verificationStatus === "executed" ||
          proof.proof.verificationStatus === "requested");
        attempt += 1
      ) {
        setPhase("Execution detected. Verifying transaction evidence...");
        await sleep(2000);
        proof = await verifyProof({ data: action.executionId });
      }
      setSaved((current) => ({ ...current, proofStatus: proof.proof.verificationStatus }));
      if (proof.proof.verificationStatus !== "receipt_verified") {
        throw new Error(
          proof.proof.lastError
            ? `Execution detected, but verification failed. ${proof.proof.lastError}`
            : "Execution detected, but verification failed.",
        );
      }
      setPhase("Proof created");
      setPhase("Checking outcome...");
      const outcome = await verifyDemoDeposit({ data: action.executionId });
      setSaved((current) => ({
        ...current,
        outcomeStatus: outcome.status,
        observed: outcome.observed,
      }));
      if (outcome.status !== "verified") {
        setPhase(outcome.status === "unverifiable" ? "Outcome unavailable" : "Outcome verification failed");
        throw new Error(outcome.reason || "The outcome was not verified.");
      }
      setPhase("Outcome verified");
    } catch (err) {
      setFailed({
        step: "Run deposit",
        detail: err instanceof Error ? err.message : "The action failed.",
        txHash: hash,
        retry: "deposit",
      });
      if (phase !== "Outcome verified") setPhase(null);
    } finally {
      setBusy(false);
    }
  }

  async function runWithdraw() {
    if (!saved.agentId || !saved.firewallId || !firewallAddress || !demoAddress) return;
    if (!checks || checks.withdrawAllowed || !checks.depositAllowed) {
      setFailed({
        step: "Blocked action",
        detail: "Withdraw is not currently forbidden by the indexed firewall, so this page will not claim it was blocked.",
        txHash: null,
        retry: "withdraw",
      });
      return;
    }
    setBusy(true);
    setFailed(null);
    setBlocked(null);
    try {
      const { sendFirewallTransaction } = await import("@/lib/chain/wallet");
      const data = encodeFunctionData({
        abi: demoProtocolAbi,
        functionName: "withdraw",
        args: [BigInt(saved.agentId), 100n],
      });
      const hash = await sendFirewallTransaction({
        to: firewallAddress as `0x${string}`,
        functionName: "execute",
        args: [BigInt(saved.firewallId), demoAddress as `0x${string}`, 0n, data],
      });
      setFailed({
        step: "Blocked action",
        detail: "The firewall accepted withdraw. A blocked result is not shown.",
        txHash: hash,
        retry: "withdraw",
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "The action failed.";
      if (/FunctionNotAllowed|not allowed/i.test(detail)) {
        setBlocked("Function not allowed by firewall.");
      } else {
        setFailed({ step: "Blocked action", detail, txHash: null, retry: "withdraw" });
      }
    } finally {
      setBusy(false);
    }
  }

  const txHref = txUrl(saved.txHash);
  const observedAmount = saved.observed?.includes("100") ? "100" : null;

  return (
    <Shell>
      <p className="font-mono text-xs tracking-widest text-faint">
        {MONAD_TESTNET.name} · Chain {MONAD_TESTNET.chainId}
      </p>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">AgentTrace Demo</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        See how AgentTrace gives an AI agent identity, controlled execution and verifiable outcomes.
      </p>
      <ol className="mt-8 flex flex-wrap gap-x-3 gap-y-2 text-sm" aria-label="Demo path">
        {["Agent", "Firewall", "Action", "Execution", "Proof", "Outcome"].map((item, index) => (
          <li key={item} className="flex items-center gap-3">
            {index > 0 ? <span className="text-faint">→</span> : null}
            <span>{item}</span>
          </li>
        ))}
      </ol>

      {configured === null ? <div className="mt-10"><SkeletonLines /></div> : null}
      {configured === false && gateNote === "rpc" ? (
        <div className="mt-8 max-w-xl">
          <p className="text-sm text-muted">Monad Testnet connection unavailable.</p>
          <Button type="button" className="mt-4" variant="secondary" onClick={() => setGateRetry((value) => value + 1)}>
            Retry
          </Button>
        </div>
      ) : null}
      {configured === false && gateNote === "missing" ? (
        <p className="mt-8 max-w-xl text-sm text-muted">
          Agent Registry, Agent Firewall, and Demo Protocol are not deployed on Monad testnet. No transaction will be sent and no result will be invented.
        </p>
      ) : null}

      {configured && isPending ? <div className="mt-8 h-11 w-28 animate-pulse rounded-sm bg-subtle" /> : null}
      {configured && !isPending && !user && authEnabled && google ? (
        <div className="mt-8">
          <Button type="button" onClick={() => void signIn(google.providerId, { callbackURL: "/demo" })}>
            Sign in
          </Button>
        </div>
      ) : null}

      {configured && user ? (
        <div className="mt-10 max-w-xl space-y-8">
          <section>
            <h2 className="text-sm font-medium">Agent</h2>
            {saved.agentId ? (
              <p className="mt-2 text-sm">
                {AGENT.name} · <Mono>{formatAgentLabel(saved.agentId)}</Mono> · <StatusText tone="ok">Active</StatusText>
              </p>
            ) : (
              <div className="mt-3">
                <Button type="button" disabled={busy} onClick={() => void createAgent()}>
                  Create Research Agent
                </Button>
              </div>
            )}
            <p className="mt-2 text-sm text-muted">{AGENT.description}</p>
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="text-sm font-medium">Firewall</h2>
            {saved.firewallId ? (
              <p className="mt-2 text-sm">
                Firewall {formatAgentId(saved.firewallId)} · Agent {AGENT.name}
                {saved.executor ? <span className="mt-1 block text-muted">Executor <Mono>{saved.executor}</Mono></span> : null}
              </p>
            ) : (
              <div className="mt-3">
                <Button type="button" disabled={busy || !saved.agentId} onClick={() => void createFirewall()}>
                  Create firewall
                </Button>
              </div>
            )}
            <p className="mt-2 text-sm text-muted">Value transfer disabled. The agent is not given unrestricted access.</p>
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="text-sm font-medium">Permission</h2>
            <p className="mt-2 text-sm text-muted">Target AgentTrace Demo Protocol. Function deposit. Swap and withdraw stay closed.</p>
            {saved.firewallId && !permissionReady ? (
              <div className="mt-3">
                <Button type="button" disabled={busy} onClick={() => void configurePermission()}>
                  Allow deposit
                </Button>
              </div>
            ) : null}
            {checks ? (
              <ul className="mt-4 space-y-2 text-sm">
                <Check label="Target allowed" passed={checks.targetAllowed} />
                <Check label="Function allowed" passed={checks.depositAllowed} />
                <Check label="Value within policy" passed={checks.valueTransferDisabled} />
                <Check label="Executor authorized" passed={executorAuthorized} pending={!saved.executor} />
                <Check label="Withdraw blocked" passed={!checks.withdrawAllowed} />
                <Check label="Swap blocked" passed={!checks.swapAllowed} />
              </ul>
            ) : null}
            {checkError ? <p className="mt-3 text-sm text-danger">{checkError}</p> : null}
          </section>

          <section className="border-t border-border pt-6">
            <h2 className="text-sm font-medium">Run agent action</h2>
            <dl className="mt-3 text-sm">
              <Row label="Agent" value={AGENT.name} />
              <Row label="Firewall" value={saved.firewallId ? `Firewall ${formatAgentId(saved.firewallId)}` : "Not created"} />
              <Row label="Target" value="AgentTrace Demo Protocol" />
              <Row label="Action" value="deposit" />
              <Row label="Amount" value="100" />
            </dl>
            <p className="mt-2 text-sm text-muted">No MON is attached. The amount is the Demo Protocol argument.</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" disabled={busy || !permissionReady || Boolean(saved.outcomeStatus === "verified")} onClick={() => void runDeposit()}>
                Execute action
              </Button>
              <Button type="button" variant="secondary" disabled={busy || !depositSelectorReady} onClick={() => void runWithdraw()}>
                Attempt withdraw
              </Button>
            </div>
            {phase ? <p className="mt-4 text-sm">{phase}</p> : null}
          </section>

          {saved.executionId ? (
            <section className="border-t border-border pt-6">
              <h2 className="text-sm font-medium">Live execution</h2>
              <ol className="mt-4 border-l border-border pl-4 text-sm">
                <Stage label="Identity" value={saved.agentId ? formatAgentLabel(saved.agentId) : null} />
                <Stage label="Control" value={saved.firewallId ? `Firewall ${formatAgentId(saved.firewallId)}` : null} />
                <Stage label="Execution" value={saved.executionId ? saved.executionId.slice(0, 10) : null} />
                <Stage label="Proof" value={saved.proofStatus === "receipt_verified" ? proofStatusLabel(saved.proofStatus) : null} />
                <Stage label="Outcome" value={saved.outcomeStatus === "verified" ? "Outcome verified" : null} />
              </ol>
            </section>
          ) : null}

          {saved.outcomeStatus === "verified" ? (
            <section className="border-t border-border pt-6">
              <h2 className="text-sm font-medium">Agent action verified</h2>
              <dl className="mt-3 text-sm">
                <Row label="Agent" value={AGENT.name} />
                <Row label="Execution" value={saved.executionId ?? "—"} />
                <Row label="Proof" value="Execution verified" />
                <Row label="Outcome" value="Verified" />
                <Row label="Expected" value="100" />
                <Row label="Observed" value={observedAmount ?? saved.observed ?? "—"} />
                <Row label="Evidence" value="Deposited event" />
              </dl>
              <div className="mt-4 flex flex-col items-start gap-1 text-sm">
                {saved.agentId ? (
                  <Link to="/agents/$agentId" params={{ agentId: saved.agentId }} className="text-muted hover:text-fg">
                    View agent passport
                  </Link>
                ) : null}
                {saved.executionId ? (
                  <Link to="/proofs/$proofId" params={{ proofId: saved.executionId }} className="text-muted hover:text-fg">
                    View proof
                  </Link>
                ) : null}
                {saved.agentId ? (
                  <Link to="/agents/$agentId/outcomes" params={{ agentId: saved.agentId }} search={{ status: "verified" }} className="text-muted hover:text-fg">
                    View outcome
                  </Link>
                ) : null}
                {txHref ? (
                  <a href={txHref} className="text-muted hover:text-fg" rel="noreferrer">
                    View transaction
                  </a>
                ) : null}
              </div>
            </section>
          ) : null}

          {blocked ? (
            <section className="border-t border-border pt-6">
              <h2 className="text-sm font-medium">Action blocked</h2>
              <p className="mt-2 text-sm text-muted">Firewall policy prevented this execution.</p>
              <dl className="mt-3 text-sm">
                <Row label="Agent" value={AGENT.name} />
                <Row label="Firewall" value={saved.firewallId ? formatAgentId(saved.firewallId) : "—"} />
                <Row label="Target" value="AgentTrace Demo Protocol" />
                <Row label="Function" value="withdraw()" />
                <Row label="Reason" value={blocked} />
                <Row label="Status" value="Blocked" />
              </dl>
              <p className="mt-3 text-sm text-muted">No transaction was submitted. A rejected call does not create an AgentAction.</p>
              {saved.firewallId ? (
                <Link to="/firewalls/$firewallId" params={{ firewallId: saved.firewallId }} className="mt-3 inline-flex h-11 items-center text-sm text-muted hover:text-fg">
                  Back to firewall
                </Link>
              ) : null}
            </section>
          ) : null}

          {failed ? (
            <div className="space-y-3">
              <p className="text-sm">Stopped at {failed.step}.</p>
              <ChainError raw={failed.detail} />
              <div className="flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (failed.retry === "agent") void createAgent();
                    if (failed.retry === "firewall") void createFirewall();
                    if (failed.retry === "permission") void configurePermission();
                    if (failed.retry === "deposit") void runDeposit();
                    if (failed.retry === "withdraw") void runWithdraw();
                  }}
                >
                  Retry
                </Button>
                {saved.executionId ? (
                  <Link to="/proofs/$proofId" params={{ proofId: saved.executionId }} className="inline-flex h-11 items-center text-sm text-muted hover:text-fg">
                    View verification details
                  </Link>
                ) : null}
                {txUrl(failed.txHash) ? (
                  <a href={txUrl(failed.txHash) ?? undefined} className="inline-flex h-11 items-center text-sm text-muted hover:text-fg" rel="noreferrer">
                    View transaction
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="border-t border-border pt-6">
            <Button type="button" variant="ghost" disabled={busy} onClick={reset}>
              Reset demo
            </Button>
            <p className="mt-2 text-sm text-muted">Clears this browser’s demo position. Indexed chain history is not deleted.</p>
          </div>
        </div>
      ) : null}
    </Shell>
  );
}

async function waitIndexed(hash: `0x${string}`, firewallId: string) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await confirmFirewallTx({ data: { txHash: hash, firewallId } });
    if (result.state === "indexed") return;
    if (result.state === "reverted" || result.state === "empty") {
      throw new Error("error" in result ? result.error : "The permission transaction did not confirm.");
    }
    await sleep(2000);
  }
  throw new Error("Transaction confirmed. Waiting for AgentTrace indexing timed out.");
}

function Check({ label, passed, pending = false }: { label: string; passed: boolean; pending?: boolean }) {
  const text = pending ? "Not confirmed" : passed ? "Yes" : "No";
  return (
    <li className="flex items-center justify-between gap-4">
      <span>{label}</span>
      <StatusText tone={pending ? "pending" : passed ? "ok" : "danger"}>{text}</StatusText>
    </li>
  );
}

function Stage({ label, value }: { label: string; value: string | null }) {
  return (
    <li className="py-2">
      <span className="text-xs tracking-widest text-faint uppercase">{label}</span>
      <span className="mt-1 block">{value ?? "Not yet"}</span>
    </li>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-2 sm:flex-row sm:gap-8">
      <dt className="text-muted sm:w-28">{label}</dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </div>
  );
}
