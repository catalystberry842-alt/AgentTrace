import { useEffect, useState } from "react";
import { getErc8004Execution, getErc8004Status, linkErc8004, publishErc8004 } from "@/lib/agents/functions";
import { AGENTTRACE_METADATA_KEY, agentTraceLinkValue, identityRegistryAbi, validationRegistryAbi, type Erc8004Status } from "@/lib/chain/erc8004";
import { useWalletAccount } from "@/lib/chain/wallet-account";
import { addressUrl, formatUtc } from "@/lib/format";
import { Button, ChainError } from "@/components/ui";
import { TxValue } from "@/components/values";

function ExplorerLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  return href ? (
    <a href={href} className="hover:underline" rel="noreferrer">
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}

/** ERC-8004 identity, validations, and outcome feedback for one AgentTrace agent. */
export function Erc8004Panel({ agentId, owner }: { agentId: string; owner: string }) {
  const [status, setStatus] = useState<Erc8004Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const wallet = useWalletAccount();
  const isOwner = Boolean(wallet.address && wallet.address.toLowerCase() === owner.toLowerCase());

  function load() {
    return getErc8004Status({ data: agentId }).then(setStatus).catch(() => setStatus(null));
  }
  useEffect(() => {
    void load();
  }, [agentId]);

  async function register() {
    if (!status?.agentTraceRegistry) return;
    setError(null);
    setBusy("Confirm in your wallet");
    try {
      const { sendContractTransaction } = await import("@/lib/chain/wallet");
      const uri = `${window.location.origin}/api/erc8004/agents/${agentId}`;
      const hash = await sendContractTransaction({
        to: status.registries.identity,
        abi: identityRegistryAbi,
        functionName: "register",
        args: [uri, [{ metadataKey: AGENTTRACE_METADATA_KEY, metadataValue: agentTraceLinkValue(status.agentTraceRegistry as `0x${string}`, agentId) }]],
      });
      setBusy("Waiting for confirmation");
      await linkErc8004({ data: { agentId, txHash: hash } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The registration was not completed.");
    } finally {
      setBusy(null);
    }
  }

  if (!status) {
    return (
      <div className="grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4" aria-hidden>
        {[0, 1, 2, 3].map((n) => (
          <div key={n} className="bg-bg p-4">
            <div className="h-3 w-20 animate-pulse rounded-sm bg-subtle" />
            <div className="mt-3 h-4 w-28 animate-pulse rounded-sm bg-subtle" />
          </div>
        ))}
      </div>
    );
  }
  const linked = Boolean(status.link);
  return (
    <div>
      <p className="max-w-2xl text-sm text-pretty text-muted">
        {linked
          ? "This agent's verified record is published to the shared ERC-8004 registries on Monad. Any wallet, marketplace, or agent can read it onchain without trusting AgentTrace."
          : "Not linked to ERC-8004 yet. Once linked, AgentTrace publishes each verified proof and outcome to the shared ERC-8004 registries, where anyone can read them onchain."}
      </p>
      {linked && status.link ? (
        <dl className="mt-4 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-4">
          <Cell label="Identity">
            <ExplorerLink href={addressUrl(status.registries.identity)}>#{status.link.erc8004Id}</ExplorerLink>
          </Cell>
          <Cell label="Validations" hint="Proofs AgentTrace verified">
            {status.validation?.count ? `${status.validation.count} · ${status.validation.average}/100` : "None yet"}
          </Cell>
          <Cell label="Outcome feedback" hint="Reputation registry">
            {status.outcomes?.count ? `${status.outcomes.count} · ${status.outcomes.average}/100` : "None yet"}
          </Cell>
          <Cell label="Agent card">
            <a href={`/api/erc8004/agents/${agentId}`} className="hover:underline">
              Registration file
            </a>
          </Cell>
        </dl>
      ) : null}
      {linked && status.activity && status.activity.length ? (
        <div className="mt-4">
          <p className="font-mono text-[11px] tracking-widest text-faint uppercase">Onchain history · indexed with Envio HyperSync</p>
          <ul className="mt-2 divide-y divide-border border-y border-border">
            {status.activity.map((item) => (
              <li key={`${item.kind}-${item.txHash}`} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[10rem_1fr_auto] sm:items-baseline sm:gap-x-6">
                <span>{item.kind === "validation" ? "Validation response" : "Outcome feedback"}</span>
                <span className="text-muted">
                  {item.score != null ? `${item.score}/100 · ` : ""}
                  {item.timestamp ? formatUtc(new Date(item.timestamp * 1000).toISOString()) : `block ${item.blockNumber}`}
                </span>
                <TxValue hash={item.txHash} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {!status.link && isOwner ? (
        <div className="mt-4">
          <Button type="button" variant="secondary" disabled={Boolean(busy)} onClick={() => void register()}>
            {busy ?? "Register on ERC-8004"}
          </Button>
          <p className="mt-2 max-w-sm text-xs text-muted">Mints an ERC-8004 identity that points back to this agent. One wallet transaction.</p>
        </div>
      ) : null}
      {error ? <ChainError raw={error} /> : null}
    </div>
  );
}

function Cell({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="bg-bg p-4">
      <dt className="font-mono text-[11px] tracking-widest text-faint uppercase">{label}</dt>
      <dd className="mt-2 text-sm text-fg">{children}</dd>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

type ExecutionState = Awaited<ReturnType<typeof getErc8004Execution>>;

/** ERC-8004 validation state for one execution, with the owner's request button. */
export function Erc8004Validation({ executionId, txHash, owner }: { executionId: string; txHash: string; owner: string }) {
  const [state, setState] = useState<ExecutionState | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWalletAccount();

  function load() {
    return getErc8004Execution({ data: executionId }).then(setState).catch(() => setState(null));
  }
  useEffect(() => {
    void load();
  }, [executionId]);

  const link = state?.status.link ?? null;
  const isOwner = Boolean(link && wallet.address && wallet.address.toLowerCase() === link.owner.toLowerCase());

  async function request() {
    if (!state?.proofHash || !link || !state.status.validator) return;
    setError(null);
    setBusy("Confirm in your wallet");
    try {
      if (!state.request) {
        const { sendContractTransaction } = await import("@/lib/chain/wallet");
        await sendContractTransaction({
          to: state.status.registries.validation,
          abi: validationRegistryAbi,
          functionName: "validationRequest",
          args: [state.status.validator, BigInt(link.erc8004Id), `${window.location.origin}/proofs/${executionId}`, state.proofHash],
        });
      }
      setBusy("AgentTrace is validating");
      for (let i = 0; i < 6; i += 1) {
        const result = await publishErc8004({ data: { executionId, txHash } });
        if (result.validation.state === "sent" || result.validation.state === "responded") break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The validation was not completed.");
    } finally {
      setBusy(null);
    }
  }

  if (state === undefined) return null;
  if (!state) return null;
  const responded = state.request?.responded;
  return (
    <section className="mt-10">
      <h2 className="text-sm font-medium">Published to ERC-8004</h2>
      <p className="mt-2 max-w-2xl text-sm text-pretty text-muted">
        {!link
          ? "This agent is not linked to an ERC-8004 identity, so the verdict is not published."
          : responded
            ? "AgentTrace's verifier posted this verdict to the shared ERC-8004 Validation Registry, keyed by the proof hash. Anyone can read it onchain."
            : state.request
              ? "Validation was requested. Waiting for the AgentTrace verifier to respond onchain."
              : "Not yet published. The agent owner can request validation; the AgentTrace verifier then answers onchain."}
      </p>
      <dl className="mt-4 grid gap-px overflow-hidden rounded-sm border border-border bg-border sm:grid-cols-3">
        <Cell label="Identity">{link ? `ERC-8004 #${link.erc8004Id}` : "Not linked"}</Cell>
        <Cell label="Validation">
          {responded ? (
            <span className="text-ok">{state.request?.response}/100 · responseHash = proof hash</span>
          ) : state.request ? (
            "Requested"
          ) : (
            "Not requested"
          )}
        </Cell>
        <Cell label="Transactions">
          {state.txs.validation || state.txs.feedback ? (
            <span className="grid gap-1">
              {state.txs.validation ? (
                <span>
                  <span className="text-muted">Response </span>
                  <TxValue hash={state.txs.validation} />
                </span>
              ) : null}
              {state.txs.feedback ? (
                <span>
                  <span className="text-muted">Feedback </span>
                  <TxValue hash={state.txs.feedback} />
                </span>
              ) : null}
            </span>
          ) : (
            "—"
          )}
        </Cell>
      </dl>
      {link && isOwner && state.anchored && !responded ? (
        <Button type="button" variant="secondary" className="mt-3" disabled={Boolean(busy)} onClick={() => void request()}>
          {busy ?? (state.request ? "Ask AgentTrace to respond" : "Request ERC-8004 validation")}
        </Button>
      ) : null}
      {link && !state.anchored ? <p className="mt-2 text-sm text-muted">Validation is posted after the proof is anchored.</p> : null}
      {error ? <ChainError raw={error} /> : null}
    </section>
  );
}
