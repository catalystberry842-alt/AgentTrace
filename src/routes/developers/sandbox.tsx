import { createFileRoute, Link } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Mono } from "@/components/ui";
import { deployment } from "@/lib/chain/deployment";
import { MONAD_TESTNET } from "@/lib/chain/network";

export const Route = createFileRoute("/developers/sandbox")({ component: SandboxPage });

const STEPS = [
  "Create Research Agent",
  "Create firewall",
  "Allow Demo Protocol",
  "Allow a specific function",
  "Execute action",
  "Show transaction",
  "Verify execution",
  "Generate proof",
  "Verify outcome",
  "Open the agent passport",
] as const;

function SandboxPage() {
  const ready =
    deployment.agentRegistry !== null &&
    deployment.agentFirewall !== null &&
    deployment.agentProof !== null &&
    deployment.demoProtocol !== null;

  return (
    <Shell>
      <p className="font-mono text-xs tracking-widest text-faint">MONAD TESTNET · TEST ENVIRONMENT</p>
      <h1 className="mt-2 text-2xl font-medium tracking-tight">AgentTrace Demo Protocol</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        A test contract for the AgentTrace path. It is not production DeFi. Chain <Mono>{MONAD_TESTNET.chainId}</Mono>.
      </p>
      <DeveloperNav current="/developers/sandbox" />
      <ol className="mt-8 max-w-xl list-decimal space-y-2 pl-5 text-sm text-muted">
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="mt-8 max-w-xl border-t border-border pt-6 text-sm">
        {ready ? (
          <p className="text-muted">Contracts are configured. This page still does not invent an execution, proof, or outcome.</p>
        ) : (
          <p>Testnet connection unavailable</p>
        )}
        <p className="mt-3 text-muted">
          Demo Protocol {deployment.demoProtocol ? <Mono>{deployment.demoProtocol}</Mono> : "is not deployed"}. The{" "}
          <Link to="/demo" className="text-fg underline-offset-4 hover:underline">
            demo
          </Link>{" "}
          runs the same path and does not invent a result.
        </p>
      </div>
    </Shell>
  );
}
