# AgentTrace

Every agent leaves a trace.

An onchain identity and provenance layer for AI agents on Monad.

AI agents need more than wallets. They need identity, controlled permissions, execution provenance, and verifiable outcomes. AgentTrace provides those primitives on Monad testnet.

## Overview

An agent can call a contract. That does not, by itself, say which agent acted, which permissions were in force, whether the call really happened, or whether the intended result occurred.

## Solution

- **Identity.** `AgentRegistry` assigns a persistent agent id. Deactivation does not reuse the id.
- **Firewall.** `AgentFirewall` is the only path for an approved call. The owner sets the executor, targets, function selectors, and value limits.
- **Execution.** The executor calls `execute`. If the target reverts, the whole transaction reverts. A successful `AgentAction` is emitted only after the target call succeeds.
- **Proof.** An off-chain verifier reads the Monad transaction and receipt. It marks an execution verified only when every critical check matches. It does not trust the browser.
- **Outcome.** A separate check looks for the expected protocol event, or a Demo Protocol balance that this transaction actually changed. A verified execution is not a verified outcome. An unsupported protocol is `unverifiable`, not verified.

## Architecture

```text
Agent
  → AgentRegistry          identity
  → AgentFirewall          permissions and execute()
  → Target contract        the actual call
  → AgentAction event      onchain trace
  → Indexer                chain events into the database
  → Proof verifier         receipt checks and proof hash
  → Outcome verifier       expected event, or unverifiable
```

See [docs/architecture.md](docs/architecture.md) and [docs/security.md](docs/security.md).

## Monad

Monad testnet (chain id 10143) is EVM-compatible. AgentTrace contracts are ordinary Solidity 0.8.31 contracts. The indexer and proof verifier read logs and receipts from the public testnet RPC (`https://testnet-rpc.monad.xyz`). Permissions are enforced in `AgentFirewall`, not in the client.

No throughput or gas figure is claimed here. The deployment record in this repository does not contain contract addresses until a confirmed deployment is written, or until the addresses are set in the environment.

## Features

Implemented in this repository:

- Agent registration, update, and deactivation flows against `AgentRegistry`
- Firewall creation, executor, targets, functions, value policy, pause, unpause, and deactivation
- Execution through `AgentFirewall.execute`, with revert of the whole transaction if the target reverts
- Receipt-based proof verification and deterministic proof hashing
- Optional onchain proof anchoring in `AgentProof` when a verifier key is configured
- Outcome verification for an expected event, and for Demo Protocol `deposits` or `swapped` when the onchain value matches
- Indexed agent directory, passport, activity, proofs, and outcomes
- Developer API, hashed API keys, rate limits, and HMAC-signed webhooks
- TypeScript SDK in `sdk/`
- Wallet signing in the browser only when a chain action is submitted
- Google account sign-in for the AgentTrace account, kept separate from the onchain owner

Not implemented:

- Monad mainnet
- A server-side executor that submits firewall transactions for the API
- Upgradeable contracts
- A claim that agents are safe or trustless

## Tech stack

- React 19, TanStack Start, Tailwind CSS
- Solidity 0.8.31, viem, EthereumJS VM for contract tests
- Postgres when `DATABASE_URL` is set, otherwise PGLite
- Better Auth for the application account

## Smart contracts

| Contract | Purpose | Network | Address |
| --- | --- | --- | --- |
| AgentRegistry | Persistent agent identity | Monad testnet (10143) | Not deployed in this record |
| AgentFirewall | Permissions and execution | Monad testnet (10143) | Not deployed in this record |
| AgentProof | Immutable proof-hash anchors | Monad testnet (10143) | Not deployed in this record |
| DemoProtocol | Deposit, swap, and withdraw demo target | Monad testnet (10143) | Not deployed in this record |

Addresses stay null until a confirmed transaction exists. Environment variables may override the record. See [docs/contracts.md](docs/contracts.md).

## Local development

```bash
npm install
npm run dev
```

The dev server listens on port 8080.

## Environment variables

Copy [.env.example](.env.example). Do not commit filled secrets.

Public chain constants live in `src/lib/chain/network.ts`. Server-only values, including any verifier key, stay in the server environment.

## Running the application

```bash
npm run dev
npm run typecheck
npm run build
```

## Testing

```bash
npm test
node scripts/test-registry.mjs
node scripts/test-firewall.mjs
node scripts/test-proof.mjs
node scripts/test-demo.mjs
node scripts/test-developer.mjs
node scripts/test-reputation.mjs
```

`npm test` runs script unit tests and auth tests. The `node scripts/test-*.mjs` commands compile or load the contracts in a local EVM and check registry, firewall, proof, demo, developer, and reputation behavior. They do not replace a live Monad testnet deployment.

## Demo

`/demo` walks through identity, firewall, an allowed deposit, proof verification, outcome verification, and a blocked withdraw. It uses the configured Monad testnet contracts and the connected wallet. If those contracts are not deployed, the page says so and does not invent a result. If the RPC cannot be reached, it says the testnet connection is unavailable and offers retry.

Script: [docs/demo-script.md](docs/demo-script.md).

## Security

- The firewall owner authorizes the executor, targets, selectors, and value limits.
- `execute` checks agent activity, firewall activity, pause, executor, target, selector, calldata length, and value policy before the call.
- State written before the external call is rolled back if the target reverts, including nonce and spend.
- The proof verifier recomputes checks from the transaction, receipt, and `AgentAction` log. Any failed critical check yields `unverifiable` and no proof hash.
- Proof hash bytes are `abi.encode` of a fixed field list. See [docs/contracts.md](docs/contracts.md).
- API keys are stored as SHA-256 hashes. The full secret is returned once.
- Webhook bodies are HMAC-SHA256, header `X-AgentTrace-Signature: sha256=<hex>`.
- The API does not accept an API key in the query string and does not send a firewall transaction on the caller’s behalf.

## Roadmap

- Deploy the four contracts to Monad testnet and record the confirmed addresses
- Configure the proof-anchor verifier
- Let a configured executor submit `execute` from the API without weakening firewall checks

## Documentation

- [Architecture](docs/architecture.md)
- [Contracts](docs/contracts.md)
- [API](docs/api.md)
- [SDK](docs/sdk.md)
- [Demo script](docs/demo-script.md)
- [Submission notes](docs/submission.md)

## License

MIT. See [LICENSE](LICENSE). The SDK uses the same license.
