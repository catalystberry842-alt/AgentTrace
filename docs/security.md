# Security

AgentTrace treats the Solidity firewall as the permission boundary. The website, the API, and the database do not grant an execution that the contract would reject.

## Identity

Google sign-in identifies the human AgentTrace account. It is not the agent owner. The owner is the address that called `AgentRegistry.registerAgent`, read back from the chain. Browsing does not require a wallet. A wallet is used only when a transaction must be signed.

## Contracts

- Solidity 0.8.31. No proxy, no `delegatecall`, no `tx.origin`.
- Custom errors. No hidden administrator that can execute through the firewall.
- Agent ids start at 1 and are not reused.
- Firewall configuration checks the current registry owner. Execution checks the configured executor, not the owner and not the browser.
- Targets and function selectors are default-deny. Selectors are `bytes4`, not function-name strings.
- Value transfers stay off until the owner sets a policy. `msg.value` must equal the declared value. Per-transaction and per-period limits are enforced in the contract.
- Pause and deactivation are checked inside `execute`. A paused or inactive firewall cannot be bypassed by the API.
- The execution nonce is incremented before the external call so a reentrant `execute` cannot reuse the same execution id. If the target reverts, the transaction reverts, so the nonce and the spent amount do not persist, and `AgentAction` is not emitted.
- Re-entering `execute` from the target can succeed only if that target is the executor. The contract does not impersonate the executor.
- `AgentProof` anchors are append-only. The same execution id or proof hash cannot be anchored twice. Only the configured verifier can anchor.
- Demo Protocol does not custody MON and has no administrator. It is labeled as a demo.

## Proofs

The verifier reads the Monad receipt itself. A caller cannot submit a proof object and have it accepted as evidence.

A proof is `receipt_verified` only when the transaction exists, the receipt succeeded, the transaction called the configured firewall, and the `AgentAction` log matches the agent, firewall, executor, target, selector, execution id, transaction hash, block, value, and calldata hash.

The proof hash is `keccak256` of the ABI encoding documented in [contracts.md](contracts.md), including the chain id (143 on mainnet, 10143 on testnet). Verification status is not inside the hash. Status is the conclusion. The same evidence must keep the same hash.

`temporary_error` means the RPC could not be read yet. It is not `unverifiable` and it is not verified. `anchored` is true only after the anchor transaction is confirmed. A hash that does not match the recomputed evidence is not anchored. If the verifier key or the proof contract is missing, no anchor transaction is sent.

## Outcomes

Execution proof and outcome verification are separate. An event check is verified only when that event is in the execution receipt and every condition matches. Demo Protocol balance, value, and state checks are verified only when this transaction emitted a Demo Protocol event for that agent and the onchain `deposits` or `swapped` value equals the expected value. Other shapes are rejected or stored as `unverifiable`. They are never stored as verified to fill a gap.

`POST /api/outcomes/:executionId/anchor` does not send a transaction. Outcomes are not an onchain anchor.

## API, keys, and webhooks

- API keys are SHA-256 hashed. The full key is shown once. Keys in the query string are rejected.
- Bearer authentication is required for API writes. The server does not trust a client-supplied user id, owner, wallet, agent id, execution id, or proof status.
- Anonymous reads are limited to 60 requests per minute per IP. A key allows 300. Over the limit the API returns 429.
- The API does not hold an executor key and does not submit `AgentFirewall.execute`. A policy match still returns `CHAIN_WRITE_UNAVAILABLE` with a null execution id.
- Agent creation is confirmed only from an `AgentRegistered` log in a real receipt. Otherwise the agent id stays null.
- Webhook bodies are HMAC-SHA256. The header is `X-AgentTrace-Signature: sha256=<hex>`. The signing secret is stored so the server can sign and is not returned on later reads. Consumers should treat the event id as idempotent.

## Data and secrets

The database is derived state. Unique keys include chain id + transaction hash + log index, and execution id. Reprocessing a log does not create a second execution.

`MONAD_DEPLOYER_PRIVATE_KEY` and `AGENT_PROOF_VERIFIER_PRIVATE_KEY` are server-only. They are not `VITE_` variables. `.env.example` lists names only. Do not commit a filled `.env`.

`MONAD_TESTNET_RPC_URL` may override the public RPC on the server. It must be an `https` URL. The chain id stays 10143.

## Known limits

- If the deployer key is unset, the contracts are not deployed. The product says so. It does not invent addresses, transaction hashes, proof statuses, or outcomes.
- The indexer can lag a confirmed transaction. The demo says indexing has not finished. It does not show a fake `AgentAction`.
- A malicious executor can still submit any call the owner allowed. The contract enforces the allow-list. It does not decide whether the allowed call was a good idea.
- Demo Protocol state checks compare the current mapping with the expected value after seeing an event in this transaction. They do not reconstruct an earlier balance that was not in the receipt.
