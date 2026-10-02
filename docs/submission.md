# Submission notes

## Short description

AgentTrace is an onchain identity and provenance layer for AI agents on Monad. It gives agents persistent identities, controlled execution permissions, independently verifiable execution proofs, and protocol-specific outcome verification.

## Longer description

An agent id is created in `AgentRegistry`. What that agent may call is stored in `AgentFirewall`: executor, targets, function selectors, and value limits. Calls go through `execute`. If the target reverts, the firewall reverts with it, and no successful `AgentAction` remains. An indexer stores those events by chain, contract, transaction, block, and log index. A verifier reads the Monad receipt and checks the action against the transaction. The proof hash is a fixed ABI encoding of that evidence. Outcome verification is a second step: it looks for an expected event, such as Demo Protocol `Deposited`, and returns unverifiable when it cannot judge the result. A Google login identifies the AgentTrace account. The passport shows the wallet that owns the agent. The HTTP API confirms receipts and evaluates policy. It does not submit firewall transactions and it does not accept a client-supplied proof as verified.

## What a judge can check

- Landing: the lifecycle, the problem, and why the contracts are on Monad testnet
- `/demo`: the sequence above, or an explicit “not deployed” state with no fake success
- Passport, firewall, proof, and outcome pages, which cite indexed chain data
- `docs/contracts.md` for the proof hash
- `node scripts/test-firewall.mjs` and `node scripts/test-proof.mjs` for local EVM checks

## What is not deployed in this environment

`src/lib/chain/deployment.ts` has null addresses. `MONAD_DEPLOYER_PRIVATE_KEY` and `AGENT_PROOF_VERIFIER_PRIVATE_KEY` are not set. Live testnet registration, execution, and anchoring cannot be completed until those exist. The app refuses the action instead of showing a sample hash.

## Judge questions

**What problem?** Agents act, but identity, permission, execution, and result are easy to blur together.

**Why identity?** So a later proof can name a stable agent id and owner, not an unlabeled wallet.

**Why permissions?** So an allowed function and a blocked function are different onchain facts.

**Why provenance?** So a receipt and an `AgentAction` can be checked without trusting the UI.

**Why separate proof and outcome?** A successful call is not the same as the intended protocol result.

**Why onchain?** The permission check and the event are outside the agent process.

**Why Monad?** The contracts are EVM Solidity, and the testnet is where those transactions and logs are read. No performance number is claimed.
