# Redeploy and migration plan (post-audit, PR #3)

Status: **plan only.** Nothing below has been sent, deployed or moved. Every transaction listed needs
its signer's explicit go-ahead. State was read from public RPC at 19:1x WAT on 15 Oct 2026
(mainnet block 113,691,551, testnet block 71,330,451; both networks quoting 102 gwei).

## 1. Current onchain state (read-only)

### Mainnet (chain 143)

| Contract | Address | Firewalls | MON | WMON | Open WMON approvals |
|---|---|---|---|---|---|
| AgentFirewall (V1) | `0x694178a2…9441` | 5 | 0 | 0 | none found to `0xB925…6D4E` |
| AgentFirewallV2 | `0xf1b03655…16e5` | 1 | 0 | 0 | **0.0005 WMON to `0xB925…6D4E`** (left over from the capped `approve` demo, tx `0x8f6042f2…`) |
| AgentFirewallV3 (old source) | `0x06f7ba5b…e50f` | 1 | 0 | 0 | none |
| AgentVault for V3 firewall #1 | `0x909Fbc69…3C77A` | – | 0 | **0.0006** | none |
| AgentProofQuorum (old source) | `0x21aa1604…adf6` | owner `0xB925…6D4E`, 2 verifiers, threshold 2 | | | |
| AgentProof (single verifier) | `0x3ea56020…bd3e` | used by the hosted app | | | |

No V1/V2 firewall holds MON or WMON. The only exposure is the 0.0005 WMON allowance V2 granted to the
project owner's own wallet (the owner, not an outside party, can pull it, and V2 holds 0 WMON, so
nothing can move today). WMON is the only token any mainnet firewall allows. I only checked
allowances to `0xB925…6D4E`, the one spender any recorded tx used.

### Testnet (chain 10143)

| Contract | Address | Firewalls | MON |
|---|---|---|---|
| AgentFirewall (V1) | `0x694178a2…9441` | 9 | 0 |
| AgentFirewallV2 | `0x5b027151…0fb9` | 1 | 0 |

Testnet firewalls only target `DemoProtocol` (internal accounting, no ERC-20), so there are no token
balances to sweep. Note: `testnet-rpc.monad.xyz` was unreachable from the box; I read testnet via
`rpc-testnet.monadinfra.com`.

## 2. Gas (mainnet, 102 gwei; Monad bills the gas **limit**, so set limits close to estimates)

| Action | Gas (estimate) | MON |
|---|---|---|
| Deploy new AgentFirewallV3 (constructor: registry) | 3,283,847 (`eth_estimateGas`) | ≈ 0.335 |
| Deploy new AgentProofQuorum (2 verifiers, threshold 2) | 1,209,164 (`eth_estimateGas`) | ≈ 0.123 |
| `createFirewallWithPermissions` per agent (deploys a vault) | ≈ 600–900k (vault create + perms; not estimated live) | ≈ 0.06–0.09 + stipend |
| `setArgCap` / `setArgPeriodCap` / `setRecipientRule` / `setRecipientAllowed` | ≈ 50–80k each | ≈ 0.005–0.008 each |
| Per execute through V3 | ≈ 190–230k (V2 measured 191k) | ≈ 0.02 |
| Quorum `transferOwnership` + `acceptOwnership` | ≈ 30k + 30k | ≈ 0.006 |
| V2 approval revoke via firewall `execute(approve(0xB925…,0))` | ≈ 60–80k | ≈ 0.008 |
| V3 old-vault withdrawal `ownerCall(WMON.transfer)` | ≈ 60k | ≈ 0.006 |
| Pause/deactivate per old firewall | ≈ 30–45k | ≈ 0.004 |

**Mainnet total ≈ 0.6–0.8 MON** for deploys + 1 agent migration + cleanup, more per extra agent.
Testnet costs the same in testnet MON.

## 3. Ordered steps

