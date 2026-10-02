import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getChainStatus } from "@/lib/agents/functions";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Mono } from "@/components/ui";
import { MONAD_TESTNET } from "@/lib/chain/network";

export const Route = createFileRoute("/developers/docs/demo")({ component: DemoDocs });

function DemoDocs() {
  const [addresses, setAddresses] = useState<{ registry: string | null; firewall: string | null; proof: string | null; demo: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChainStatus()
      .then((status) => {
        if (!cancelled) {
          setAddresses({
            registry: status.registry,
            firewall: status.firewall,
            proof: status.proofAnchor,
            demo: status.demoProtocol,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setAddresses({ registry: null, firewall: null, proof: null, demo: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">Demo</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        The AgentTrace demo is a test on Monad testnet. It is not production DeFi. Chain <Mono>{MONAD_TESTNET.chainId}</Mono>.
      </p>
      <DeveloperNav current="/developers/docs" />
      <ol className="mt-8 max-w-xl list-decimal space-y-3 pl-5 text-sm text-muted">
        <li>Agent identity. The wallet calls Agent Registry <Mono>registerAgent</Mono> for Research Agent. The id exists only after <Mono>AgentRegistered</Mono> is indexed.</li>
        <li>Firewall policy. The owner creates a firewall with value transfer disabled and the same wallet as executor.</li>
        <li>Controlled execution. The firewall allows Demo Protocol <Mono>deposit(uint256,uint256)</Mono> and does not allow <Mono>withdraw(uint256,uint256)</Mono>.</li>
        <li>AgentAction. <Mono>execute</Mono> emits <Mono>AgentAction</Mono> only if the call succeeds. A rejected withdraw emits nothing.</li>
        <li>Receipt verification. The proof checks the Monad receipt. It does not accept a caller-supplied hash.</li>
        <li>Proof. Status becomes execution verified only when those checks pass.</li>
        <li>Outcome verification. The adapter looks for <Mono>Deposited(uint256,uint256)</Mono> on the demo contract, with amount 100 and the same agent id.</li>
        <li>Public passport. Counts come from indexed executions and outcome rows. They are not a score.</li>
      </ol>
      <dl className="mt-8 max-w-xl border-t border-border text-sm">
        <Fact label="Registry" value={addresses ? addresses.registry ?? "Not deployed" : "—"} />
        <Fact label="Firewall" value={addresses ? addresses.firewall ?? "Not deployed" : "—"} />
        <Fact label="Proof" value={addresses ? addresses.proof ?? "Not deployed" : "—"} />
        <Fact label="Demo protocol" value={addresses ? addresses.demo ?? "Not deployed" : "—"} />
      </dl>
      <p className="mt-4 max-w-xl text-sm text-muted">
        These addresses come from <Mono>MONAD_TESTNET_AGENT_REGISTRY</Mono>, <Mono>MONAD_TESTNET_AGENT_FIREWALL</Mono>, <Mono>MONAD_TESTNET_AGENT_PROOF</Mono>, and <Mono>MONAD_TESTNET_DEMO_PROTOCOL</Mono> when those are set. Otherwise the deployment record is used. Nothing on this page is a placeholder address.
      </p>
      <p className="mt-6 text-sm">
        <Link to="/demo" className="text-muted hover:text-fg">
          Open the demo
        </Link>
      </p>
    </Shell>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:gap-8">
      <dt className="text-xs tracking-widest text-muted uppercase sm:w-40">{label}</dt>
      <dd className="font-mono text-sm break-all">{value}</dd>
    </div>
  );
}
