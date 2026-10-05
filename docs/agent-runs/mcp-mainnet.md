# MCP session: agenttrace-firewall

Started 2026-10-05T23:10:33.780Z

> Onchain tools for agent #2 on monad-mainnet. Every write is checked by AgentTrace firewall #2; calls outside its policy are rejected and nothing is sent.

**tools/list** → `agenttrace_policy`, `demo_deposit`, `demo_withdraw`, `call_contract`

## tools/call `agenttrace_policy` {}

The agent reads its own policy first. (0.2 s)

```json
{
  "firewallId": "2",
  "agentId": "2",
  "status": "active",
  "executor": "0x2551c85252e06989e044bcb6603135f9dbd11778",
  "allowValueTransfer": false,
  "allowedTargets": [
    "AgentTrace Demo Protocol 0x1664be58ee54af91c756428f466bad6e4f9911c3"
  ],
  "allowedFunctions": [
    "0xe2bbb158 on 0x1664be58ee54af91c756428f466bad6e4f9911c3"
  ],
  "page": "https://agenttrace-mainnet.vercel.app/firewalls/2"
}
```

## tools/call `demo_deposit` {"amount":25}

Allowed by the policy. (2.1 s)

```json
{
  "allowed": true,
  "txHash": "0x53e92644141f38e31bf3c67a09941a386ca9476fcdf0a1b80c65755c0ad5ff76",
  "anchorTxHash": "0x6d3fda85231be2a7f58798157f7e07dc67167b16cd69061825023ea95bb4bfc1",
  "executionId": "0x8361810c1d8b7f3f932a1b8e005dc0cd9d84980432319f540276fde7216ab798",
  "agentId": "2",
  "proofStatus": "receipt_verified",
  "proofHash": "0x54833a379742656d65db4cf8e6b2a8adc3b02f31129607d64a5126d13be363a0",
  "proofUrl": "https://agenttrace-mainnet.vercel.app/proofs/0x8361810c1d8b7f3f932a1b8e005dc0cd9d84980432319f540276fde7216ab798",
  "explorerUrl": "https://monadvision.com/tx/0x53e92644141f38e31bf3c67a09941a386ca9476fcdf0a1b80c65755c0ad5ff76"
}
```

## tools/call `demo_withdraw` {"amount":25}

Not in the policy. The firewall should reject it before anything is sent. **Result: rejected.** (0.1 s)

```json
{
  "allowed": false,
  "code": "FIREWALL_REJECTED",
  "message": "The firewall would reject this call. Nothing was sent. AgentFirewall reverted with FunctionNotAllowed(2, 0x1664Be58eE54af91c756428f466bad6E4f9911C3, 0x441a3e70).",
  "sent": false
}
```
