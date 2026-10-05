import { useEffect, useState } from "react";
import { getErc8004Execution, getErc8004Status, linkErc8004, publishErc8004 } from "@/lib/agents/functions";
import { AGENTTRACE_METADATA_KEY, agentTraceLinkValue, identityRegistryAbi, validationRegistryAbi, type Erc8004Status } from "@/lib/chain/erc8004";
import { useWalletAccount } from "@/lib/chain/wallet-account";
import { addressUrl } from "@/lib/format";
import { Button, ChainError, Fact } from "@/components/ui";
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

  if (!status) return <div className="h-16 animate-pulse rounded-sm bg-subtle" aria-hidden />;
  return (
    <div>
      <dl>
        <Fact label="Identity">
          {status.link ? (
            <ExplorerLink href={addressUrl(status.registries.identity)}>ERC-8004 #{status.link.erc8004Id}</ExplorerLink>
          ) : (
            "Not linked"
          )}
        </Fact>
        {status.link ? (
          <>
            <Fact label="Validations">
              {status.validation?.count ? `${status.validation.count} by AgentTrace · average ${status.validation.average}/100` : "None yet"}
            </Fact>
            <Fact label="Outcomes">
              {status.outcomes?.count ? `${status.outcomes.count} reported · average ${status.outcomes.average}/100` : "None yet"}
            </Fact>
            <Fact label="Agent card">
              <a href={`/api/erc8004/agents/${agentId}`} className="hover:underline">
                Registration file
              </a>
            </Fact>
          </>
        ) : null}
      </dl>
      {!status.link && isOwner ? (
        <div className="mt-3">
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
      <h2 className="text-sm font-medium">ERC-8004</h2>
      <dl className="mt-3">
        <Fact label="Identity">{link ? `ERC-8004 #${link.erc8004Id}` : "Agent not linked"}</Fact>
        <Fact label="Validation">
          {!link
            ? "Link the agent to ERC-8004 to request validation."
            : responded
              ? `AgentTrace responded ${state.request?.response}/100 · responseHash = proof hash`
              : state.request
                ? "Requested. Waiting for AgentTrace."
                : "Not requested"}
        </Fact>
        {state.txs.validation ? (
          <Fact label="Response tx">
            <TxValue hash={state.txs.validation} copy />
          </Fact>
        ) : null}
        {state.txs.feedback ? (
          <Fact label="Outcome feedback">
            <TxValue hash={state.txs.feedback} copy />
          </Fact>
        ) : null}
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
