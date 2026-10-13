import { getPublicClient } from "@/lib/chain/indexer.server";
import { configuredRegistry } from "@/lib/chain/indexer.server";
import { configuredFirewall, syncFirewallSafe } from "@/lib/chain/firewall.server";
import { configuredProofAnchor } from "@/lib/chain/proof.server";
import { agentFirewallAbi, agentRegistryAbi } from "@/lib/chain/abi";
import { getSql } from "@/lib/db";
import { IS_MAINNET, MONAD_TESTNET } from "@/lib/chain/network";
import { monadRpcUrl } from "@/lib/chain/rpc.server";
import type { LiveStats, VerifyResult } from "@/lib/agents/live";
// The independent checker shipped for judges; the box below runs the very same code.
import { verifyProof } from "../../../scripts/verify-proof.mjs";

const TTL_MS = 10_000;
let cached: { at: number; value: LiveStats } | null = null;
let inflight: Promise<LiveStats> | null = null;
let proofCounts: { verified: number; anchored: number } | null = null;
let syncing: Promise<void> | null = null;

async function countProofs() {
  const sql = await getSql();
  const rows = await sql<{ verified: number; anchored: number }>`
    select count(*) filter (where verification_status = 'receipt_verified')::int as verified,
           count(*) filter (where anchored)::int as anchored
    from execution_proofs where chain_id = ${MONAD_TESTNET.chainId}
  `;
  const row = rows[0];
  if (row && (row.verified > 0 || row.anchored > 0)) proofCounts = { verified: row.verified, anchored: row.anchored };
}

/** Refresh the proof index in the background; a cold instance never blocks the landing page on it. */
function refreshProofIndex() {
  syncing ??= syncFirewallSafe()
    .then(async () => {
      const { settlePendingProofs } = await import("@/lib/chain/proof.server");
      await settlePendingProofs(1).catch(() => undefined);
      await countProofs();
    })
    .catch(() => undefined)
    .finally(() => {
      syncing = null;
    });
  return syncing;
}

async function read(): Promise<LiveStats> {
  const client = getPublicClient();
  const registry = configuredRegistry();
  const firewall = configuredFirewall();
  const [nextAgent, nextFirewall, block] = await Promise.all([
    registry ? client.readContract({ address: registry, abi: agentRegistryAbi, functionName: "nextAgentId" }).catch(() => null) : null,
    firewall ? client.readContract({ address: firewall, abi: agentFirewallAbi, functionName: "nextFirewallId" }).catch(() => null) : null,
    client.getBlockNumber().catch(() => null),
  ]);
  // Wait briefly for the proof index; if it is still cold, report what is known now.
  await Promise.race([refreshProofIndex(), new Promise((resolve) => setTimeout(resolve, 2500))]);
  if (!proofCounts) await countProofs().catch(() => undefined);
  return {
    agents: typeof nextAgent === "bigint" ? Number(nextAgent) - 1 : null,
    firewalls: typeof nextFirewall === "bigint" ? Number(nextFirewall) - 1 : null,
    verifiedExecutions: proofCounts?.verified ?? null,
    anchoredProofs: proofCounts?.anchored ?? null,
    latestBlock: typeof block === "bigint" ? Number(block) : null,
    readAt: new Date().toISOString(),
  };
}

export async function readLiveStats(): Promise<LiveStats> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  inflight ??= read()
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function recomputeProof(id: string): Promise<VerifyResult> {
  const log: string[] = [];
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) {
    return { pass: false, executionId: null, proofHash: null, checks: [], log, error: "Enter a 32-byte 0x… execution id or transaction hash." };
  }
  try {
    const result = (await verifyProof({
      id,
      chain: IS_MAINNET ? "mainnet" : "testnet",
      rpc: monadRpcUrl(),
      firewall: configuredFirewall() ?? undefined,
      proof: configuredProofAnchor() ?? undefined,
      log: (line: string) => log.push(line),
    })) as { pass: boolean; checks: { name: string; ok: boolean }[]; proofHash?: string; executionId?: string };
    return { pass: result.pass, executionId: result.executionId ?? null, proofHash: result.proofHash ?? null, checks: result.checks, log, error: null };
  } catch (err) {
    const message = err instanceof Error ? ((err as { shortMessage?: string }).shortMessage ?? err.message) : "Verification failed.";
    return { pass: false, executionId: null, proofHash: null, checks: [], log, error: message.split("\n")[0] };
  }
}
