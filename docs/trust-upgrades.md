# Trust upgrades: verifier quorum, per-agent custody, one-click setup

Three pieces of reviewer feedback, and what changed for each. Everything here is in the repository
and tested in a local EVM (`npm run test:contracts`). The V3 contracts are **not deployed yet**:
deploying them is one command (`npm run deploy:v3:testnet`, then mainnet), listed at the end. The
one-click demo works today against the deployed V1 contracts.

## 1. "Single verifier wallet": AgentProofQuorum and disputes

**Before.** One AgentTrace-run wallet (`0x77a5…0D85`) decided which proof hashes were anchored and
what went to ERC-8004. Anyone could recompute a proof hash, but there was no onchain way to say
"this verdict is wrong", and no second party had to agree.

**Now.** [`contracts/AgentProofQuorum.sol`](../contracts/AgentProofQuorum.sol) replaces the single
`verifier` with an owner-managed set and a threshold (for example 2 of 3).

| Step | What happens onchain |
| --- | --- |
| Attest | Each verifier recomputes the proof hash from the Monad receipt on its own and calls `attest` (or `anchorProof`, same call, so the existing server works unchanged). |
| Anchor | When `threshold` verifiers attested the **same** hash, `ExecutionProofAnchored` is emitted, same event signature as `AgentProof`, so indexers and `verify-proof.mjs` read it unchanged. |
| Conflict | If two verifiers attest **different** hashes (or agent/firewall/tx ids), the execution becomes `Disputed`: `ProofConflict` is emitted and it can never be anchored by this contract. Nobody's hash wins by being first. |
| Challenge | **Anyone** can call `challenge(executionId, claimedProofHash, evidenceURI)`. It does not flip the verdict by itself; it is a public onchain flag (`ProofChallenged`, counter in `getExecution`) that readers and ERC-8004 consumers see next to the anchor. |
| Withdraw | A verifier that re-checks and agrees with a challenge calls `withdrawAttestation`. If an anchored proof drops below the threshold it becomes `Revoked` (`ProofRevoked`). History is never edited; every step is an event. |
| Governance | The owner (intended: a multisig) adds/removes verifiers and sets the threshold; the contract refuses a threshold above the verifier count. |

**The second verifier.** [`scripts/second-verifier.mjs`](../scripts/second-verifier.mjs) is a
verifier that shares no code path, database or key with the hosted server: it reads the receipt over
public RPC, rebuilds the hash with `scripts/verify-proof.mjs`, and only then attests with its own key
(`SECOND_VERIFIER_PRIVATE_KEY`). `--watch` follows new `AgentAction` logs; `--dry-run` never sends.
Run it on a different machine by a different operator and no single party decides a verdict.

**How a dispute plays out**, concretely:

1. A watcher runs `node scripts/verify-proof.mjs <executionId>` and gets `FAIL` (for example the
   calldata hash does not match the `execute` input).
2. They call `challenge(executionId, theirHash, "ipfs://…output")`. The proof page and any reader of
   `getExecution` now show a challenge.
3. Each verifier re-runs the same deterministic check. The honest ones withdraw; the anchor is
   `Revoked` once it falls below threshold.
4. ERC-8004: each verifier answers `validationRequest`s with its own `validationResponse`, so a
   consumer can require, say, 2 of 3 validators at 100. A verifier that withdrew posts a new
   `validationResponse` with 0 for the same request hash.

Not done yet: staking or slashing for verifiers, and bonds for challengers. The contract keeps the
hooks simple on purpose (counters and events) so either can be layered on.

Server support: point `AGENT_PROOF_ADDRESS` at the quorum contract. The anchor call is unchanged; when
the server's attestation is not the last one needed it now reports
`Attested by this verifier (1 of 2)…` instead of an error.

## 2. "Shared custody in the firewall": AgentFirewallV3 + AgentVault + session keys

**Before.** `execute` called the target directly, so `msg.sender` at every protocol was the single
`AgentFirewall` contract. Tokens a protocol paid "to the caller" sat in that shared contract, and any
firewall allowing `transfer` on that token could move them. WMON Agent #003 worked around it by
returning WMON right away.

**Now.** [`contracts/AgentFirewallV3.sol`](../contracts/AgentFirewallV3.sol):

