# AgentTrace

Every agent leaves a trace.

An independent validator and audit trail for onchain agents on Monad.

An agent that holds a wallet can call anything. AgentTrace gives every agent call four separate, checkable facts: which agent acted (identity), what it was allowed to do (an onchain firewall), what actually executed (a receipt-verified proof anchored onchain), and whether the intended result happened (outcome verification). Verdicts are published to the ERC-8004 Validation and Reputation registries, so any wallet, marketplace, or other agent can read them without trusting this app. Live on Monad mainnet and testnet.

**Live app (mainnet, chain 143):** https://agenttrace-mainnet.vercel.app · **Live app (testnet, chain 10143):** https://agenttrace-plum.vercel.app · **Demo video:** [docs/demo.mp4](docs/demo.mp4) (narrated, recorded on the live mainnet app) · **Submission notes:** [docs/submission.md](docs/submission.md)

## Overview

An agent can call a contract. That does not, by itself, say which agent acted, which permissions were in force, whether the call really happened, or whether the intended result occurred.

## Solution

- **Identity.** `AgentRegistry` assigns a persistent agent id. Deactivation does not reuse the id.
- **Firewall.** `AgentFirewall` is the only path for an approved call. The owner sets the executor, targets, function selectors, and value limits.
- **Execution.** The executor calls `execute`. If the target reverts, the whole transaction reverts. A successful `AgentAction` is emitted only after the target call succeeds.
- **Proof.** An off-chain verifier reads the Monad transaction and receipt. It marks an execution verified only when every critical check matches. It does not trust the browser.
- **ERC-8004.** An AgentTrace agent can be linked to an ERC-8004 identity owned by the same wallet. Each anchored proof becomes a `validationResponse` in the ERC-8004 Validation Registry, and each outcome verdict becomes `giveFeedback` in the Reputation Registry, both posted by the AgentTrace verifier wallet.
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

## Why Monad

AgentTrace writes to the chain on every step: register, firewall policy, execute, anchor, and the ERC-8004 posts. That only works if those writes are cheap and final quickly. Measured on Monad (gas from real receipts; Monad charges the gas limit, and the price seen on 5 October 2026 was 102 gwei: 100 base fee plus 2 priority):

| Step | Gas | MON at 102 gwei |
| --- | --- | --- |
| `AgentRegistry.registerAgent` | 242,728 | ≈0.025 |
| `AgentFirewall.createFirewall` | 245,633 | ≈0.025 |
| Allow target / allow function | 121,600 / 111,686 | ≈0.012 / 0.011 |
| `AgentFirewall.execute` (Demo deposit) | 154,784 | ≈0.016 |
| `AgentProof.anchorProof` | 179,045 | ≈0.018 |
| ERC-8004 `register` + metadata | 291,834 (estimate) | ≈0.030 |
| ERC-8004 `validationRequest` | 276,048 | ≈0.028 |

Deploying all four contracts on mainnet cost 0.352 MON in total. Anchoring every verified execution costs about 0.018 MON each.