Signers: **Deployer/ops** = the key used for previous deploys (`OPS_KEY`). **Owner** = agent
registry owner `0xB925…6D4E` (WMON Agent #003) or each agent's owner for #001–#005.
**Executor** = the firewall's executor key. **Verifier A** = operator-box key; **Verifier B** =
`0x1C13…e5d1` (owner's personal custody). **Multisig** = to be created (e.g. Safe on Monad).

### Phase 0: code before any deploy (PRs, no txs)
1. App indexer: support **several firewall addresses** (V1 + old V3 + new V3) instead of the single
   `AGENT_FIREWALL_ADDRESS`, so old history stays indexed. The `AgentAction` event is identical on
   every version, so it's the same decoder with a list of addresses + deploy blocks.
2. Proof anchoring: add a quorum mode (attest from Verifier A on the server; Verifier B attests from
   its own machine with `scripts/second-verifier.mjs`), configured by `AGENT_PROOF_QUORUM_ADDRESS`.
   Keep `AgentProof` readable for existing anchors.
3. SDK `TRACE_NETWORKS` (`sdk/src/trace/trace.ts:29,36`) and MCP (`agents/mcp-firewall`): add
   `firewallV3` per network, default to V3 for new agents, keep V1 selectable. `execute(...)` has
   the same signature on all versions, so only the address changes. Bump the SDK minor version.
4. `contracts/deployments/`: keep the old JSON files untouched; add new ones per deploy.

### Phase 1: testnet
1. Deploy `AgentFirewallV3` (Deployer). `npm run deploy:v3:testnet` (uses `contracts/out`).
2. Deploy `AgentProofQuorum([VerifierA, VerifierB], 2)` (Deployer).
3. Set testnet env (Vercel `agenttrace` project): new V3 address + deploy block in the firewall
   list, `AGENT_PROOF_QUORUM_ADDRESS`, keep `AGENT_PROOF_ADDRESS`. Redeploy preview, then production.
4. Create a V3 firewall for the showcase agent (Owner), with caps + recipient rules; run the MCP
   session and one demo execute (Executor); confirm the proof anchors via 2-of-2 (Verifier A + B).
5. Run `scripts/verify-proof.mjs` against the new tx: must print PASS.
6. Pause/deactivate testnet V2 firewall #1 (its Owner). V1 stays for the one-click demo until V3
   one-click is shipped.

### Phase 2: mainnet (only after Phase 1 is green)
1. Deploy `AgentFirewallV3` (Deployer, ≈0.335 MON) and `AgentProofQuorum` (Deployer, ≈0.123 MON).
   Record both in `contracts/deployments/mainnet-v3b.json`.
2. Multisig: create it; quorum `transferOwnership(multisig)` (Deployer) → `acceptOwnership()`
   (Multisig). Old quorum too, if it stays in use.
3. Env (Vercel `agenttrace-mainnet`): add the new V3 to the indexed firewall list; set
   `AGENT_PROOF_QUORUM_ADDRESS`. Redeploy production. Check that old proofs/pages still render.
4. Agent migration (per agent, its Owner signs):
   - WMON Agent #003: `createFirewallWithPermissions` on new V3 with WMON `transfer`/`approve`
     each with `setArgCap`, `setArgPeriodCap` and a recipient allowlist; fund the session executor.
   - Old V3 vault `0x909F…`: Owner calls `AgentVault.ownerCall(WMON, 0, transfer(newVault, 0.0006e18))`
     (or back to the owner). Then old V3 `deactivateFirewall(1)`.
   - Agents #001, #002, #004, #005 (V1): create V3 firewalls when they next need to act;
     deactivate their V1 firewalls after (no balances to move).
5. V1/V2 cleanup:
   - V2 firewall #1 (Owner sets permissions, Executor sends): `execute(1, WMON, 0, approve(0xB925…, 0))`
     to clear the 0.0005 WMON allowance (V2 allows `approve` with cap ≤0.001, so 0 is accepted),
     then `deactivateFirewall(1)`. No token balance to sweep.
   - V1 firewalls: re-check balances right before; if still 0, only `deactivateFirewall` each
     (Owner per agent). If a balance has appeared, sweep it with an Executor `transfer` through a
     firewall that allows it, sending to its owner.
6. Update the README deployments table: mark V1/V2/old V3/old quorum as "deprecated, kept for history".

## 4. Risks and rollback

| Risk | Mitigation / rollback |
|---|---|
| New V3 bug | Testnet first; contract tests in CI. Rollback = keep the old V3/V1 in the indexer list and point the SDK back (env + SDK default); nothing upgradeable to undo. |
| Indexer switch hides history | Phase 0 multi-address indexing **before** any env change; verify old proof pages render on preview. |
| Quorum liveness (2-of-2 means one missing verifier stalls anchoring) | Keep `AgentProof` single-verifier path as fallback until the quorum is reliable; consider 2-of-3. |
| Ownership to wrong multisig address | Two-step transfer: nothing changes until `acceptOwnership` from the multisig. |
| Monad gas billed on limit | Use estimates +10%, not large fixed limits. |
| Vault withdrawal to wrong address | Owner-only `ownerCall`; do a dry-run with `eth_call` first. |
| Session executor key leak | Session expiry (`validUntil`) + per-period caps + recipient allowlist bound loss. |

## 5. Effect on judging and public record

- Old contracts are immutable and stay readable forever. Old proofs, anchors and ERC-8004 feedback
  (and their hashes) are unaffected; `/outcomes/<id>` keeps serving the same bytes.
- Keep the old addresses in README/deployment JSON, labelled deprecated, so every link judges have
  seen still resolves. Phase 0 keeps them indexed in the app.
- Re-run `verify-proof.mjs` on one old and one new execution and link both in the README.

## 6. Decisions needed from the owner
1. Approve Phase 0 code PRs (no txs).
2. Who holds Verifier B long-term, and whether to move to 2-of-3.
3. Multisig signers/threshold.
4. Go/no-go for Phase 1 (testnet), then Phase 2 (mainnet ≈0.6–0.8 MON).
