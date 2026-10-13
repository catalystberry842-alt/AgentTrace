import { createFileRoute, Link } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { CodeBlock, Mono } from "@/components/ui";
import { IS_MAINNET } from "@/lib/chain/network";

export const Route = createFileRoute("/developers/sdk")({ component: SdkPage });

const NETWORK = IS_MAINNET ? "monad-mainnet" : "monad-testnet";
const REPO = "https://github.com/catalystberry842-alt/AgentTrace";

const TRACE = `import { encodeFunctionData, parseAbi } from "viem";
import { traceCall } from "agenttrace-monad";

const result = await traceCall({
  network: "${NETWORK}",
  signer: process.env.AGENT_KEY,   // the firewall's executor: hex key or viem Account
  firewallId: 2,
  target: "0x1664be58ee54af91c756428f466bad6e4f9911c3",
  data: encodeFunctionData({
    abi: parseAbi(["function deposit(uint256 agentId, uint256 amount)"]),
    functionName: "deposit",
    args: [2n, 25n],
  }),
});
// { txHash, executionId, agentId, proofStatus, proofHash, anchorTxHash, proofUrl, explorerUrl }`;

const MCP = `{ "mcpServers": { "agenttrace": {
  "command": "npx",
  "args": ["-y", "tsx", "/absolute/path/to/AgentTrace/agents/mcp-firewall/server.ts"],
  "env": {
    "NETWORK": "${NETWORK}", "AGENT_ID": "2", "FIREWALL_ID": "2",
    "AGENT_KEY": "<executor key>"
  }
} } }`;

const TOOLS = [
  ["agenttrace_policy", "Reads the agent's firewall: targets, functions, value limits"],
  ["demo_deposit", "DemoProtocol.deposit through the firewall; returns the verified proof"],
  ["demo_withdraw", "DemoProtocol.withdraw through the firewall"],
  ["call_contract", "Any target + calldata; rejected unless the firewall allows target and selector"],
] as const;

function SdkPage() {
  return (
    <Shell wide>
      <p className="type-caption text-faint">Developers</p>
      <h1 className="type-heading mt-2 md:text-3xl">SDK &amp; MCP</h1>
      <p className="mt-3 max-w-2xl text-sm text-muted">
        <Mono>agenttrace-monad</Mono> is the TypeScript package in <Mono>sdk/</Mono> of the repository (published on npm as <Mono>agenttrace-monad@0.1.0</Mono>). Supported networks: <Mono>monad-mainnet</Mono> and <Mono>monad-testnet</Mono>.
      </p>
      <DeveloperNav current="/developers/sdk" />

      <div className="mt-8 grid gap-10 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="text-sm font-medium">traceCall</h2>
          <p className="mt-2 text-sm text-muted">
            Simulates <Mono>AgentFirewall.execute</Mono> (an off-policy call throws <Mono>FIREWALL_REJECTED</Mono> with the contract's error and nothing is sent), sends the transaction, reads <Mono>AgentAction</Mono> from the receipt, then asks AgentTrace to verify and anchor the proof.
          </p>
          <CodeBlock language="ts" code={TRACE} />
          <p className="mt-4 text-sm text-muted">
            Also exported: the typed <Mono>AgentTrace</Mono> client for the HTTP API (<Link to="/developers/api" className="text-fg hover:underline">endpoints</Link>).
          </p>
        </section>
        <section className="min-w-0">
          <h2 className="text-sm font-medium">MCP firewall server</h2>
          <p className="mt-2 text-sm text-muted">
            <Mono>agents/mcp-firewall/server.ts</Mono> is a stdio MCP server. Every write goes through <Mono>traceCall</Mono>, so the host model cannot leave the onchain policy. Without <Mono>AGENT_KEY</Mono> it still answers <Mono>agenttrace_policy</Mono> and refuses to sign.
          </p>
          <CodeBlock language="json" code={MCP} />
          <dl className="mt-6 divide-y divide-border rounded-lg border border-border">
            {TOOLS.map(([name, text]) => (
              <div key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4">
                <dt className="font-mono text-xs text-fg">{name}</dt>
                <dd className="text-sm text-muted">{text}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
      <p className="mt-10 text-sm text-muted">
        Full reference:{" "}
        <a className="text-fg hover:underline" href={`${REPO}/blob/main/docs/sdk.md`} target="_blank" rel="noreferrer">
          docs/sdk.md ↗
        </a>
      </p>
    </Shell>
  );
}
