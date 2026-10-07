# WMON Agent on Monad mainnet: real sessions

Agent #3 (owner and executor 0xB925D44d52815D19C2f91c30f6aBD3B4D0546D4E), firewall #3: target Wrapped MON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` only, functions `deposit()` and `transfer(address,uint256)`, at most 0.02 MON per call and 0.05 MON per day. Off-chain cap: `transfer` amount at most 0.01 WMON. Every transaction below is real.

## Session 1 (SDK): wrap 0.01 MON with WMON.deposit()

`traceCall` (10.8 s)

```json
{
  "allowed": true,
  "txHash": "0x17ec0160c8929c55a53165e833a8ebb7afb6cfe8a3547b13c8bd962df46a37d3",
  "anchorTxHash": "0x107ad29fa0c1fe51c2c22f6a6a7d85ec5479324fc970a137a2f48e67f0115fd3",
  "executionId": "0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552",
  "agentId": "3",
  "proofStatus": "receipt_verified",
  "proofHash": "0xcf38cf595af03f65fd47e50b2819eb49e2780c106ab8c5837a419743cf21c2de",
  "proofUrl": "https://agenttrace-mainnet.vercel.app/proofs/0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552",
  "explorerUrl": "https://monadvision.com/tx/0x17ec0160c8929c55a53165e833a8ebb7afb6cfe8a3547b13c8bd962df46a37d3"
}
```

## Session 2 (MCP): agenttrace-firewall

Started 2026-10-07T17:21:37.268Z

> Onchain tools for agent #3 on monad-mainnet. Every write is checked by AgentTrace firewall #3; calls outside its policy are rejected and nothing is sent.

### tools/call `agenttrace_policy` {}

The agent reads its own policy first. (0.6 s)

```json
{
  "firewallId": "3",
  "agentId": "3",
  "status": "active",
  "executor": "0xb925d44d52815d19c2f91c30f6abd3b4d0546d4e",
  "allowValueTransfer": true,
  "allowedTargets": [
    "Wrapped MON (WMON) 0x3bd359c1119da7da1d913d1c4d2b7c461115433a"
  ],
  "allowedFunctions": [
    "0xa9059cbb on 0x3bd359c1119da7da1d913d1c4d2b7c461115433a",
    "0xd0e30db0 on 0x3bd359c1119da7da1d913d1c4d2b7c461115433a"
  ],
  "page": "https://agenttrace-mainnet.vercel.app/firewalls/3",
  "offchainAmountLimits": [
    {
      "selector": "0xa9059cbb",
      "target": "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A",
      "argIndex": 1,
      "maxAmount": "10000000000000000",
      "enforcedBy": "this MCP server before sending"
    }
  ]
}
```

### tools/call `call_contract` { "target": "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", "data": "0xa9059cbb000000000000000000000000b925d44d52815d19c2f91c30f6abd3b4d0546d4e000000000000000000000000000000000000000000000000002386f26fc10000" }

Return the 0.01 WMON from session 1 to the owner. Allowed: transfer is in the policy and 0.01 is at the off-chain cap. (2.7 s)

```json
{
  "allowed": true,
  "txHash": "0x9ad6de14a8c4c19944b28dc0d676a20460a167cef5883dd3824f9cc1b26b99b1",
  "anchorTxHash": "0x5a8cdaf9f1a27644e8891d5dc4fe39420697cbdda7875510db8c40f180ca0764",
  "executionId": "0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862",
  "agentId": "3",
  "proofStatus": "receipt_verified",
  "proofHash": "0xb3c5b46542dbf249562e406bab7b3560e7581995ff1df3ee1a5f1e6bdbbe3f89",
  "proofUrl": "https://agenttrace-mainnet.vercel.app/proofs/0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862",
  "explorerUrl": "https://monadvision.com/tx/0x9ad6de14a8c4c19944b28dc0d676a20460a167cef5883dd3824f9cc1b26b99b1"
}
```

### tools/call `call_contract` { "target": "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", "data": "0x2e1a7d4d000000000000000000000000000000000000000000000000002386f26fc10000" }

WMON.withdraw is not in the policy. The firewall should reject it before anything is sent. **Result: rejected, nothing sent.** (0.1 s)

```json
{
  "allowed": false,
  "code": "FIREWALL_REJECTED",
  "message": "The firewall would reject this call. Nothing was sent. AgentFirewall reverted with FunctionNotAllowed(3, 0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A, 0x2e1a7d4d).",
  "sent": false
}
```

