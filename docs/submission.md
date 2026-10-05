# Submission notes

## Short description

AgentTrace is an independent validator and audit trail for onchain agents on Monad. Every agent call gets an onchain identity, an onchain permission check, a receipt-verified proof anchored onchain, and a separate outcome verdict, and those verdicts are published to the ERC-8004 Validation and Reputation registries. Live on Monad mainnet and testnet.

## Longer description

An agent id is created in `AgentRegistry`. What that agent may call is stored in `AgentFirewall`: executor, targets, function selectors, and value limits. Calls go through `execute`. If the target reverts, the firewall reverts with it, and no successful `AgentAction` remains. An indexer stores those events by chain, contract, transaction, block, and log index. A verifier reads the Monad receipt and checks the action against the transaction. The proof hash is a fixed ABI encoding of that evidence. Outcome verification is a second step: it looks for an expected event, such as Demo Protocol `Deposited`, and returns unverifiable when it cannot judge the result. On the hosted app there is no separate account: the connected wallet is the identity. (With auth enabled, a Google login identifies an AgentTrace account.) The passport shows the wallet that owns the agent. The HTTP API confirms receipts and evaluates policy. It does not submit firewall transactions and it does not accept a client-supplied proof as verified.

## What a judge can check

- Live app on Monad mainnet (chain 143): https://agenttrace-mainnet.vercel.app
- Live app on Monad testnet (chain 10143): https://agenttrace-plum.vercel.app
- Mainnet example: agent [#001](https://agenttrace-mainnet.vercel.app/agents/1) (ERC-8004 #10280), firewall [#001](https://agenttrace-mainnet.vercel.app/firewalls/1), execution proof [0x52c98d50…](https://agenttrace-mainnet.vercel.app/proofs/0x52c98d5058fc9a180a5270aeea72698600f5c6c181d7723a1f503fcdab4c6d5e) anchored in [`0x2151d023…`](https://monadvision.com/tx/0x2151d023a27cc9f1f1aecda0b8dc74ed44e7e9b5936a7b18c5ca2b1127feff08), ERC-8004 `validationResponse` [`0xd727a688…`](https://monadvision.com/tx/0xd727a688ae93a2078ee9a0e9e39d31bb2c35ed4de8364640a731abd9524d4231) and `giveFeedback` [`0x3c05024a…`](https://monadvision.com/tx/0x3c05024ac5e0f78972734ee68cce1a4bb7126b375d3500a4e6be405f4a81aef6)
- Demo video (82 s, real Monad testnet transactions): [docs/demo.mp4](demo.mp4)
- A complete live example: agent [#006](https://agenttrace-plum.vercel.app/agents/6), firewall [#004](https://agenttrace-plum.vercel.app/firewalls/4), execution proof [0x3242aead…](https://agenttrace-plum.vercel.app/proofs/0x3242aeadc1ae0b511746852d623e71db91e3a49dbbe27662a886d65260c204df) (anchored onchain in [`0x577824ab…`](https://testnet.monadvision.com/tx/0x577824ab9bef8a84f9b2b0063d8bd580986e456d10a7837861483f9bc26737c4)), and outcome [Deposited 100](https://agenttrace-plum.vercel.app/outcomes/0x3242aeadc1ae0b511746852d623e71db91e3a49dbbe27662a886d65260c204df); deposit transaction [0x6fbbd950…](https://testnet.monadvision.com/tx/0x6fbbd95042890cc346043ec2a79bb070929588580f49b197a4408cef47905c58)
- `/demo`: identity → firewall → allowed deposit → proof → outcome → onchain anchor → blocked withdraw. Running it needs a browser wallet on Monad testnet with a little testnet MON (under 0.1 MON for the five transactions); the withdraw is rejected by the firewall in simulation, so no transaction is sent for it
- Passport, firewall, proof, and outcome pages, which cite indexed chain data and link to the Monad explorer
- `docs/contracts.md` for the proof hash
- `npm run test:contracts` for local EVM checks of the registry, firewall, proof, demo, developer API, and reputation logic
- Screenshots: [docs/screenshots](screenshots)

Earlier test runs registered agents #001–#005 and #007–#011 from the same wallet. Onchain history cannot be deleted, so they were deactivated with `AgentRegistry.deactivateAgent`; the agents list hides deactivated agents by default and shows them under All or Inactive.

## Deployment

### Monad mainnet (chain 143), deployed 5 October 2026

Live app: https://agenttrace-mainnet.vercel.app (same codebase, built with `VITE_MONAD_NETWORK=mainnet`).

| Contract | Address | Deploy block | Deploy tx |
| --- | --- | --- | --- |
| AgentRegistry | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 110869327 | [`0x65bf8edd…`](https://monadvision.com/tx/0x65bf8edd7aefa5805afae5984e94f6f0e65315a9fc9f152b3e25900d4a395255) |
| AgentFirewall | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 110869330 | [`0xd1c07b28…`](https://monadvision.com/tx/0xd1c07b28ad4c7e937bc2d5f78124cb14cefe4ac3c0f22ffea3f131c9663e308f) |
| AgentProof | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 110869333 | [`0xa347bfa7…`](https://monadvision.com/tx/0xa347bfa7657e54d7457c52b0503eed3209df39e10def8fe3798646bd89a47619) |
| DemoProtocol | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 110869336 | [`0x3e13bee3…`](https://monadvision.com/tx/0x3e13bee34bd16a9701c6372d6338245f593b411f52e9e0fd2b63a2e25ce38b37) |

The verifier `0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85` was set in the AgentProof constructor. Total deploy cost: 0.352 MON. See the README "ERC-8004" section for the mainnet and testnet ERC-8004 transactions.

### Monad testnet (chain 10143)

Live app: https://agenttrace-plum.vercel.app (Vercel, wallet-only mode: no application accounts; the connected wallet is the identity and signs every chain action).

Deployed 3 October 2026:

| Contract | Purpose | Address (Monad testnet, 10143) | Deploy block | Deploy tx |
| --- | --- | --- | --- | --- |
| AgentRegistry | Persistent agent identity | [`0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e`](https://testnet.monadvision.com/address/0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e) | 67788394 | [`0x3426bbc9…`](https://testnet.monadvision.com/tx/0x3426bbc9643ea6f04e278d109645d036aa85a9e3d485cd9f6cc3bbd98fc2dfff) |
| AgentFirewall | Permissions and execution | [`0x694178a2396b54bff6a25caa0aa9cca6eb079441`](https://testnet.monadvision.com/address/0x694178a2396b54bff6a25caa0aa9cca6eb079441) | 67788397 | [`0x9346cf54…`](https://testnet.monadvision.com/tx/0x9346cf54288f0cd0683e0c92a1e0ce50727d84409eb51a2a2bcb072a6f282044) |
| AgentProof | Immutable proof-hash anchors | [`0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e`](https://testnet.monadvision.com/address/0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e) | 67788400 | [`0x4e017247…`](https://testnet.monadvision.com/tx/0x4e0172478ce7dde026c13d6c020cd5788e4ba64a9cf42d38554c02643b2d95b4) |
| DemoProtocol | Deposit, swap, and withdraw demo target | [`0x1664be58ee54af91c756428f466bad6e4f9911c3`](https://testnet.monadvision.com/address/0x1664be58ee54af91c756428f466bad6e4f9911c3) | 67788404 | [`0xd9f5fad6…`](https://testnet.monadvision.com/tx/0xd9f5fad6e0043f9980e084643ea60dc47c6572139072de9f6ded64c20f38bdae) |

Proof anchoring is on. The AgentProof verifier is a dedicated server wallet, [`0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85`](https://testnet.monadvision.com/address/0x77a55a4980769F543Ea5Bb799F4f49A8c1Cd0D85), set by the contract owner with `setVerifier` ([`0x9f239ab5…`](https://testnet.monadvision.com/tx/0x9f239ab50f69b909d7ff07d3ba4cedb6e92a81cf092f439acda90b03dd573208)). After a proof is receipt-verified, the hosted app sends `anchorProof` with its proof hash, and `/demo` does this automatically after the outcome verifies. Anchors cannot be edited or repeated. Two live examples:

- Agent #006 showcase execution: anchor [`0x577824ab…`](https://testnet.monadvision.com/tx/0x577824ab9bef8a84f9b2b0063d8bd580986e456d10a7837861483f9bc26737c4)
- A `/demo` run on the live site (agent #011, execution `0x345347b7…`): anchor [`0x466a2c1e…`](https://testnet.monadvision.com/tx/0x466a2c1e891a392991fbeb2ea4135ba0a32aacbde3f5cd28fec5dc43e6749949), sent automatically by the demo flow

`AgentProof.isAnchored(executionId)` returns true for both. `getAnchor` returns the proof hash, agent id, firewall id, execution transaction, and the verifier address.

## Judge questions

**What problem?** Agents act, but identity, permission, execution, and result are easy to blur together.

**Why identity?** So a later proof can name a stable agent id and owner, not an unlabeled wallet.

**Why permissions?** So an allowed function and a blocked function are different onchain facts.

**Why provenance?** So a receipt and an `AgentAction` can be checked without trusting the UI.

**Why separate proof and outcome?** A successful call is not the same as the intended protocol result.

**Why onchain?** The permission check and the event are outside the agent process.

**Why ERC-8004?** So the verdict is not locked inside AgentTrace. Any marketplace or agent can call `getValidationStatus(proofHash)` or `getSummary(agentId, …)` on the shared registries.

**Why Monad?** AgentTrace writes onchain at every step, so cost and finality matter. Measured on Monad: an `anchorProof` uses 179,045 gas (about 0.018 MON at the 102 gwei seen on 5 October 2026), an `execute` 154,784 gas, and deploying all four contracts on mainnet cost 0.352 MON. Per the Monad docs, blocks come every 300 ms and are final after two blocks (about 600 ms), so a proof is anchored and readable within seconds with no reorg handling. The contracts are ordinary EVM Solidity.
