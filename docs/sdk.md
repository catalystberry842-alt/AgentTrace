# SDK

Package: `@agenttrace/sdk` in `sdk/`. It is not published to npm. Network values other than `monad-testnet` throw `MAINNET_UNAVAILABLE` before any request.

```ts
import { AgentTrace } from "@agenttrace/sdk";

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
