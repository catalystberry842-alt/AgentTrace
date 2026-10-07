import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Mono } from "@/components/ui";
import { CAPABILITIES } from "@/lib/agents/types";
import { deployment } from "@/lib/chain/active-deployment";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { WEBHOOK_EVENTS } from "@/lib/developer/events";

export const Route = createFileRoute("/developers/docs")({ component: DocsPage });

const SECTIONS = [
  ["what", "What is AgentTrace?"],
  ["architecture", "Architecture"],
  ["start", "Quickstart"],
  ["auth", "Authentication"],
  ["agents", "Agent identity"],
  ["firewalls", "Firewalls"],
  ["executions", "Execution"],
  ["proofs", "Proofs"],
  ["outcomes", "Outcomes"],
  ["sdk", "SDK"],
  ["api", "REST API"],
  ["webhooks", "Webhooks"],
  ["monad", "Monad testnet"],
  ["security", "Security"],
  ["errors", "Errors"],
] as const;

function DocsPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">Documentation</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        These calls match the running API. A write is <Mono>confirmed</Mono> only after a Monad receipt is indexed.
      </p>
      <DeveloperNav current="/developers/docs" />
      <nav className="mt-8 flex flex-wrap gap-x-4 gap-y-2 text-sm" aria-label="Documentation">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="text-muted hover:text-fg">
            {label}
          </a>
        ))}
      </nav>

      <Section id="what" title="What is AgentTrace?">
        <p>
          AgentTrace gives an AI agent a persistent identity, a firewall for what that agent may do, and a verifiable history of what it actually did on Monad.
        </p>
        <p className="mt-3">Identity, permissions, executions, proofs, and outcomes are separate. A successful execution is not an outcome. An outcome is not a score.</p>
      </Section>

      <Section id="architecture" title="Architecture">
        <p>Human accounts use Google sign-in. That session is not a wallet and not an agent. A wallet is requested only when a chain transaction is submitted.</p>
        <p className="mt-3">The registry, firewall, and proof contracts are the source of chain state. The database is an index of events the indexer has observed. If a contract address is not configured, the API returns a failed status and null ids. It does not invent a transaction hash.</p>
        <p className="mt-3">Verified history is aggregated from indexed executions, receipt checks, and outcome rows. It is not stored as a mutable score and there is no ranking.</p>
      </Section>

      <Section id="start" title="Quickstart">
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Create an API key. Copy it then. It is not shown again.</li>
          <li>Use the SDK in this repository. <Mono>agenttrace-monad</Mono> is packaged for npm but not yet published.</li>
          <li>Create an agent. Until the registry is deployed, the response is <Mono>failed</Mono>, with a null agent id and a null transaction hash.</li>
          <li>Create a firewall the same way. No firewall id is assigned without a confirmed <Mono>createFirewall</Mono> receipt.</li>
          <li>Execute only through <Mono>firewalls.execute</Mono>. There is no direct-execution method.</li>
          <li>Wait for a proof. The SDK stops at its timeout and does not report a receipt as verified unless the verifier did.</li>
          <li>Verify an outcome with <Mono>EVENT_EMITTED</Mono> and a Solidity event signature. Demo Protocol state checks need <Mono>source</Mono>, <Mono>field</Mono>, and <Mono>expectedValue</Mono>. Other shapes are rejected.</li>
        </ol>
        <Code>{`import { AgentTrace } from "agenttrace-monad";

const agenttrace = new AgentTrace({
  apiKey: process.env.AGENTTRACE_API_KEY,
  network: "monad-testnet",
  baseUrl: process.env.AGENTTRACE_BASE_URL,
});

const agent = await agenttrace.agents.create({
  name: "Research Agent",
  description: "AI research agent",
  capabilities: ["Research", "Data"],
});
// agent.status is "failed" and agent.agentId is null
// while the registry contract is not deployed.`}</Code>
      </Section>

      <Section id="auth" title="Authentication">
        <p>Send <Mono>Authorization: Bearer</Mono> and the API key. Keys in the query string are rejected. Development keys start with <Mono>at_test_</Mono>. Production keys start with <Mono>at_live_</Mono>. Revoked keys return 401.</p>
        <p className="mt-3">Public reads accept missing keys at a lower rate limit. Writes require a key. Limits are per minute: 60 without a key, 300 with a valid key. A 429 includes <Mono>Retry-After</Mono>.</p>
      </Section>

      <Section id="agents" title="Agent identity">
        <p><Mono>POST /api/v1/agents</Mono> accepts name, description, and capabilities ({CAPABILITIES.join(", ")}). Names are matched without case. The API does not submit the registry transaction.</p>
        <p className="mt-3">If you already broadcast <Mono>registerAgent</Mono>, send that transaction hash. Status stays <Mono>pending</Mono> until the receipt is readable, and <Mono>confirmed</Mono> only when <Mono>AgentRegistered</Mono> is indexed. A hash the RPC cannot find is not confirmation.</p>
        <p className="mt-3"><Mono>GET /api/v1/agents/:id</Mono> returns the indexed agent or <Mono>AGENT_NOT_FOUND</Mono>. <Mono>PATCH</Mono> does not change indexed fields and does not send a transaction.</p>
      </Section>

      <Section id="firewalls" title="Firewalls">
        <p><Mono>POST /api/v1/firewalls</Mono> takes <Mono>agentId</Mono>, <Mono>executor</Mono>, and <Mono>policy</Mono> (value transfer flag, per-transaction limit, period limit, period duration). Without a deployed firewall contract the status is <Mono>failed</Mono> and no id is returned.</p>
        <p className="mt-3"><Mono>POST /api/v1/firewalls/:id/targets</Mono> and <Mono>/functions</Mono> describe an allow-list change. They do not write the policy unless a confirmed owner transaction is supplied, which this API does not send.</p>
      </Section>

      <Section id="executions" title="Execution">
        <p><Mono>POST /api/v1/firewalls/:id/execute</Mono> checks the indexed pause flag, target, selector, and value limits. A rejected call returns <Mono>executionId: null</Mono> and no transaction hash.</p>
        <p className="mt-3">A call that matches policy still is not sent: there is no executor signer on the server. The response code is <Mono>CHAIN_WRITE_UNAVAILABLE</Mono>. The firewall is not bypassed.</p>
        <p className="mt-3"><Mono>GET /api/v1/executions/:id</Mono> returns an indexed <Mono>AgentAction</Mono>. A reverted firewall call is absent.</p>
      </Section>

      <Section id="proofs" title="Proofs">
        <p><Mono>GET /api/v1/proofs/:executionId</Mono> and <Mono>POST /api/v1/proofs/:executionId/verify</Mono> use the receipt verifier. Verify does not accept a transaction hash. Status stays one of <Mono>executed</Mono>, <Mono>requested</Mono>, <Mono>receipt_verified</Mono>, <Mono>unverifiable</Mono>, or <Mono>temporary_error</Mono>.</p>
        <p className="mt-3"><Mono>proofs.waitForVerification</Mono> polls with backoff for at most 120 seconds.</p>
      </Section>

      <Section id="outcomes" title="Outcomes">
        <p>Supported expectation: <Mono>EVENT_EMITTED</Mono> with <Mono>eventSignature</Mono>, for example <Mono>Deposited(uint256,uint256)</Mono>. The event name alone is rejected. Conditions accept greater-than, less-than, and equality comparisons. Demo Protocol also accepts <Mono>VALUE_CHANGED</Mono>, <Mono>BALANCE_CHANGED</Mono>, and <Mono>STATE_CHANGED</Mono> for <Mono>deposits</Mono> or <Mono>swapped</Mono> when <Mono>expectedValue</Mono> is the exact onchain value. Other sources are not verified.</p>
        <p className="mt-3">The verdict is read from the execution receipt. <Mono>failed</Mono> means a condition was not met. <Mono>unverifiable</Mono> means the receipt or the log could not be judged. Neither is stored as verified.</p>
      </Section>

      <Section id="webhooks" title="Webhooks">
        <p>Create a webhook with <Mono>POST /api/v1/webhooks</Mono>. The signing secret is in that response only. Delivered events: {WEBHOOK_EVENTS.join(", ")}.</p>
        <Code>{`{
  "id": "evt_…",
  "type": "proof.verified",
  "createdAt": "…",
  "data": { "executionId": "…", "agentId": "…", "proofHash": "…" }
}`}</Code>
        <p className="mt-3">Verify <Mono>X-AgentTrace-Signature</Mono> against the raw body.</p>
        <Code>{`const ok = agenttrace.webhooks.verifySignature(rawBody, signature, secret);`}</Code>
      </Section>

      <Section id="sdk" title="SDK">
        <p>Construct <Mono>new AgentTrace(&#123; apiKey, network: "monad-testnet", baseUrl &#125;)</Mono>. <Mono>baseUrl</Mono> is required in Node. Network values other than Monad testnet throw before any request.</p>
        <p className="mt-3">Methods: <Mono>agents.create</Mono>, <Mono>agents.get</Mono>, <Mono>agents.update</Mono>, <Mono>firewalls.create</Mono>, <Mono>firewalls.get</Mono>, <Mono>firewalls.targets.allow</Mono>, <Mono>firewalls.functions.allow</Mono>, <Mono>firewalls.execute</Mono>, <Mono>executions.get</Mono>, <Mono>proofs.get</Mono>, <Mono>proofs.verify</Mono>, <Mono>proofs.waitForVerification</Mono>, <Mono>outcomes.get</Mono>, <Mono>outcomes.verify</Mono>, <Mono>webhooks.verifySignature</Mono>.</p>
      </Section>

      <Section id="api" title="REST API">
        <ul className="space-y-2 font-mono text-xs">
          <li>POST /api/v1/agents</li>
          <li>GET /api/v1/agents/:id</li>
          <li>PATCH /api/v1/agents/:id</li>
          <li>POST /api/v1/firewalls</li>
          <li>GET /api/v1/firewalls/:id</li>
          <li>POST /api/v1/firewalls/:id/execute</li>
          <li>POST /api/v1/firewalls/:id/targets</li>
          <li>POST /api/v1/firewalls/:id/functions</li>
          <li>GET /api/v1/executions/:id</li>
          <li>GET /api/v1/proofs/:executionId</li>
          <li>POST /api/v1/proofs/:executionId/verify</li>
          <li>GET /api/v1/outcomes/:executionId</li>
          <li>POST /api/v1/outcomes/:executionId/verify</li>
          <li>GET /api/v1/webhooks</li>
          <li>POST /api/v1/webhooks</li>
          <li>DELETE /api/v1/webhooks/:id</li>
        </ul>
        <p className="mt-4 text-sm">Errors use <Mono>&#123; "error": &#123; "code", "message" &#125; &#125;</Mono>. Write calls that cannot be confirmed also include <Mono>status: "failed"</Mono> and null ids.</p>
      </Section>

      <Section id="errors" title="Errors">
        <p className="font-mono text-xs leading-6">
          AGENT_NOT_FOUND, UNAUTHORIZED, FIREWALL_NOT_FOUND, FIREWALL_PAUSED, FIREWALL_INACTIVE, TARGET_NOT_ALLOWED, FUNCTION_NOT_ALLOWED, VALUE_LIMIT_EXCEEDED, EXECUTION_FAILED, EXECUTION_NOT_FOUND, PROOF_NOT_FOUND, PROOF_TIMEOUT, OUTCOME_UNSUPPORTED, REGISTRY_NOT_DEPLOYED, FIREWALL_NOT_DEPLOYED, CHAIN_WRITE_UNAVAILABLE, CHAIN_UNAVAILABLE, RATE_LIMITED, INVALID_REQUEST, MAINNET_UNAVAILABLE
        </p>
      </Section>

      <Section id="monad" title="Monad testnet">
        <p>
          Chain id <Mono>{MONAD_TESTNET.chainId}</Mono>. RPC <Mono>{MONAD_TESTNET.rpcUrl}</Mono>. Explorer {MONAD_TESTNET.explorerUrl}. Mainnet is not deployed from this app and is not accepted by the SDK.
        </p>
        <p className="mt-3">Contract addresses come from one configuration record. A null address means that contract is not deployed. These values are not placeholders.</p>
        <ul className="mt-3 space-y-1 font-mono text-xs">
          <li>AgentRegistry {deployment.agentRegistry ?? "Not deployed"}</li>
          <li>AgentFirewall {deployment.agentFirewall ?? "Not deployed"}</li>
          <li>AgentProof {deployment.agentProof ?? "Not deployed"}</li>
          <li>DemoProtocol {deployment.demoProtocol ?? "Not deployed"}</li>
        </ul>
      </Section>

      <Section id="security" title="Security">
        <p>API keys are shown once and stored as a hash. They are not accepted in the query string. Webhook secrets stay on the server. Private keys are not in the client bundle.</p>
        <p className="mt-3">Firewall checks in the API read the indexed policy and refuse the call. They do not replace the contract. The server has no executor key, so a matching policy still returns <Mono>CHAIN_WRITE_UNAVAILABLE</Mono> instead of a fabricated transaction.</p>
        <p className="mt-3">Proof verification recomputes the receipt. It does not accept a caller-supplied proof hash. Outcome status is written only after that receipt check. Reputation has no write API.</p>
      </Section>
    </Shell>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-10 scroll-mt-20 border-t border-border pt-6">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-3 max-w-xl text-sm text-pretty text-muted">{children}</div>
    </section>
  );
}

function Code({ children }: { children: string }) {
  return <pre className="mt-4 overflow-x-auto border border-border p-4 font-mono text-xs text-fg">{children}</pre>;
}