- **Per-agent vault.** `createFirewall` deploys an [`AgentVault`](../contracts/AgentVault.sol) with
  CREATE2 (salt = firewall id; `predictVault` gives the address up front). `execute` calls the target
  **through the vault**, so the protocol sees the vault as `msg.sender` and pays it. One agent, one
  balance. The vault has two entry points only: `forward` (firewall only, after every policy check)
  and `ownerCall` (the agent's *current* registry owner, read live, to withdraw or rescue). The
  vault and the firewall itself can never be allowed as targets.
- **Session keys.** An executor can carry an expiry (`setSessionExecutor(id, key, validUntil)`, or
  `executorValidUntil` at setup). After it, `execute` reverts with `ExecutorExpired`. The owner's
  wallet configures; a short-lived, scoped key acts. `setExecutor` installs a permanent executor
  and clears the expiry.
- **One-transaction setup.** `createFirewallWithPermissions(agentId, executor, validUntil, policy…,
  [{target, name, selectors[]}])` creates the firewall and vault, sets the session executor, allows
  every target and function, and forwards `msg.value` to the executor as a gas stipend.
- Unchanged: `AgentAction` and the execution id are byte-identical to V1, and V2's argument caps are
  included. The full V1 firewall test suite runs against V3 and passes
  (`FIREWALL_VARIANT=V3 node scripts/test-firewall.mjs`), plus [`scripts/test-v3.mjs`](../scripts/test-v3.mjs):
  tokens land in the vault and not in the firewall, only the owner can `ownerCall`, a second agent
  cannot touch the first agent's vault, expiry and renewal, and one-call setup with stipend.

**EIP-7702 / smart accounts.** The vault is the minimal, chain-agnostic version of "the agent has its
own account". The same policy can also be enforced from the other side: an agent EOA delegates (EIP-7702)
to a small module that calls `AgentFirewall.execute`-style checks before acting, with session keys as
the module's signers. That keeps assets in the agent's own address and works with wallets that already
batch through 7702. The one-click demo below already uses this shape from the wallet side: when the
wallet supports EIP-5792, a 7702/smart account sends the whole setup as one atomic batch.

## 3. "The strongest value is the outcome verdict and ERC-8004 publishing"

Agreed, and the pitch now leads with it. The receipt is already onchain; re-anchoring its hash proves
little on its own. What nobody else provides is:

1. **The outcome verdict**: did the call achieve what it was meant to (a `Deposited` event with amount
   100, a WMON `Deposit` of 0.01 MON), separate from "the transaction succeeded". Unsupported checks are
   `unverifiable`, never "verified".
2. **Publishing it where everyone reads**: ERC-8004 `validationResponse` (execution checked, 100) and
   `giveFeedback` (outcome, 100 or 0) on the canonical Monad registries, readable by any wallet,
   marketplace or agent without trusting AgentTrace.

The anchor stays, demoted to what it is: a commitment that pins which receipt fields the verdict was
about, so a verdict cannot later be re-pointed at a different execution, and the hook the quorum
contract hangs disputes on.

## 4. One connection, one confirmation: the one-click demo

**Before.** `/demo` needed five wallet confirmations, each behind its own button: register, create
firewall, allow target, allow function, execute.

**Now.** `/demo` has **Run one-click demo**:

1. Connect the wallet once.
2. A fresh **session key** is generated in the browser; it will be the agent's executor.
3. The setup is sent as **one wallet request** when the wallet supports EIP-5792 `wallet_sendCalls`
   (atomic batch: register, create firewall with the session key as executor, allow DemoProtocol,
   allow `deposit`, fund the session key with gas). Against V3 the same setup is two calls
   (`registerAgent` + `createFirewallWithPermissions`). Wallets without batching get the same calls
   queued back to back, with no clicks in between, each re-reading the real ids from the previous
   receipt.
4. The session key signs `execute(deposit 100)` locally: **no wallet prompt**.
5. AgentTrace indexes it, runs the 14 receipt checks, verifies the outcome, anchors the proof.
6. The session key simulates `withdraw`; the firewall's `FunctionNotAllowed` is shown, nothing is sent.
7. Leftover gas is sent back to the owner.

The session key is a demo convenience: it lives in browser storage, holds only the gas stipend, can
only call what the firewall allows, and on V3 expires after a day. Code:
[`src/lib/chain/one-click.ts`](../src/lib/chain/one-click.ts),
[`src/routes/demo.tsx`](../src/routes/demo.tsx). Batched setups are indexed by their receipt logs
(`confirmSetupTx`), because a batch is sent from the owner's account rather than to the registry.

## Deploying

```bash
npm run compile:v3                     # artifacts in contracts/out (already committed)
MONAD_DEPLOYER_PRIVATE_KEY=0x… \
AGENT_PROOF_VERIFIERS=0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85,0x<second verifier> \
AGENT_PROOF_THRESHOLD=2 \
npm run deploy:v3:testnet -- --smoke   # then: npm run deploy:v3:mainnet
```

The record lands in `contracts/deployments/v3-<network>.json`. To switch a hosted app to V3, set
`AGENT_FIREWALL_ADDRESS` / `AGENT_FIREWALL_DEPLOY_BLOCK` and `AGENT_PROOF_ADDRESS` /
`AGENT_PROOF_DEPLOY_BLOCK` in Vercel to the new addresses and redeploy; the one-click demo detects V3
(`predictVault`) and switches to the two-call setup with a vault. Note that the indexer follows one
firewall address, so pointing an app at V3 hides V1 history from that app (run a second Vercel project
for V3 if both should stay visible).