Per the [Monad docs](https://docs.monad.xyz/developer-essentials/summary), blocks are produced every 300 ms and are final after two blocks (about 600 ms), and the per-transaction gas limit is 30M. So a proof can be anchored and read back within seconds, and the verifier does not have to wait out reorgs. Monad is EVM-compatible, so the contracts are ordinary Solidity 0.8.31 and the app uses viem.

### RPC and indexing

The indexer and proof verifier read logs and receipts from public Monad RPCs: on testnet `https://testnet-rpc.monad.xyz`, falling back to `https://rpc-testnet.monadinfra.com` and `https://rpc.ankr.com/monad_testnet`; on mainnet `https://rpc.monad.xyz`, falling back to `https://rpc-mainnet.monadinfra.com`. Setting `MONAD_TESTNET_RPC_URL` replaces the list with that one endpoint. Permissions are enforced in `AgentFirewall`, not in the client.

Public Monad RPCs limit `eth_getLogs` to 100 blocks per call (see [RPC limits](https://docs.monad.xyz/reference/rpc-limits)). The indexer scans in 100-block windows, a few windows at a time, and saves its cursor after each window. One sync call stops after a short time budget (4 s by default, `MONAD_INDEXER_BUDGET_MS`) and the next request continues from the saved block, so a page never waits on a long catch-up. Registrations, firewall changes, and executions submitted through the app are also confirmed directly from their transaction receipts, so they appear right away even while the history scan is behind.

### Network selection

One codebase serves both networks. `VITE_MONAD_NETWORK=mainnet` selects Monad mainnet (chain 143, `src/lib/chain/deployment-mainnet.ts`); anything else selects testnet (chain 10143, `src/lib/chain/deployment.ts`). The two hosted apps are two Vercel projects built from the same `main` branch.

## Features

Implemented in this repository:

- Agent registration, update, and deactivation flows against `AgentRegistry`
- Firewall creation, executor, targets, functions, value policy, pause, unpause, and deactivation
- Execution through `AgentFirewall.execute`, with revert of the whole transaction if the target reverts
- Receipt-based proof verification and deterministic proof hashing
- Monad mainnet and testnet from one codebase (`VITE_MONAD_NETWORK`)
- ERC-8004 integration: link an agent to an ERC-8004 identity, publish proof verdicts to the Validation Registry and outcome verdicts to the Reputation Registry, and serve an ERC-8004 registration file at `/api/erc8004/agents/<agentId>`
- Owner-only firewall controls: management forms appear only for the connected owner or executor wallet
- An MCP server that gives any MCP host firewall-guarded onchain tools, with a recorded mainnet session
- Envio HyperSync log indexing (optional, `ENVIO_API_TOKEN`)
- `traceCall` in the SDK: one function that routes an agent's call through the firewall and returns its AgentTrace proof
- Onchain proof anchoring in `AgentProof`: after a proof is receipt-verified, the server verifier commits its proof hash onchain (live on the hosted app)
- Outcome verification for an expected event, and for Demo Protocol `deposits` or `swapped` when the onchain value matches
- Indexed agent directory, passport, activity, proofs, and outcomes
- Developer API, hashed API keys, rate limits, and HMAC-signed webhooks
- TypeScript SDK in `sdk/`
- Wallet signing in the browser only when a chain action is submitted
- Google account sign-in for the AgentTrace account, kept separate from the onchain owner, or a wallet-only mode with no accounts

Not implemented:

- A server-side executor that submits firewall transactions for the API
- Upgradeable contracts
- A claim that agents are safe or trustless

## Tech stack

- React 19, TanStack Start, Tailwind CSS
- Solidity 0.8.31, viem, EthereumJS VM for contract tests
- Postgres when `DATABASE_URL` is set, otherwise PGLite
- Optional Vercel Blob cache of indexed chain logs for serverless hosting
- Better Auth for the application account (optional; wallet-only mode turns it off)

## Smart contracts

| Contract | Purpose | Address (Monad testnet, 10143) | Deploy block | Deploy tx |
| --- | --- | --- | --- | --- |
| AgentRegistry | Persistent agent identity | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://testnet.monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 67788394 | [`0x3426bbc9…`](https://testnet.monadvision.com/tx/0x3426bbc9643ea6f04e278d109645d036aa85a9e3d485cd9f6cc3bbd98fc2dfff) |
| AgentFirewall | Permissions and execution | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://testnet.monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 67788397 | [`0x9346cf54…`](https://testnet.monadvision.com/tx/0x9346cf54288f0cd0683e0c92a1e0ce50727d84409eb51a2a2bcb072a6f282044) |
| AgentProof | Immutable proof-hash anchors | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://testnet.monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 67788400 | [`0x4e017247…`](https://testnet.monadvision.com/tx/0x4e0172478ce7dde026c13d6c020cd5788e4ba64a9cf42d38554c02643b2d95b4) |
| DemoProtocol | Deposit, swap, and withdraw demo target | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://testnet.monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 67788404 | [`0xd9f5fad6…`](https://testnet.monadvision.com/tx/0xd9f5fad6e0043f9980e084643ea60dc47c6572139072de9f6ded64c20f38bdae) |

### Monad mainnet (chain 143)

| Contract | Address (Monad mainnet, 143) | Deploy block | Deploy tx |
| --- | --- | --- | --- |
| AgentRegistry | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 110869327 | [`0x65bf8edd…`](https://monadvision.com/tx/0x65bf8edd7aefa5805afae5984e94f6f0e65315a9fc9f152b3e25900d4a395255) |
| AgentFirewall | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 110869330 | [`0xd1c07b28…`](https://monadvision.com/tx/0xd1c07b28ad4c7e937bc2d5f78124cb14cefe4ac3c0f22ffea3f131c9663e308f) |
| AgentProof | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 110869333 | [`0xa347bfa7…`](https://monadvision.com/tx/0xa347bfa7657e54d7457c52b0503eed3209df39e10def8fe3798646bd89a47619) |
| DemoProtocol | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 110869336 | [`0x3e13bee3…`](https://monadvision.com/tx/0x3e13bee34bd16a9701c6372d6338245f593b411f52e9e0fd2b63a2e25ce38b37) |

Deployed on 5 October 2026 by the same deployer with `npm run deploy:mainnet -- --confirm-mainnet`. The addresses match testnet because the deployer's nonces 0–3 were the same on both chains. The AgentProof verifier (`0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85`) was set in the constructor; `AgentProof.verifier()` returns it.

### Testnet (chain 10143)

Deployed on 3 October 2026 by `0x4f3f999B60750cEf97D7D56c75f30F050A583D53` with `npm run deploy:testnet`. `AgentFirewall.agentRegistry()` returns the registry above. The AgentProof verifier is a dedicated server wallet, [`0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85`](https://testnet.monadvision.com/address/0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85), set by the owner with `setVerifier` ([`0x9f239ab5…`](https://testnet.monadvision.com/tx/0x9f239ab50f69b909d7ff07d3ba4cedb6e92a81cf092f439acda90b03dd573208)). The hosted app holds its key as a sensitive server environment variable and anchors each verified proof hash, for example agent #006 ([`0x577824ab…`](https://testnet.monadvision.com/tx/0x577824ab9bef8a84f9b2b0063d8bd580986e456d10a7837861483f9bc26737c4)). Addresses stay null until a confirmed transaction exists. Environment variables may override the record. See [docs/contracts.md](docs/contracts.md).

## Deploying the contracts

One command deploys all four contracts in order (registry, firewall with the registry address, proof anchor, demo protocol) and writes every confirmed address, block, and transaction hash to `src/lib/chain/deployment.ts`:

```bash
MONAD_DEPLOYER_PRIVATE_KEY=0x... npm run deploy:testnet
git add src/lib/chain/deployment.ts && git commit -m "Record Monad testnet deployment"
```

- The deployer needs testnet MON from [faucet.monad.xyz](https://faucet.monad.xyz). The four deployments use about 3.1M gas; at the 102 gwei testnet gas price seen on 2 Oct 2026 that is about 0.4 MON with the script's 20% margin. The script checks the balance first and sends nothing if it is too low.
- It refuses any chain other than 10143.
- A contract already in the record (with bytecode on chain) is skipped, so a failed run can be re-run.
- The AgentProof verifier is the address of `AGENT_PROOF_VERIFIER_PRIVATE_KEY` when set, else `AGENT_PROOF_VERIFIER_ADDRESS`, else the deployer. The owner can change it later with `setVerifier`.
- The private key is read from the environment only. Do not commit it or put it in a hosted app's environment.

Mainnet uses the same script and writes `src/lib/chain/deployment-mainnet.ts`. It refuses to run without the explicit flag:

```bash
MONAD_DEPLOYER_PRIVATE_KEY=0x... npm run deploy:mainnet -- --confirm-mainnet
```

Committing the record means every build uses the addresses without extra environment variables.

## ERC-8004

[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) defines three registries for trustless agents: Identity, Reputation, and Validation. AgentTrace acts as an independent validator. The registries used are the canonical deployments (all have code on both chains):

| Registry | Monad mainnet (143) | Monad testnet (10143) |
| --- | --- | --- |
| Identity | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` |
| Reputation | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` |
| Validation | `0x8004Cc8439f36fd5F9F049D9fF86523Df6dAAB58` | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` |

How it works:

1. **Link.** On the agent passport, the owner registers an ERC-8004 identity with the agent's registration file (`/api/erc8004/agents/<agentId>`) and the metadata key `agenttrace` = `abi.encode(chainId, AgentRegistry, agentId)`. AgentTrace accepts the link only if the ERC-8004 identity has the same owner as the AgentTrace agent and that metadata matches.
2. **Request.** On an anchored proof, the agent owner sends `validationRequest(validator = AgentTrace verifier, agentId, requestURI = proof page, requestHash = proof hash)`.
3. **Respond.** The verifier wallet answers with `validationResponse(requestHash, 100, …, responseHash = proof hash, tag = "agenttrace-execution")`. It only answers for a proof it has receipt-verified and anchored in `AgentProof`.
4. **Reputation.** The verifier posts `giveFeedback(agentId, 100 if the outcome verified else 0, tag1 = "agenttrace-outcome", tag2 = executionId)`. The execution id in `tag2` keeps one feedback per execution.

Live examples:

| | Mainnet | Testnet |
| --- | --- | --- |
| AgentTrace agent → ERC-8004 id | #001 → [#10280](https://agenttrace-mainnet.vercel.app/agents/1) | #006 → [#2014](https://agenttrace-plum.vercel.app/agents/6) |
| Identity register tx | [`0x799ae99e…`](https://monadvision.com/tx/0x799ae99ee300791602c895e9655af0b74cb76a49d8ce49cae5c0d4caa1ce8bb5) | [`0x8b0326ac…`](https://testnet.monadvision.com/tx/0x8b0326ac059ad00b1ebbd57ad761cea3e5c99ec1f84d5653a7b754101bcd0ee2) |
| `validationRequest` (owner) | [`0xa0003774…`](https://monadvision.com/tx/0xa000377418f2a13d3e1f87a06c11dcd1a8f666987e713e01f62338fa9000abb3) | [`0x0b8de463…`](https://testnet.monadvision.com/tx/0x0b8de46375aa61be9a710bc7efca4966c33528d6a828d7cdd8c00101314619fa) |
| `validationResponse` 100 (verifier) | [`0xd727a688…`](https://monadvision.com/tx/0xd727a688ae93a2078ee9a0e9e39d31bb2c35ed4de8364640a731abd9524d4231) | [`0x0d1b6583…`](https://testnet.monadvision.com/tx/0x0d1b6583d6294e098d091a86b0994a0bab284420d7c55d0e1665e68dbda391fa) |
| `giveFeedback` 100 (verifier) | [`0x3c05024a…`](https://monadvision.com/tx/0x3c05024ac5e0f78972734ee68cce1a4bb7126b375d3500a4e6be405f4a81aef6) | [`0xaa0fb56f…`](https://testnet.monadvision.com/tx/0xaa0fb56fdaa77e09c267b60fc171cafd0ac4045145be059d688c22bd99c31d20) |

Read back onchain: `getValidationStatus(proofHash)` returns the verifier, response 100, and the proof hash as `responseHash`. On mainnet the proof hash is `0xad2bca96c12f0a14e7a0377dacc7a7bbfa58e47be0401935c35beba2ab27103d`. `getSummary(agentId, [verifier], "", "")` on the Reputation Registry returns count 1, value 100 on both chains.

## SDK: one call for any agent

An existing agent does not need to adopt the API. Give its executor key to `traceCall` with the call it was going to make:

```ts
import { traceCall } from "@agenttrace/sdk";

const r = await traceCall({ network: "monad-testnet", signer: process.env.AGENT_KEY, firewallId: 4, target, data });
// r.executionId, r.txHash, r.proofStatus ("receipt_verified"), r.proofHash, r.proofUrl
```

It simulates `AgentFirewall.execute` first, so a call the firewall would block throws `FIREWALL_REJECTED` and sends nothing. Then it sends the transaction, reads `AgentAction` from the receipt, and asks AgentTrace to verify the proof. The verdict comes from AgentTrace's own receipt checks, not from the SDK. Runnable example: [`sdk/examples/trace-call.ts`](sdk/examples/trace-call.ts). A run on testnet on 5 October 2026 (firewall #004, agent #006) sent [`0xfa6772c0…`](https://testnet.monadvision.com/tx/0xfa6772c0ed15a0dc571b3795dcf23a9ba913d7548aae83a77d4dd0043cbceb0b) and returned `proofStatus: "receipt_verified"` for execution [`0x05eb59f6…`](https://agenttrace-plum.vercel.app/proofs/0x05eb59f6cf91d1ce47ece012c044e0df3f8a4205a1c33a962f7089d0c11fa030). See [docs/sdk.md](docs/sdk.md).

## Third-party agent over MCP (mainnet)

[`agents/mcp-firewall/server.ts`](agents/mcp-firewall/server.ts) is a Model Context Protocol server (stdio, no dependencies beyond viem). Any MCP host (Claude Desktop, Cursor, an Eliza or AgentKit runtime) that loads it gets four tools, `agenttrace_policy`, `demo_deposit`, `demo_withdraw`, and `call_contract`, and every write goes through `traceCall`, so the host's model cannot step outside the firewall.

```json
{ "mcpServers": { "agenttrace": {
  "command": "npx", "args": ["tsx", "agents/mcp-firewall/server.ts"],
  "env": { "NETWORK": "monad-mainnet", "AGENT_ID": "2", "FIREWALL_ID": "2", "AGENT_KEY": "<executor key>" }
} } }
```

Live setup on Monad mainnet: **Treasury Agent #002**, owned by the deployer, with a separate executor key `0x2551C85252e06989E044Bcb6603135f9dBd11778` (owner and executor are different wallets, as for a real agent). Its firewall #002 allows only `DemoProtocol.deposit` and no value transfers.

| Step | Transaction |
| --- | --- |
| Register agent #002 | [`0x2018ec14…`](https://monadvision.com/tx/0x2018ec140c67d39c46649fcac4231db3b63377f30240de4f8a0c0e3e693218bc) |
| Create firewall #002 (executor = agent key) | [`0x876f56a8…`](https://monadvision.com/tx/0x876f56a85c60ecaeec224ccaa6d5569e2bc729eae56e7ff8f7274352cbd8a74f) |
| Allow DemoProtocol / allow `deposit` | [`0xdf612a60…`](https://monadvision.com/tx/0xdf612a6060687a4d2a54c94c84e5010efe36be7b0d21de4407da68f9d9c3ee41), [`0xbf0a8495…`](https://monadvision.com/tx/0xbf0a849502448bb2f5191cdb18acfd74e7200a86d5daffb05c7636831fff89b6) |

A scripted MCP session ([`run-session.ts`](agents/mcp-firewall/run-session.ts), transcript in [docs/agent-runs/mcp-mainnet.md](docs/agent-runs/mcp-mainnet.md)) drives the server the way an LLM host would: `initialize`, `tools/list`, then

1. `agenttrace_policy`: reads firewall #002 (one target, one function, value transfers off).
2. `demo_deposit {amount: 25}`: allowed. Execution [`0x53e92644…`](https://monadvision.com/tx/0x53e92644141f38e31bf3c67a09941a386ca9476fcdf0a1b80c65755c0ad5ff76) came back `receipt_verified` from AgentTrace and was anchored by the verifier in [`0x6d3fda85…`](https://monadvision.com/tx/0x6d3fda85231be2a7f58798157f7e07dc67167b16cd69061825023ea95bb4bfc1). The tool call took 2.1 s end to end in that run. [Proof page](https://agenttrace-mainnet.vercel.app/proofs/0x8361810c1d8b7f3f932a1b8e005dc0cd9d84980432319f540276fde7216ab798).
3. `demo_withdraw {amount: 25}`: rejected in simulation with `FunctionNotAllowed(2, DemoProtocol, 0x441a3e70)`. Nothing was sent.

```bash
AGENT_KEY=0x... AGENT_ID=2 FIREWALL_ID=2 NETWORK=monad-mainnet npm run agent:session
```

## Indexing with Envio HyperSync

When `ENVIO_API_TOKEN` is set (server-only; both hosted apps have it), the indexer reads AgentTrace contract logs from [Envio HyperSync](https://docs.envio.dev/docs/HyperSync/overview) (`monad.hypersync.xyz` for chain 143, `monad-testnet.hypersync.xyz` for 10143) instead of 100-block `eth_getLogs` windows. One HyperSync query returned the full mainnet AgentFirewall history in under half a second in a test from this box. HyperSync can trail the RPC head by a few blocks, so the RPC scanner covers the remainder, and it takes over entirely if HyperSync fails. Proof verification still reads each transaction and receipt from Monad RPC: HyperSync only finds the logs.

The passport's ERC-8004 history (validation responses and outcome feedback posted by the AgentTrace verifier) is also read from HyperSync with topic filters on the agent id, two requests instead of a registry log scan. Code: [`src/lib/chain/hypersync.server.ts`](src/lib/chain/hypersync.server.ts).

A token is free: sign in at [envio.dev/app/api-tokens](https://envio.dev/app/api-tokens) and create one under the Free package. Without it, everything works over public RPC, just slower on a cold start.

## Integrations considered

- **Dynamic (wallet onboarding).** Not added. It needs a Dynamic dashboard account to get an environment id (`VITE_DYNAMIC_ENVIRONMENT_ID`); none was created for this project. The app uses the injected browser wallet (EIP-1193) today.
- **Envio (indexing).** Added: HyperSync is the log source when `ENVIO_API_TOKEN` is set (see above). A full HyperIndex deployment (Postgres + GraphQL) was not needed for this data volume.
- **MetaMask Agent Wallet.** Not added. Its launch networks do not include Monad.

## Local development

Requires Node.js 22.12 or newer (TanStack Start). `.nvmrc` pins 22.

```bash
npm install
npm run dev
```

The dev server listens on port 8080.

## Hosting on Vercel

The app builds with the Nitro `vercel` preset (`npm run build` writes `.vercel/output`). The hosted deployment runs in **wallet-only mode**:

- `VITE_AUTH_ENABLED=false`. There are no application accounts and no sign-in. Identity is the connected wallet: agents and firewalls belong to whoever owns them onchain, and every chain action is signed by that wallet. The `/firewalls/new` page lists agents the connected wallet owns onchain. Account settings, API keys, and webhooks are hidden, because they need a persistent account database.
- No `DATABASE_URL`. Each serverless instance uses its own in-memory PGLite database. Do not set `DATABASE_URL` with auth off: the server refuses that combination on purpose, so account data is never shared under a fallback identity.
- Chain data is the source of truth. Every instance rebuilds its view from Monad logs. To avoid rescanning from the deploy block on every cold start, set `BLOB_READ_WRITE_TOKEN` (connect a private Vercel Blob store to the project). The indexer then keeps the raw logs it has seen and the last scanned block in one private blob (`agenttrace/chain-cache-10143.json`, keyed by contract address and deploy block) and replays them into a fresh instance. The cache holds only public chain data. Without the token, the indexer still works and simply scans from the deploy block.
- Outcome checks are kept in the same blob as requests only (execution id and expectation); a fresh instance re-runs them against Monad. Verdicts are never copied.
- A transaction submitted through the app is confirmed from its own receipt. If that request lands on a different instance than the one that recorded the intent, the browser resubmits the intent from the transaction hash, so the confirmation does not depend on which instance answers.
- Node.js 22.x.

```bash
vercel link --scope <team>
vercel env add VITE_AUTH_ENABLED production   # value: false
vercel blob create-store agenttrace-chain-cache --access private   # optional cache
vercel deploy --prod
```

With the GitHub repository connected to the Vercel project, every push to `main` redeploys. Contract addresses come from the committed `src/lib/chain/deployment.ts`, so no address variables are needed once the deployment is recorded.

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
npm test                # app unit tests, auth tests, indexer log-window tests
npm run test:contracts  # registry, firewall, proof, demo, developer, reputation in a local EVM
npm run test:workspace  # Grok App Builder workspace template tests (see note)
```

`npm test` runs the app unit and auth tests and checks that the indexer never asks the RPC for more than 100 blocks, applies logs in order, and resumes from its saved cursor. `npm run test:contracts` loads the contracts in a local EVM and checks registry, firewall, proof, demo, developer, and reputation behavior; the registry test also checks that a public Monad testnet endpoint answers with chain id 10143. These do not replace a live Monad testnet deployment.

`npm run test:workspace` runs the Grok App Builder template tests that came with the project scaffold. Some of them read workspace files that are not in this repository (`.grok/`, `AGENTS.md`) or expect the untouched template, so they fail in a fresh clone. They do not test AgentTrace behavior.

### End-to-end check on a local Monad testnet fork

This runs the real contracts, indexer, and proof verifier against a fork of Monad testnet without spending testnet MON. It needs [Foundry](https://book.getfoundry.sh/) for `anvil` and `cast`.

```bash
anvil --fork-url https://rpc-testnet.monadinfra.com --chain-id 10143 --port 8545
# anvil's public dev key #0 is pre-funded on the fork only
MONAD_DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  MONAD_DEPLOY_RPC_URL=http://127.0.0.1:8545 npm run deploy:testnet
MONAD_TESTNET_RPC_URL=http://127.0.0.1:8545 npm run dev
```

Then register an agent, create a firewall, allow `DemoProtocol.deposit`, and call `execute` from the executor (with `cast send`, or a wallet pointed at `http://127.0.0.1:8545`). `/agents`, `/firewalls/1`, `/proofs`, and `POST /api/proofs/<executionId>/verify` then show the indexed agent, the execution, and a `receipt_verified` proof. Restore `src/lib/chain/deployment.ts` afterwards (`git checkout src/lib/chain/deployment.ts`) so fork addresses are never committed.

## Demo

`/demo` walks through identity, firewall, an allowed deposit, proof verification, outcome verification, and a blocked withdraw. It uses the contracts of the network the app was built for (testnet or mainnet) and the connected wallet. If those contracts are not deployed, the page says so and does not invent a result. If the RPC cannot be reached, it says the testnet connection is unavailable and offers retry.

Video: [docs/demo.mp4](docs/demo.mp4), narrated with captions, recorded on the live mainnet app over real executions (agent #001, firewall #001, the Treasury Agent MCP session). It is generated from [docs/demo-voiceover.md](docs/demo-voiceover.md) by `node scripts/make-demo-video.mjs` (Playwright recording, free edge-tts narration, ffmpeg). Walkthrough script for a live wallet run: [docs/demo-script.md](docs/demo-script.md).


Mainnet run on https://agenttrace-mainnet.vercel.app (5 October 2026, real MON): agent [#001](https://agenttrace-mainnet.vercel.app/agents/1) registered ([`0x70fdce44…`](https://monadvision.com/tx/0x70fdce4416844014bc6db40a3150408e1b657dbfb21973acad1efa5c6e661ee2)), firewall [#001](https://agenttrace-mainnet.vercel.app/firewalls/1) created ([`0xfa86ca30…`](https://monadvision.com/tx/0xfa86ca3014e624b4e0edf7c895599234cdf66b4995bd6e3b5725b7ae6790c6de)), DemoProtocol target and `deposit` allowed ([`0x35b10373…`](https://monadvision.com/tx/0x35b103730dc7878b8b79789da1b290316346eb943348f462e975215ca0728eb3), [`0xf5d78baa…`](https://monadvision.com/tx/0xf5d78baad1a35ca9c1e598f733620f2329562304e8682ac27a7a05208df0caf2)), deposit executed ([`0x7db78e77…`](https://monadvision.com/tx/0x7db78e779216bc5d55dd1a957871122ed0d23357e0c5acda7ddbe6401fc4c0c8)), proof [receipt-verified](https://agenttrace-mainnet.vercel.app/proofs/0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e) and anchored ([`0x2151d023…`](https://monadvision.com/tx/0x2151d023a27cc9f1f1aecda0b8dc74ed44e7e9b5936a7b18c5ca2b1127feff08)), outcome `Deposited 100` verified, withdraw blocked by the firewall in simulation (no transaction sent).

## Screenshots

From the live mainnet app (https://agenttrace-mainnet.vercel.app), captured with `node scripts/readme-screenshots.mjs`.

| | |
| --- | --- |
| ![Landing](docs/screenshots/01-landing.png) | ![Agent passport](docs/screenshots/02-agent-passport.png) |
| Landing | Agent #001 passport: lifecycle, ERC-8004 public reputation with HyperSync history |
| ![Execution proof](docs/screenshots/03-execution-proof.png) | ![Firewall](docs/screenshots/04-firewall.png) |
| Execution proof: evidence, 14 receipt checks, anchor, ERC-8004 publication | Firewall #001: readable policy and execution history |
| ![MCP agent proof](docs/screenshots/05-mcp-agent-proof.png) | ![Outcome](docs/screenshots/06-outcome.png) |
| Treasury Agent #002's deposit from the MCP session, verified and anchored | Outcome check in plain language |

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

- Let a configured executor submit `execute` from the API without weakening firewall checks

## Documentation

- [Architecture](docs/architecture.md)
- [Contracts](docs/contracts.md)
- [API](docs/api.md)
- [SDK](docs/sdk.md)
- [Demo script](docs/demo-script.md)
- [Demo voiceover](docs/demo-voiceover.md)
- [Submission notes](docs/submission.md)

## License

MIT. See [LICENSE](LICENSE). The SDK uses the same license.
