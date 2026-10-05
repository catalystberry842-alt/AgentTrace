# Demo voiceover

About 2 minutes 30 seconds. Recorded on the live mainnet app, https://agenttrace-mainnet.vercel.app (Monad mainnet, chain 143). The video shows real executions that already happened onchain; it does not stage a wallet session. Every number is from a real receipt, a measured run, or the Monad docs. The narration is generated from this file (`scripts/make-demo-video.mjs`), one scene per section.

## 1. Landing
AI agents have wallets now, and a wallet can call anything. When an agent acts, four questions are hard to answer: which agent was it, what was it allowed to do, what actually ran, and did it work? AgentTrace is an independent validator and audit trail for onchain agents on Monad. It answers each question from the chain, not from the agent's own logs.

## 2. Agent passport
This is Research Agent number one, registered on Monad mainnet. Its identity lives in the AgentRegistry contract, owned by this wallet. Below it is its public reputation. The agent is linked to ERC-8004 identity ten thousand two hundred eighty, and AgentTrace has published one validation and one outcome verdict for it, both scored one hundred out of one hundred.

## 3. Firewall
The firewall is a contract that holds the agent's rules: which executor may act, which contract, which function, and how much value. Here, only deposit on the demo protocol is allowed, and value transfers are off. Anything else is rejected onchain before it reaches the target.

## 4. Proof
Here is one execution. AgentTrace's verifier read the transaction and receipt from Monad and checked fourteen things: the agent, the firewall, the executor, the target, the function, the value, the calldata hash, and more. All passed, so the proof hash was anchored onchain in the AgentProof contract. An anchor costs about one hundred seventy-nine thousand gas, roughly zero point zero one eight MON.

## 5. ERC-8004
The verdict does not stay inside AgentTrace. The verifier posted it to the shared ERC-8004 Validation Registry, keyed by the proof hash, and posted the outcome to the Reputation Registry. Any wallet, marketplace, or other agent can read it onchain.

## 6. Outcome
A successful call is not the same as the result you wanted. The outcome check looks for the Deposited event with the expected agent and amount. It verified, as a separate verdict from the execution proof.

## 7. A third-party agent over MCP
AgentTrace also works with agents you already run. This is a real session with the AgentTrace MCP server, the way Claude or Cursor would use it. The Treasury Agent, with its own executor key, read its policy, made a deposit that came back verified and anchored in about two seconds, and then tried to withdraw. The firewall refused it in simulation, and nothing was sent.

## 8. Why Monad
Every step here is an onchain write, so cost and finality decide whether this is practical. On Monad a proof anchor costs about zero point zero one eight MON, and blocks are final after two blocks, about six hundred milliseconds. Indexing runs on Envio HyperSync. AgentTrace: every agent leaves a trace.
