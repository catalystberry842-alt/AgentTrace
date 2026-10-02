# Demo script

About three minutes. Use `/demo` on Monad testnet with a wallet. Do not narrate from slides if the page can show the step.

If the contracts are not deployed, say that plainly and stop. The page will not invent an agent, a transaction, or a proof.

## 0:00–0:20 Problem

An agent can send a transaction. That does not say which agent it was, what it was allowed to do, or whether the result matched the intent.

## 0:20–0:40 Agent identity

Create the Research Agent. Wait until the registry transaction is indexed. The passport shows the agent id and the wallet that signed, not the Google account.

## 0:40–1:10 Firewall

Create the firewall. The executor is the connected wallet. Allow Demo Protocol and `deposit`. Leave `withdraw` disallowed. Value transfer stays off. The page reads those rules back from the chain, not from the form.

## 1:10–1:40 Real execution

Run the deposit. The wallet calls `AgentFirewall.execute`. A successful run emits `AgentAction` only after `deposit` succeeds.

## 1:40–2:00 Proof

Open the execution. AgentTrace reads the transaction and receipt. Verification is `receipt_verified` only when the event matches the firewall, agent, executor, target, selector, value, and calldata. If it fails, the page says verification failed and links to the checks.

## 2:00–2:20 Outcome

The outcome check looks for `Deposited` on Demo Protocol. That is separate from the execution proof. A missing or unsupported event is not shown as verified.

## 2:20–2:40 Blocked action

Attempt `withdraw`. The firewall rejects it before a successful action exists. The page names the function and says no `AgentAction` was created.

## 2:40–3:00 Why AgentTrace and Monad

Identity, permission, execution, proof, and outcome are different records. Monad testnet is the EVM chain those contracts and events live on. The browser is not the source of truth.
