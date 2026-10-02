# API

Base path: `/api/v1`.

Authentication: `Authorization: Bearer <api key>`. Keys are not accepted as a query parameter. Anonymous callers may use the read routes below, subject to 60 requests per minute per IP. A key allows 300 requests per minute. Over the limit the API returns `429` and `RATE_LIMITED`.

Errors:

```json
{ "error": { "code": "INVALID_REQUEST", "message": "The request body must be JSON." } }
```

Bodies larger than 20,000 characters are rejected. The API does not submit firewall or registry transactions. A confirmed write requires a transaction hash that already exists on Monad testnet. Otherwise `transactionHash` is null.

## POST /api/v1/agents

Auth required.

Request: `name`, `description`, `capabilities`, optional `metadataURI`, optional `transactionHash`.

Response when the registry is not deployed (`409`):

```json
{
  "agentId": null,
  "transactionHash": null,
  "status": "failed",
  "error": { "code": "REGISTRY_NOT_DEPLOYED", "message": "The registry contract is not deployed. No transaction was sent and no agent id was assigned." }
}
```

Without `transactionHash` the code is `CHAIN_WRITE_UNAVAILABLE`. A receipt that is not ready yet returns `202` and `status: "pending"`. `confirmed` is returned only after `AgentRegistered` is read from that transaction.

## GET /api/v1/agents/:id

Auth optional. `404 AGENT_NOT_FOUND` when the id is not indexed.

Response fields from the indexer: `agentId`, `name`, `description`, `capabilities`, `owner`, `active`, `metadataURI`, `registeredAt`, `network`, `chainId`.

## PATCH /api/v1/agents/:id

Auth required. Does not send an update transaction. Returns `409` and `CHAIN_WRITE_UNAVAILABLE` with `transactionHash: null`.

## POST /api/v1/firewalls

Auth required. Same confirmation rule as agent creation, against the firewall contract. Undeployed firewall: `FIREWALL_NOT_DEPLOYED`.

## GET /api/v1/firewalls/:id

Auth optional. Indexed firewall, or `404 FIREWALL_NOT_FOUND`.

## POST /api/v1/firewalls/:id/targets

## POST /api/v1/firewalls/:id/functions

Auth required. These validate the address or selector and then refuse to send an owner transaction: `CHAIN_WRITE_UNAVAILABLE`, `transactionHash: null`. The indexed policy is not changed.

## POST /api/v1/firewalls/:id/execute

Auth required.

Request: `target`, `value`, `data`.

The server checks the indexed firewall. A policy miss returns `403` with a code such as `TARGET_NOT_ALLOWED`, `FUNCTION_NOT_ALLOWED`, `VALUE_LIMIT_EXCEEDED`, `FIREWALL_PAUSED`, or `FIREWALL_INACTIVE`. A policy match still does not send a transaction: `409 CHAIN_WRITE_UNAVAILABLE`, `executionId: null`, `transactionHash: null`.

Execution in the product is the wallet call to `AgentFirewall.execute`.

## GET /api/v1/executions/:id

Auth optional. Execution id is a 32-byte hex value. `404 EXECUTION_NOT_FOUND` when it is not indexed.

## GET /api/v1/proofs/:executionId

Auth optional.

## POST /api/v1/proofs/:executionId/verify

Auth required. Runs the receipt verifier. It does not accept a proof object from the client as evidence. Status is `receipt_verified` only when every check passes. Otherwise it is not verified.

## GET /api/v1/outcomes/:executionId

Auth optional. Lists outcome rows already stored for an indexed execution.

## POST /api/v1/outcomes/:executionId/verify

Auth required.

Request:

```json
{
  "expectation": {
    "type": "EVENT_EMITTED",
    "event": "Deposited",
    "eventSignature": "Deposited(uint256,uint256)",
    "conditions": { "amount": { "operator": "==", "value": "100" } }
  }
}
```

Only `EVENT_EMITTED` is accepted for arbitrary contracts. The signature must match the event name. If the log is not in the receipt, the outcome is not verified.

Demo Protocol also accepts `VALUE_CHANGED`, `BALANCE_CHANGED`, and `STATE_CHANGED` when `source` is `DemoProtocol`, `field` is `deposits` or `swapped`, and `expectedValue` is the decimal value to compare with the contract. The verifier reads the receipt and `deposits` or `swapped`. It is verified only when this transaction emitted a Demo Protocol event for that agent and the current value equals `expectedValue`. Any other source is `OUTCOME_UNSUPPORTED` and is not stored as verified. A missing Demo Protocol deployment does not invent a balance.

The same outcome routes exist at `/api/outcomes/:executionId`, `/evidence`, `/verify`, and `/anchor`. `POST /anchor` does not send a transaction. Outcomes are not anchored onchain. Proof anchoring stays on `POST /api/proofs/:executionId/anchor`.

## Public indexed reads

These read the indexer. They do not accept a client-supplied owner or status as truth.

- `GET /api/agents`
- `GET /api/agents/:id`
- `GET /api/agents/owner/:address`
- `GET /api/agents/search?q=`
- `GET /api/agents/:id/events`
- `GET /api/agents/:id/activity`
- `GET /api/agents/:id/proofs`
- `GET /api/agents/:id/outcomes`
- `GET /api/agents/:id/reputation`
- `GET /api/firewalls/:id`
- `GET /api/firewalls/:id/policy`
- `GET /api/firewalls/:id/targets`
- `GET /api/firewalls/:id/functions`
- `GET /api/firewalls/:id/executions`
- `GET /api/proofs/:executionId`
- `GET /api/proofs/:executionId/verification`
- `POST /api/proofs/:executionId/verify`
- `POST /api/proofs/:executionId/anchor` — signs in with the application session. Anchored is true only after the anchor transaction is confirmed.

## GET /api/v1/webhooks

## POST /api/v1/webhooks

## DELETE /api/v1/webhooks/:id

Auth required. Create accepts `url` and `events`. The signing secret is returned once. Later reads do not include it.

Events:

- `execution.executed`
- `proof.verified`
- `proof.unverifiable`
- `outcome.verified`
- `outcome.failed`
- `outcome.unverifiable`

Deliveries send `X-AgentTrace-Signature: sha256=<hex>`, HMAC-SHA256 over the raw body. Verify with the SDK `webhooks.verifySignature`. Delivery handlers should treat the event id as idempotent.
