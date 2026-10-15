# Security migration notes (October 2026 audit)

This page lists the onchain actions the code changes in this branch do **not** perform. Contracts are
immutable (no proxy, no admin), so fixes only apply to new deployments. Nothing here has been sent.

## 1. V1 / V2 firewalls: shared balance (deprecated)

`AgentFirewall` (V1) and `AgentFirewallV2` make the target call as the firewall itself. Anything a
protocol pays to `msg.sender` lands in the one firewall contract, shared by every agent on that
deployment. Any agent whose firewall allows a token's `transfer`/`approve` can move it.

Live deployments affected:

| Network | Contract | Address |
|---|---|---|
| Mainnet | AgentFirewallV2 | `0xf1b0365586d1867133c991046e2fd3006efe16e5` |
| Testnet | AgentFirewallV2 | `0x5b027151faa45e83ac1790a8bf5671388c640fb9` |
| Mainnet / testnet | AgentFirewall (V1) | see README deployments table |

Steps (owner decides and signs; nothing is automated):

1. **Inventory.** For each V1/V2 address, read native balance and the `balanceOf`/`allowance` of every
   token any firewall on it allows (WMON on mainnet). Read-only.
2. **Sweep.** There is no admin withdrawal on V1/V2. The only way to move tokens out is an executor
   calling `transfer` through a firewall that allows that token + selector (preferably with
   `setArgCap`). For each balance, the agent owner whose calls produced it creates/uses a firewall
   allowing `token.transfer`, has its executor send the balance to the owner, then disables the
   function and target. Revoke any `approve` the firewall granted (`approve(spender, 0)`).
3. **Stop new deposits.** `pauseFirewall` / `deactivateFirewall` every V1/V2 firewall once swept.
4. **Move agents to V3.** `createFirewallWithPermissions` on V3; set `setArgCap`, the new
   `setArgPeriodCap` and `setRecipientRule`/`setRecipientAllowed` for any token `transfer`/`approve`.

## 2. Contracts changed in this branch (redeploy needed to take effect)

- `AgentFirewallV3`: target disable clears its functions/caps; per-period token caps; recipient
  allowlists; `AgentAction` emitted before the external call. The live mainnet V3 at
  `0x06f7ba5b…` keeps the old behaviour until a new V3 is deployed and agents migrate (vault assets
  move with `AgentVault.ownerCall` by the registry owner).
- `AgentProofQuorum`: removed verifiers can withdraw/be pruned; owner can resolve disputes (new
  round); two-step ownership. The live quorum `0x21aa1604…` keeps the old behaviour. After deploying
  a new one, point the server/SDK at it and re-attest pending executions. Transfer ownership to a
  multisig (`transferOwnership` then `acceptOwnership`).
- `AgentFirewall` / `AgentFirewallV2`: reject `address(this)` as a target (future deploys only).
- `AgentProof`: `ZeroValue` error for zero hashes, doc fix (future deploys only).

`contracts/out/*.json` now describe these sources. ABIs are a superset of the deployed ones (new
functions, events and errors only), so reading the live contracts still works. Their bytecode no
longer equals what is deployed at the old addresses.

## 3. ERC-8004 feedback

No onchain action. Existing feedback hashes are unchanged; new feedback documents are pinned at
publish time so the served bytes cannot drift.
