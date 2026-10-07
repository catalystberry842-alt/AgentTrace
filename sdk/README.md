# agenttrace-monad

TypeScript SDK for [AgentTrace](https://agenttrace-mainnet.vercel.app) on Monad. Route an AI agent's contract call through the onchain `AgentFirewall`, then get a receipt-verified proof whose hash AgentTrace anchors in `AgentProof`.

- `traceCall` works on Monad mainnet (chain 143) and testnet (chain 10143).
- Off-chain `limits` (max amount per selector) are checked before anything is simulated or sent.
- `AgentTrace`, the typed developer API client, is Monad testnet only.

Status: packaged and `npm pack` tested, **not yet published to npm**. Until it is, build it from this repository (below).

## Install

```bash
# after publishing
npm install agenttrace-monad viem

# from this repository today
cd sdk && npm pack            # builds dist/ and writes agenttrace-monad-0.1.0.tgz
npm install /path/to/AgentTrace/sdk/agenttrace-monad-0.1.0.tgz viem
```

`viem` 2.40 or newer is a peer dependency. ESM only, Node 18+.

## `traceCall`

```ts
import { traceCall } from "agenttrace-monad";
import { encodeFunctionData, parseAbi, toFunctionSelector } from "viem";

const abi = parseAbi(["function deposit(uint256 agentId, uint256 amount)"]);
const result = await traceCall({
  network: "monad-mainnet",
  signer: process.env.AGENT_KEY as `0x${string}`, // the firewall's executor
  firewallId: 1n,
  target: "0x1664be58ee54af91c756428f466bad6e4f9911c3",
  data: encodeFunctionData({ abi, functionName: "deposit", args: [1n, 100n] }),
  // optional: refuse locally if argument 1 (amount) is above 500
  limits: [{ selector: toFunctionSelector("deposit(uint256,uint256)"), argIndex: 1, maxAmount: 500n }],
});
console.log(result.proofStatus, result.proofUrl, result.anchorTxHash);
```

Errors are `AgentTraceError` with a `code`:

| Code | Meaning | Sent? |
| --- | --- | --- |
| `POLICY_REJECTED` | An off-chain `limits` rule was broken | No |
| `FIREWALL_REJECTED` | Simulation shows `AgentFirewall` would revert (target, selector, pause, value) | No |
| `RPC_UNAVAILABLE` | Could not simulate | No |
| `EXECUTION_REVERTED` | Mined but reverted | Yes |

What is enforced where: target and selector allowlists, pause, executor and native MON value limits are enforced **onchain** by `AgentFirewall`. `limits` (argument caps such as a token amount) run in the agent's process: they stop a confused or prompt-injected model, not someone who holds the executor key and skips the SDK. `contracts/AgentFirewallV2.sol` implements the same rule onchain (`setArgCap`); see the repository docs for its status.

## API client quickstart

1. Create an API key in the developer portal. The full key is shown once.
2. Pass it as `Authorization: Bearer`, never in a query string.
3. Call the API. Chain writes stay `failed` with a null transaction hash until a real Monad receipt confirms them.

```ts
import { AgentTrace } from "agenttrace-monad";

const agenttrace = new AgentTrace({
  apiKey: process.env.AGENTTRACE_API_KEY!,
  network: "monad-testnet",
  baseUrl: process.env.AGENTTRACE_BASE_URL!,
});

const agent = await agenttrace.agents.create({
  name: "Research Agent",
  description: "AI research agent",
  capabilities: ["Research", "Data"],
});
```

`agent.status` is `submitted`, `pending`, `confirmed`, or `failed`. `confirmed` is returned only after an `AgentRegistered` receipt is indexed. There is no method that executes around the firewall.

## Methods

| Method | API |
| --- | --- |
| `agents.create` / `get` / `update` | `POST /api/v1/agents`, `GET` and `PATCH /api/v1/agents/:id` |
| `firewalls.create` / `get` | `POST /api/v1/firewalls`, `GET /api/v1/firewalls/:id` |
| `firewalls.targets.allow` | `POST /api/v1/firewalls/:id/targets` |
| `firewalls.functions.allow` | `POST /api/v1/firewalls/:id/functions` |
| `firewalls.execute` | `POST /api/v1/firewalls/:id/execute` |
| `executions.get` | `GET /api/v1/executions/:id` |
| `proofs.get` / `verify` / `waitForVerification` | `GET` and `POST /api/v1/proofs/:executionId` |
| `outcomes.get` / `verify` | `GET` and `POST /api/v1/outcomes/:executionId` |
| `webhooks.verifySignature` | Local HMAC check. No network call. |

`waitForVerification` polls with backoff and stops at the timeout (default 30s, max 120s). It does not report `receipt_verified` unless the API does.

## Webhooks

```ts
agenttrace.webhooks.verifySignature(rawBody, signatureHeader, secret);
```

The header is `X-AgentTrace-Signature: sha256=<hex>` over the raw body.

## Network

`traceCall`: Monad mainnet and testnet. `AgentTrace` API client: Monad testnet only (RPC `https://testnet-rpc.monad.xyz`); other networks throw before any request.

## License

MIT. See `LICENSE`.
