# SDK

Package: `agenttrace-monad` in `sdk/` (`cd sdk && npm pack` builds `dist/` and a tarball). It is not yet published to npm. `viem` (2.40 or newer) is a peer dependency.

## `traceCall`: one line for an existing agent

```ts
import { traceCall } from "agenttrace-monad";

const result = await traceCall({
  network: "monad-testnet",          // or "monad-mainnet" (real MON)
  signer: process.env.AGENT_KEY,     // the firewall's executor: hex key or viem Account
  firewallId: 4,
  target: "0x1664be58ee54af91c756428f466bad6e4f9911c3",
  data,                              // calldata the agent was going to send
});
```

1. Simulates `AgentFirewall.execute(firewallId, target, value, data)`. If the firewall would revert, it throws `FIREWALL_REJECTED` and sends nothing. An RPC failure throws `RPC_UNAVAILABLE`, also without sending.
2. Sends the transaction and waits for the receipt. A reverted receipt throws `EXECUTION_REVERTED`.
3. Reads `AgentAction` from the receipt for the execution id.
4. Calls `POST /api/proofs/<executionId>/verify` on the AgentTrace app with the transaction hash as a hint, so the server reads that receipt itself even if its indexer is behind. It repeats until a verdict or the timeout (60 s by default).

5. If the proof is `receipt_verified` and `anchor` is not false, asks the AgentTrace verifier to anchor the proof hash in `AgentProof`.

Returns `{ txHash, executionId, agentId, proofStatus, proofHash, anchorTxHash, proofUrl, explorerUrl }`. A firewall rejection names the contract's custom error, for example `FunctionNotAllowed(2, 0x1664…, 0x441a3e70)`. `proofStatus` is the server's verdict (`receipt_verified` or `unverifiable`), or null if no verdict arrived in time. The SDK never marks a proof verified itself.

