# @agenttrace/sdk

TypeScript client for AgentTrace on Monad testnet (chain id 10143).

This package is not published. Use it from this repository.

## Install

The SDK ships as TypeScript source in `sdk/`. Import `@agenttrace/sdk` only after you point a package dependency at this folder. Nothing is published automatically.

## Quickstart

1. Create an API key in the developer portal. The full key is shown once.
2. Pass it as `Authorization: Bearer`, never in a query string.
3. Call the API. Chain writes stay `failed` with a null transaction hash until a real Monad receipt confirms them.

```ts
import { AgentTrace } from "@agenttrace/sdk";

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

Monad testnet only. RPC `https://testnet-rpc.monad.xyz`. Mainnet is not implemented.

## License

MIT. See `LICENSE`.
