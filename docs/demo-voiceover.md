# Demo voiceover

About 2 minutes 30 seconds. Recorded against https://agenttrace-mainnet.vercel.app (Monad mainnet) or https://agenttrace-plum.vercel.app (testnet). Every number below is from a real receipt or from the Monad docs. Do not add others.

**0:00 — Problem.** "AI agents have wallets now. A wallet can call anything. But when an agent acts, nobody can easily answer four questions: which agent was it, what was it allowed to do, what actually ran, and did it work?"

**0:15 — What AgentTrace is.** "AgentTrace is an independent validator and audit trail for onchain agents. It answers each question with a separate onchain record, and it never takes the agent's word, or the browser's, for any of them."

**0:30 — Identity.** Open `/demo`, register the Research Agent. "This is a real transaction to AgentRegistry on Monad. The agent gets a permanent id, owned by this wallet."

**0:45 — Firewall.** Create the firewall, allow Demo Protocol `deposit`. "The firewall is a contract. It holds the rules: which executor, which contract, which function, how much value. Withdraw is not on the list."

**1:00 — Execution.** Run the deposit. "The agent's call goes through AgentFirewall.execute. The firewall checks the rules, makes the call, and only if it succeeds emits an AgentAction event."

**1:10 — Proof.** Open the proof page. "AgentTrace's verifier reads the transaction and receipt from Monad itself and checks fourteen things: agent, firewall, executor, target, selector, value, calldata hash, and more. All pass, so it computes a proof hash and anchors it onchain in AgentProof. That anchor cost 179,045 gas, about 0.018 MON."

**1:30 — Outcome.** "A call that succeeds is not the same as the result you wanted. The outcome check looks for the Deposited event with amount 100. Verified, as a separate verdict."

**1:40 — Blocked action.** Try withdraw. "Withdraw isn't allowed, so the firewall rejects it in simulation. No transaction, no AgentAction, nothing to prove."

**1:50 — ERC-8004.** Scroll to the ERC-8004 panel. "The verdicts don't stay inside AgentTrace. This agent is linked to its ERC-8004 identity, number 10280 on mainnet. AgentTrace posted a validation response of 100 to the ERC-8004 Validation Registry, with the proof hash, and outcome feedback to the Reputation Registry. Any marketplace or agent can read them onchain."

**2:10 — Why Monad.** "Every step here is an onchain write, so cost and speed matter. On Monad, blocks finalize after two blocks, about 600 milliseconds, and anchoring a proof costs about 0.018 MON at the gas price we measured."

**2:20 — Close.** "Any agent can use it with one SDK call: traceCall routes the agent's transaction through the firewall and returns its proof. AgentTrace: every agent leaves a trace."