Example: [`sdk/examples/trace-call.ts`](../sdk/examples/trace-call.ts). A run on testnet on 5 October 2026 (firewall #004, agent #006) sent [`0xfa6772c0…`](https://testnet.monadvision.com/tx/0xfa6772c0ed15a0dc571b3795dcf23a9ba913d7548aae83a77d4dd0043cbceb0b) and returned `proofStatus: "receipt_verified"` for execution [`0x05eb59f6…`](https://agenttrace-plum.vercel.app/proofs/0x05eb59f6cf91d1ce47ece012c044e0df3f8a4205a1c33a962f7089d0c11fa030).

```bash
AGENT_KEY=0x... FIREWALL_ID=4 AGENT_ID=6 npx tsx sdk/examples/trace-call.ts
```

### Off-chain amount limits

```ts
import { toFunctionSelector } from "viem";
await traceCall({ ...input, limits: [{ selector: toFunctionSelector("deposit(uint256,uint256)"), argIndex: 1, maxAmount: 500n }] });
```

`argIndex` is the 0-based index of a static `uint256` argument after the selector. A call above `maxAmount` (or with calldata too short to contain the argument) throws `POLICY_REJECTED` before simulation; nothing is sent. Optional `target` scopes a rule to one contract. This runs in the agent's process. The onchain equivalent is `AgentFirewallV2.setArgCap` (testnet, see the README section "Amount limits").

## API client

The `AgentTrace` class wraps the developer API. It accepts only `network: "monad-testnet"`; other values throw `MAINNET_UNAVAILABLE` before any request, because the developer API (API keys, webhooks) needs the account database, which the hosted mainnet app does not run.

```ts
import { AgentTrace } from "agenttrace-monad";

const client = new AgentTrace({
  apiKey: process.env.AGENTTRACE_API_KEY!,
  network: "monad-testnet",
  baseUrl: process.env.AGENTTRACE_BASE_URL!,
});
```

The key is sent as a bearer token. A key that contains `?` is rejected so it is not placed in a URL.

## Methods that exist

| Method | Behavior |
| --- | --- |
| `agents.create` | `POST /api/v1/agents` |
| `agents.get` | `GET /api/v1/agents/:id` |
| `agents.update` | `PATCH /api/v1/agents/:id` |
| `firewalls.create` | `POST /api/v1/firewalls` |
| `firewalls.get` | `GET /api/v1/firewalls/:id` |
| `firewalls.targets.allow` | `POST /api/v1/firewalls/:id/targets` |
| `firewalls.functions.allow` | `POST /api/v1/firewalls/:id/functions` |
| `firewalls.execute` | `POST /api/v1/firewalls/:id/execute` |
| `executions.get` | `GET /api/v1/executions/:id` |
| `proofs.get` | `GET /api/v1/proofs/:executionId` |
| `proofs.verify` | `POST /api/v1/proofs/:executionId/verify` |
| `proofs.waitForVerification` | Polls verify, then get. Stops at the timeout. Default 30s, maximum 120s. Does not mark a proof verified itself. |
| `outcomes.get` | `GET /api/v1/outcomes/:executionId` |
| `outcomes.verify` | `POST /api/v1/outcomes/:executionId/verify` |
| `webhooks.verifySignature` | Local HMAC check. No request. |

`agents.create` confirms an agent only when the body includes a real `transactionHash` and the receipt contains `AgentRegistered`. Until the registry is deployed, the call returns `failed` with a null agent id and a null transaction hash.

`firewalls.execute` checks indexed policy and then returns `CHAIN_WRITE_UNAVAILABLE` with a null execution id. It does not bypass the firewall and it does not send a transaction. Onchain execution is a wallet call to `AgentFirewall.execute`.

```ts
client.webhooks.verifySignature(rawBody, signatureHeader, secret);
```

The header value is `sha256=<hex>`.

## MCP server

`agents/mcp-firewall/server.ts` wraps `traceCall` as a Model Context Protocol server (stdio, JSON-RPC 2.0), so any MCP host gets firewall-guarded tools: `agenttrace_policy`, `demo_deposit`, `demo_withdraw`, `call_contract`. Env: `AGENT_KEY` (the firewall executor), `FIREWALL_ID`, `AGENT_ID`, `NETWORK` (`monad-testnet` default, or `monad-mainnet`), optional `AGENTTRACE_URL`.

```bash
npm run agent:mcp                       # start the server on stdio
AGENT_KEY=0x... AGENT_ID=2 FIREWALL_ID=2 NETWORK=monad-mainnet npm run agent:session   # scripted session
```

Optional `AGENT_LIMITS`: a JSON array of off-chain amount caps, checked before anything is simulated or sent (selector as hex or as a signature):

```json
[{ "selector": "deposit(uint256,uint256)", "argIndex": 1, "maxAmount": "500" }]
```

A call above a cap returns `{"allowed": false, "code": "POLICY_REJECTED", "sent": false}`. `agenttrace_policy` lists the caps under `offchainAmountLimits`.

Recorded mainnet session: [agent-runs/mcp-mainnet.md](agent-runs/mcp-mainnet.md). See the README section "MCP firewall server".

## One-click MCP config

Prerequisite: `git clone https://github.com/catalystberry842-alt/AgentTrace && cd AgentTrace && npm ci`. Put the executor key in your environment, never in a committed file.

**Cursor.** The repository ships [`.cursor/mcp.json`](../.cursor/mcp.json); opening the folder in Cursor registers the server. It uses Cursor's `${workspaceFolder}` and `${env:…}` interpolation:

```json
{
  "mcpServers": {
    "agenttrace": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "tsx", "${workspaceFolder}/agents/mcp-firewall/server.ts"],
      "env": {
        "NETWORK": "monad-mainnet",
        "AGENT_ID": "2",
        "FIREWALL_ID": "2",
        "AGENT_KEY": "${env:AGENTTRACE_AGENT_KEY}",
        "AGENT_LIMITS": "[{\"selector\":\"deposit(uint256,uint256)\",\"argIndex\":1,\"maxAmount\":\"500\"}]"
      }
    }
  }
}
```

For your own agent, change `AGENT_ID`, `FIREWALL_ID`, and `NETWORK`; copy the block into `~/.cursor/mcp.json` to use it outside this folder (replace `${workspaceFolder}` with the absolute path).

**Claude Desktop.** Settings → Developer → Edit Config opens `claude_desktop_config.json` (macOS `~/Library/Application Support/Claude/`, Windows `%APPDATA%\Claude\`). Claude Desktop does not expand variables, so use an absolute path:

```json
{
  "mcpServers": {
    "agenttrace": {
      "command": "npx",
      "args": ["-y", "tsx", "/absolute/path/to/AgentTrace/agents/mcp-firewall/server.ts"],
      "env": {
        "NETWORK": "monad-mainnet",
        "AGENT_ID": "2",
        "FIREWALL_ID": "2",
        "AGENT_KEY": "0x<executor key>",
        "AGENT_LIMITS": "[{\"selector\":\"deposit(uint256,uint256)\",\"argIndex\":1,\"maxAmount\":\"500\"}]"
      }
    }
  }
}
```

Restart the host. Ask "what is my AgentTrace policy?" to call `agenttrace_policy`. Without `AGENT_KEY` the server still reads policy and refuses every write.
