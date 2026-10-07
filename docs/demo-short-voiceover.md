# Short demo voiceover

About 90 seconds. It opens with the blocked call. Same method as `docs/demo-voiceover.md`: narration and captions are generated from this file by `node scripts/make-demo-video.mjs --short`, and the picture is recorded from the live mainnet app and the real recorded MCP session (Monad mainnet, chain 143). Nothing is staged.

## 1. Blocked
This AI agent just tried to withdraw funds on Monad mainnet, and it was refused before anything was sent. Its AgentTrace firewall only allows deposits, so the withdraw failed in simulation with Function Not Allowed, and no transaction left the wallet.

## 2. Allowed
A moment earlier, the same Treasury Agent, through the same MCP server that Claude or Cursor would use, made a deposit. It went through the firewall contract, and came back receipt verified and anchored in about two seconds.

## 3. Firewall
The firewall is an onchain contract that holds the agent's rules: which executor may act, which contract, which function, and how much value. Anything else reverts before it reaches the target.

## 4. Proof
Every execution gets a proof. AgentTrace re-reads the transaction and receipt from Monad, checks each field against the firewall's event, and anchors the proof hash in the AgentProof contract. Anyone can recompute that hash from public RPC with one script.

## 5. ERC-8004
The verdict is then published to the shared ERC-8004 validation and reputation registries, so other wallets, marketplaces, and agents can read it onchain without trusting AgentTrace.

## 6. Why Monad
Every step is an onchain write, so cost and finality matter. On Monad a proof anchor costs about zero point zero one eight MON, and blocks are final in under a second. AgentTrace: every agent leaves a trace.
