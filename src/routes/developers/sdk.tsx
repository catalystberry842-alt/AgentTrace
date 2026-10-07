import { createFileRoute, Link } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { CodeBlock, Mono } from "@/components/ui";

export const Route = createFileRoute("/developers/sdk")({ component: SdkPage });

function SdkPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">SDK</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        <Mono>agenttrace-monad</Mono> is the TypeScript client in this repository, packaged for npm but not yet published. Network values other than Monad testnet throw before any request.
      </p>
      <DeveloperNav current="/developers/sdk" />
      <CodeBlock
        language="ts"
        code={`import { AgentTrace } from "agenttrace-monad";

const agenttrace = new AgentTrace({
  apiKey: process.env.AGENTTRACE_API_KEY,
  network: "monad-testnet",
  baseUrl: process.env.AGENTTRACE_BASE_URL,
});`}
      />
      <p className="mt-6 max-w-xl text-sm text-muted">
        Methods: agents.create, agents.get, agents.update, firewalls.create, firewalls.execute, proofs.verify, proofs.waitForVerification, outcomes.verify, webhooks.verifySignature. There is no direct execution method.
      </p>
      <p className="mt-4 text-sm text-muted">
        A write is confirmed only after a receipt is indexed. Until the contracts are deployed, create calls return failed with null ids. They do not invent a transaction hash.
      </p>
      <Link to="/developers/docs" className="mt-6 inline-flex h-11 items-center text-sm hover:underline">
        Full quickstart
      </Link>
    </Shell>
  );
}