### tools/call `call_contract` { "target": "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", "data": "0xa9059cbb000000000000000000000000b925d44d52815d19c2f91c30f6abd3b4d0546d4e0000000000000000000000000000000000000000000000000de0b6b3a7640000" }

Transfer 1 WMON: above the 0.01 off-chain cap, so the MCP server refuses it before simulation. **Result: rejected, nothing sent.** (0.0 s)

```json
{
  "allowed": false,
  "code": "POLICY_REJECTED",
  "message": "Argument 1 of 0xa9059cbb is 1000000000000000000, above the maxAmount 10000000000000000. Nothing was sent.",
  "sent": false
}
```

## Session 3 (SDK): deposit() with 0.03 MON, above the 0.02 MON onchain per-call cap

`traceCall` **Result: rejected, nothing sent.** (0.2 s)

```json
{
  "allowed": false,
  "code": "FIREWALL_REJECTED",
  "message": "The firewall would reject this call. Nothing was sent. AgentFirewall reverted with TransactionValueTooHigh(3, 30000000000000000).",
  "sent": false
}
```


## After the sessions

**Outcomes** (built-in WMON adapter, `POST /api/outcomes/:executionId/protocol`; the expectation is derived by the server from the execution, not supplied by the caller):

| Execution | Expected event on WMON | Observed | Status |
| --- | --- | --- | --- |
| [0x30985cb6…](https://agenttrace-mainnet.vercel.app/outcomes/0x30985cb60afd8d37b5edfad48312f32ecffa3e34366d31b7f9ec94ef574a9552) deposit | `Deposit(dst = AgentFirewall, wad = 0.01 MON)` | `0x6941…b441`, `10000000000000000` | verified |
| [0x55b2e18f…](https://agenttrace-mainnet.vercel.app/outcomes/0x55b2e18ff7e0995159672f4624451510079632662086fa3a65d3896ecced1862) transfer | `Transfer(src = AgentFirewall, dst = owner, wad = 0.01 WMON)` | `0x6941…b441`, `0xB925…6D4E`, `10000000000000000` | verified |

**ERC-8004** (official mainnet registries): identity #10315 registered by the owner in [`0xd103b471…`](https://monadvision.com/tx/0xd103b471416bc968fd4c84acb3ce67387c50e4607f03c321e6e0c7bca125fc4c) (agent URI `https://agenttrace-mainnet.vercel.app/api/erc8004/agents/3`).

| Execution | `validationRequest` (owner) | `validationResponse` 100 (verifier) | `giveFeedback` 100 (verifier, after the verified outcome) |
| --- | --- | --- | --- |
| deposit | [`0x98af1ab7…`](https://monadvision.com/tx/0x98af1ab7d618416e9b0ed8a463c721336003a780d77df1410b4d0dca7d6e90bd) | [`0xec0b469a…`](https://monadvision.com/tx/0xec0b469afbd31f15f2ed22d29e931a3fa95a9774ec5c33a5b8e62434b4c57e2c) | [`0x8d0e94ff…`](https://monadvision.com/tx/0x8d0e94ff2bc34017d01b504166c5e83a0c92cb097f3db0aba9288e137930dd11) |
| transfer | [`0x31db53e3…`](https://monadvision.com/tx/0x31db53e3218b912c363573fcec5fc56489008dd9bb95827d2e74d6d53761a806) | [`0x12d9990d…`](https://monadvision.com/tx/0x12d9990d6d9bd875da8eee6711c1bb2ddb9e4b88c753e15a65da28e63bfe0788) | [`0xfc8a59aa…`](https://monadvision.com/tx/0xfc8a59aad7cc3bdee5ddf40aea67bb20d38fb81242ac84cc985d1ee512c74210) |

**Independent check**: `node scripts/verify-proof.mjs <hash>` prints `PASS` for both executions, by execution id, execution tx, and anchor tx.

**Afterwards**, outside the firewall, the owner unwrapped the returned 0.01 WMON with `WMON.withdraw` in [`0x6af4688f…`](https://monadvision.com/tx/0x6af4688fa7edaa4bc6fe2a0da24e5217503142b340d457a6a9b188f7456199e3).

Reproduce: `AGENT_KEY=0x… node agents/wmon-agent/setup.mjs --confirm-mainnet`, then `AGENT_KEY=0x… npx tsx agents/wmon-agent/run-sessions.ts --confirm-mainnet`. Record: [wmon-mainnet.json](wmon-mainnet.json).
