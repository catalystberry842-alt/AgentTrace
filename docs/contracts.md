# Smart contracts

Solidity 0.8.31. No proxy, no `delegatecall`, no `tx.origin`. Custom errors. Checked arithmetic.

`src/lib/chain/deployment.ts` records the confirmed Monad testnet deployment of 3 October 2026:

| Contract | Purpose | Address (Monad testnet, 10143) | Deploy block | Deploy tx |
| --- | --- | --- | --- | --- |
| AgentRegistry | Persistent agent identity | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://testnet.monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 67788394 | [`0x3426bbc9…`](https://testnet.monadvision.com/tx/0x3426bbc9643ea6f04e278d109645d036aa85a9e3d485cd9f6cc3bbd98fc2dfff) |
| AgentFirewall | Permissions and execution | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://testnet.monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 67788397 | [`0x9346cf54…`](https://testnet.monadvision.com/tx/0x9346cf54288f0cd0683e0c92a1e0ce50727d84409eb51a2a2bcb072a6f282044) |
| AgentProof | Immutable proof-hash anchors | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://testnet.monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 67788400 | [`0x4e017247…`](https://testnet.monadvision.com/tx/0x4e0172478ce7dde026c13d6c020cd5788e4ba64a9cf42d38554c02643b2d95b4) |
| DemoProtocol | Deposit, swap, and withdraw demo target | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://testnet.monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 67788404 | [`0xd9f5fad6…`](https://testnet.monadvision.com/tx/0xd9f5fad6e0043f9980e084643ea60dc47c6572139072de9f6ded64c20f38bdae) |

A deployment is real only after a confirmed transaction, or after the matching environment variable is set to a `0x` address.

`npm run deploy:testnet` (`scripts/deploy-contracts.mjs`) deploys all four contracts to Monad testnet and writes each address only after its receipt succeeds and bytecode is present. See the README section "Deploying the contracts to Monad testnet".

## AgentRegistry

Purpose: persistent agent identity.

Important functions:

- `registerAgent(name, description, metadataURI, capabilities)` — caller becomes owner, next id is assigned
- `updateAgentMetadata` — active owner only
- `deactivateAgent` — active owner only
- `getAgent`, `getAgentCount`, `getAgentsByOwner`, `agentExists`, `getAgentOwner`

Events: `AgentRegistered`, `AgentUpdated`, `AgentDeactivated`.

Authorization: metadata and deactivation require `msg.sender` to be the stored owner. There is no separate administrator.

Assumption: capabilities are a bitset chosen by the owner. They describe the agent. They do not grant execution rights.

## AgentFirewall

Purpose: what an agent is allowed to call, and the call itself.

Important functions:

- `createFirewall`
- `setExecutor`
- `updatePolicy`
- `allowTarget`, `disableTarget`
- `allowFunction`, `disableFunction`
- `pauseFirewall`, `unpauseFirewall`, `deactivateFirewall`
- `execute(firewallId, target, value, data)`
- `getFirewall`, `getPolicy`, `isTargetActive`, `isFunctionAllowed`

Events include `FirewallCreated`, `ExecutorUpdated`, `TargetAllowed`, `TargetDisabled`, `FunctionAllowed`, `FunctionDisabled`, `PolicyUpdated`, `FirewallPaused`, `FirewallUnpaused`, `FirewallDeactivated`, `FirewallOwnerSynced`, and `AgentAction`.

Authorization: configuration uses the current registry owner (`_owned`). Execution uses the configured executor, not the owner. The registry is read again at execution time, so a deactivated agent cannot execute.

Assumptions:

- The executor is trusted to submit only calls the owner has allowed. The contract still enforces target, selector, pause, and value limits.
- Value accounting updates before the external call. A reverting target rolls the transaction back, so nonce and spend do not persist.
- Re-entering `execute` from the target does not impersonate the executor unless the target is the executor.

## AgentProof

Purpose: store a proof hash that an off-chain verifier already checked. This contract cannot read historical receipts.

Important functions:

- `anchorProof(proofHash, executionId, agentId, firewallId, transactionHash)` — verifier only
- `setVerifier` — owner only
- `getAnchor`, `isAnchored`

Events: `ExecutionProofAnchored`, `VerifierUpdated`.

Authorization: the constructor sets `owner` to the deployer and `verifier` to the address passed in. Anchors cannot be edited. The same execution id or proof hash cannot be anchored twice.

### Proof hash

The verifier and this contract use the same encoding. Field order is fixed. It does not use JSON.

```text
keccak256(abi.encode(
  uint256 chainId,
  uint256 agentId,
  uint256 firewallId,
  bytes32 executionId,
  address executor,
  bytes32 transactionHash,
  uint256 blockNumber,
  address target,
  bytes4 selector,
  uint256 value,
  bytes32 calldataHash
))
```

`chainId` is 10143 on Monad testnet. Verification status is stored next to this hash, not inside it. Status is the result of the checks. Putting it in the hash would make the same evidence hash differently.

`calldataHash` is `keccak256` of the `data` argument passed to `execute`, which is also stored on `AgentAction`.

## DemoProtocol

Purpose: a target with three functions so a firewall can allow `deposit` and reject `swap` and `withdraw`.

Functions: `deposit(uint256 agentId, uint256 amount)`, `swap(uint256 agentId, uint256 amountIn, uint256 amountOut)`, `withdraw(uint256 agentId, uint256 amount)`.

Events: `Deposited`, `Swapped`, `Withdrawn`.

The agent id is an argument because the firewall call has to say which agent the accounting belongs to. These are not zero-argument functions.

It does not hold MON and has no administrator. Balances are accounting numbers, not custody. `swap` moves recorded deposit units into `swapped`. `withdraw` reverts when the recorded deposit is too small. This is not a production financial protocol.
