import { getSql } from "@/lib/db";
import { configuredDemoProtocol } from "@/lib/chain/addresses.server";
import { deployment } from "@/lib/chain/deployment";
import {
  configuredDeployBlock,
  configuredRegistry,
  getPublicClient,
} from "@/lib/chain/indexer.server";
import { configuredFirewall, configuredFirewallDeployBlock } from "@/lib/chain/firewall.server";
import { configuredProofAnchor } from "@/lib/chain/proof.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import type { ChainStatus, IntentStatus, RegistrationIntent } from "./types";

type IntentRow = {
  id: string;
  name: string;
  description: string;
  capabilities: unknown;
  metadata_uri: string;
  owner_address: string | null;
  status: IntentStatus;
  tx_hash: string | null;
  chain_agent_id: string | null;
  error: string | null;
  created_at: string;
};

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch {
      return [];
    }
  }
  return [];
}

export function mapIntent(row: IntentRow): RegistrationIntent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    capabilities: asStringList(row.capabilities),
    metadataURI: row.metadata_uri,
    ownerAddress: row.owner_address,
    status: row.status,
    txHash: row.tx_hash,
    chainAgentId: row.chain_agent_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

export async function listIntentsForUser(userId: string): Promise<RegistrationIntent[]> {
  const sql = await getSql();
  const rows = await sql<IntentRow>`
    select id, name, description, capabilities, metadata_uri, owner_address, status,
           tx_hash, chain_agent_id, error, created_at::text as created_at
    from registration_intents
    where user_id = ${userId}
    order by created_at desc
  `;
  return rows.map(mapIntent);
}

export async function getIntentForUser(
  userId: string,
  id: string,
): Promise<RegistrationIntent | null> {
  const sql = await getSql();
  const rows = await sql<IntentRow>`
    select id, name, description, capabilities, metadata_uri, owner_address, status,
           tx_hash, chain_agent_id, error, created_at::text as created_at
    from registration_intents
    where user_id = ${userId} and id = ${id}
  `;
  return rows[0] ? mapIntent(rows[0]) : null;
}

export async function readChainStatus(): Promise<ChainStatus> {
  const registry = configuredRegistry();
  const sql = await getSql();
  let rpcOk = false;
  let chainIdSeen: number | null = null;
  let rpcError: string | null = null;
  try {
    chainIdSeen = await getPublicClient().getChainId();
    rpcOk = chainIdSeen === MONAD_TESTNET.chainId;
    if (!rpcOk) rpcError = `RPC returned chain id ${chainIdSeen}, expected ${MONAD_TESTNET.chainId}.`;
  } catch (err) {
    rpcError = err instanceof Error ? err.message : "RPC request failed";
  }

  const counts = await sql<{ count: number }>`
    select count(*)::int as count from indexed_agents where chain_id = ${MONAD_TESTNET.chainId}
  `;
  const firewallCounts = await sql<{ count: number }>`
    select count(*)::int as count from indexed_firewalls where chain_id = ${MONAD_TESTNET.chainId}
  `;
  const proofCounts = await sql<{ count: number }>`
    select count(*)::int as count from execution_proofs where chain_id = ${MONAD_TESTNET.chainId}
  `;
  let lastScannedBlock: number | null = null;
  if (registry) {
    const cursor = await sql<{ last_scanned_block: number | string }>`
      select last_scanned_block from indexer_state
      where chain_id = ${MONAD_TESTNET.chainId} and contract_address = ${registry}
    `;
    lastScannedBlock = cursor[0] ? Number(cursor[0].last_scanned_block) : null;
  }
  return {
    chainId: MONAD_TESTNET.chainId,
    chainName: MONAD_TESTNET.name,
    rpcUrl: MONAD_TESTNET.rpcUrl,
    explorerUrl: MONAD_TESTNET.explorerUrl,
    registry,
    deployBlock: configuredDeployBlock() ?? deployment.deployBlock,
    deployTx: deployment.deployTx,
    firewall: configuredFirewall(),
    firewallDeployBlock: configuredFirewallDeployBlock() ?? deployment.firewallDeployBlock,
    firewallDeployTx: deployment.firewallDeployTx,
    rpcOk,
    chainIdSeen,
    rpcError,
    indexedAgents: Number(counts[0]?.count ?? 0),
    indexedFirewalls: Number(firewallCounts[0]?.count ?? 0),
    indexedProofs: Number(proofCounts[0]?.count ?? 0),
    proofAnchor: configuredProofAnchor(),
    demoProtocol: configuredDemoProtocol(),
    lastScannedBlock,
  };
}
