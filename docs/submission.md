# Submission notes

## Short description

AgentTrace is an onchain identity and provenance layer for AI agents on Monad. It gives agents persistent identities, controlled execution permissions, independently verifiable execution proofs, and protocol-specific outcome verification.

## Longer description

An agent id is created in `AgentRegistry`. What that agent may call is stored in `AgentFirewall`: executor, targets, function selectors, and value limits. Calls go through `execute`. If the target reverts, the firewall reverts with it, and no successful `AgentAction` remains. An indexer stores those events by chain, contract, transaction, block, and log index. A verifier reads the Monad receipt and checks the action against the transaction. The proof hash is a fixed ABI encoding of that evidence. Outcome verification is a second step: it looks for an expected event, such as Demo Protocol `Deposited`, and returns unverifiable when it cannot judge the result. On the hosted app there is no separate account: the connected wallet is the identity. (With auth enabled, a Google login identifies an AgentTrace account.) The passport shows the wallet that owns the agent. The HTTP API confirms receipts and evaluates policy. It does not submit firewall transactions and it does not accept a client-supplied proof as verified.

## What a judge can check

- Landing: the lifecycle, the problem, and why the contracts are on Monad testnet
- `/demo`: the sequence above, or an explicit “not deployed” state with no fake success
- Passport, firewall, proof, and outcome pages, which cite indexed chain data
- `docs/contracts.md` for the proof hash
- `node scripts/test-firewall.mjs` and `node scripts/test-proof.mjs` for local EVM checks

## Deployment

Live app: https://agenttrace-plum.vercel.app (Vercel, wallet-only mode: no application accounts; the connected wallet is the identity and signs every chain action).

Contracts on Monad testnet (chain id 10143), deployed 3 October 2026:

| Contract | Purpose | Address (Monad testnet, 10143) | Deploy block | Deploy tx |
| --- | --- | --- | --- | --- |
| AgentRegistry | Persistent agent identity | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://testnet.monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 67788394 | [`0x3426bbc9…`](https://testnet.monadvision.com/tx/0x3426bbc9643ea6f04e278d109645d036aa85a9e3d485cd9f6cc3bbd98fc2dfff) |
| AgentFirewall | Permissions and execution | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://testnet.monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 67788397 | [`0x9346cf54…`](https://testnet.monadvision.com/tx/0x9346cf54288f0cd0683e0c92a1e0ce50727d84409eb51a2a2bcb072a6f282044) |
| AgentProof | Immutable proof-hash anchors | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://testnet.monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 67788400 | [`0x4e017247…`](https://testnet.monadvision.com/tx/0x4e0172478ce7dde026c13d6c020cd5788e4ba64a9cf42d38554c02643b2d95b4) |
| DemoProtocol | Deposit, swap, and withdraw demo target | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://testnet.monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 67788404 | [`0xd9f5fad6…`](https://testnet.monadvision.com/tx/0xd9f5fad6e0043f9980e084643ea60dc47c6572139072de9f6ded64c20f38bdae) |

`AGENT_PROOF_VERIFIER_PRIVATE_KEY` is not set on the hosted app, so proofs are verified from receipts and stored with their proof hash, but not anchored onchain in `AgentProof`.

## Judge questions

**What problem?** Agents act, but identity, permission, execution, and result are easy to blur together.

**Why identity?** So a later proof can name a stable agent id and owner, not an unlabeled wallet.

**Why permissions?** So an allowed function and a blocked function are different onchain facts.

**Why provenance?** So a receipt and an `AgentAction` can be checked without trusting the UI.

**Why separate proof and outcome?** A successful call is not the same as the intended protocol result.

**Why onchain?** The permission check and the event are outside the agent process.

**Why Monad?** The contracts are EVM Solidity, and the testnet is where those transactions and logs are read. No performance number is claimed.
