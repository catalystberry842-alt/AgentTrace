import {
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  type Log,
  type TransactionReceipt,
} from "viem";
import { defineChain } from "viem";
import { getSql, type Sql } from "@/lib/db";
import { agentRegistryAbi } from "@/lib/chain/abi";
import { deployment } from "@/lib/chain/deployment";
import { readAddress } from "@/lib/chain/addresses.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { monadRpcUrl, monadTransport } from "@/lib/chain/rpc.server";
import { scanLogs } from "@/lib/chain/log-scan.server";
import { cacheKey, hydrateFromCache, recordScan } from "@/lib/chain/chain-cache.server";
import { capabilitiesFromChain } from "@/lib/agents/capabilities";
import type { AgentEvent, IndexedAgent, IndexerStatus, JsonValue } from "@/lib/agents/types";

export function getPublicClient() {
  const rpcUrl = monadRpcUrl();
  const monadChain = defineChain({
    id: MONAD_TESTNET.chainId,
    name: MONAD_TESTNET.name,
    nativeCurrency: { name: "MON", symbol: MONAD_TESTNET.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
    blockExplorers: {
      default: { name: "Monad Explorer", url: MONAD_TESTNET.explorerUrl },
    },
  });
  return createPublicClient({
    chain: monadChain,
    transport: monadTransport(),
  });
}
const SYNC_INTERVAL_MS = 15_000;

type SyncSlot = {
  at?: number;
  last?: IndexerStatus;
  inflight?: Promise<IndexerStatus>;
};

const slot = globalThis as typeof globalThis & { __agenttraceSync?: SyncSlot };

function syncSlot(): SyncSlot {
  slot.__agenttraceSync ??= {};
  return slot.__agenttraceSync;
}

export function configuredRegistry(): `0x${string}` | null {
  return readAddress(deployment.agentRegistry, "MONAD_TESTNET_AGENT_REGISTRY", "AGENT_REGISTRY_ADDRESS");
}

export function configuredDeployBlock(): number | null {
  const fromEnv = process.env.AGENT_REGISTRY_DEPLOY_BLOCK?.trim() ?? "";
  if (/^\d+$/.test(fromEnv)) return Number(fromEnv);
  return deployment.deployBlock;
}

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

function jsonArgs(value: unknown): { [key: string]: JsonValue } {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? item.toString() : item)),
  ) as { [key: string]: JsonValue };
}

export async function applyRegistryLog(sql: Sql, registry: string, log: Log): Promise<void> {
  if (!log.address || log.address.toLowerCase() !== registry.toLowerCase()) return;
  if (log.blockNumber == null || log.logIndex == null || !log.transactionHash) return;

  let decoded: { eventName: string; args: unknown };
  try {
    decoded = decodeEventLog({
      abi: agentRegistryAbi,
      data: log.data,
      topics: log.topics,
    }) as { eventName: string; args: unknown };
  } catch {
    return;
  }

  const args = decoded.args as Record<string, unknown>;
  const agentId =
    typeof args.agentId === "bigint"
      ? args.agentId.toString()
      : typeof args.agentId === "string"
        ? args.agentId
        : null;
  if (!agentId) throw new Error(`Indexer could not read agent id from ${decoded.eventName}`);

  const known =
    decoded.eventName === "AgentRegistered" ||
    decoded.eventName === "AgentUpdated" ||
    decoded.eventName === "AgentDeactivated";
  if (!known) return;

  const blockNumber = Number(log.blockNumber);
  const logIndex = Number(log.logIndex);
  const txHash = log.transactionHash.toLowerCase();
  const payload = jsonArgs(args);
  const chainCaps =
    decoded.eventName === "AgentDeactivated" ? null : capabilitiesFromChain(args.capabilities);

  const claimed = await sql<{ id: number }>`
    insert into indexed_events (
      chain_id, agent_id, event_name, block_number, tx_hash, log_index, payload
    ) values (
      ${MONAD_TESTNET.chainId},
      ${agentId},
      ${decoded.eventName},
      ${blockNumber},
      ${txHash},
      ${logIndex},
      ${JSON.stringify(payload)}::jsonb
    )
    on conflict (chain_id, tx_hash, log_index) do nothing
    returning id
  `;
  if (!claimed.length) return;

  try {
    if (decoded.eventName === "AgentRegistered") {
      const owner = String(args.owner).toLowerCase();
      const registeredAt = Number(args.registeredAt);
      await sql`
        insert into indexed_agents (
          chain_id, agent_id, owner, name, description, metadata_uri, capabilities,
          capability_bits, registered_at, registered_block, registration_log_index,
          active, tx_hash, chain_updated_at, updated_at
        ) values (
          ${MONAD_TESTNET.chainId},
          ${agentId},
          ${owner},
          ${String(args.name ?? "")},
          ${String(args.description ?? "")},
          ${String(args.metadataURI ?? "")},
          ${JSON.stringify(chainCaps?.names ?? [])}::jsonb,
          ${chainCaps?.bits ?? "0"},
          to_timestamp(${registeredAt}),
          ${blockNumber},
          ${logIndex},
          true,
          ${txHash},
          to_timestamp(${registeredAt}),
          now()
        )
        on conflict (chain_id, agent_id) do update set
          owner = excluded.owner,
          name = excluded.name,
          description = excluded.description,
          metadata_uri = excluded.metadata_uri,
          capabilities = excluded.capabilities,
          capability_bits = excluded.capability_bits,
          registered_at = excluded.registered_at,
          registered_block = excluded.registered_block,
          registration_log_index = excluded.registration_log_index,
          active = true,
          tx_hash = excluded.tx_hash,
          last_update_tx_hash = null,
          deactivation_tx_hash = null,
          chain_updated_at = excluded.chain_updated_at,
          updated_at = now()
      `;
    } else if (decoded.eventName === "AgentUpdated") {
      const updatedAt = Number(args.updatedAt);
      const updated = await sql<{ agent_id: string }>`
        update indexed_agents set
          name = ${String(args.name ?? "")},
          description = ${String(args.description ?? "")},
          metadata_uri = ${String(args.metadataURI ?? "")},
          capabilities = ${JSON.stringify(chainCaps?.names ?? [])}::jsonb,
          capability_bits = ${chainCaps?.bits ?? "0"},
          last_update_tx_hash = ${txHash},
          chain_updated_at = to_timestamp(${Number.isFinite(updatedAt) ? updatedAt : 0}),
          updated_at = now()
        where chain_id = ${MONAD_TESTNET.chainId} and agent_id = ${agentId}
        returning agent_id
      `;
      if (!updated.length) throw new Error(`AgentUpdated for unknown agent ${agentId}`);
    } else if (decoded.eventName === "AgentDeactivated") {
      const deactivatedAt = Number(args.deactivatedAt);
      const updated = await sql<{ agent_id: string }>`
        update indexed_agents set
          active = false,
          deactivation_tx_hash = ${txHash},
          chain_updated_at = to_timestamp(${Number.isFinite(deactivatedAt) ? deactivatedAt : 0}),
          updated_at = now()
        where chain_id = ${MONAD_TESTNET.chainId} and agent_id = ${agentId}
        returning agent_id
      `;
      if (!updated.length) throw new Error(`AgentDeactivated for unknown agent ${agentId}`);
    }
  } catch (err) {
    await sql`delete from indexed_events where id = ${claimed[0].id}`;
    throw err;
  }
}

export async function syncRegistry(force = false): Promise<IndexerStatus> {
  const registry = configuredRegistry();
  if (!registry) {
    return {
      status: "unconfigured",
      detail: "Agent Registry is not deployed. No identities are indexed.",
    };
  }
  const deployBlock = configuredDeployBlock();
  if (deployBlock == null) {
    return {
      status: "error",
      detail: "Registry address is set but the deployment block is unknown, so indexing has not started.",
    };
  }

  const state = syncSlot();
  const now = Date.now();
  if (!force && state.last && state.at && now - state.at < SYNC_INTERVAL_MS) return state.last;
  if (state.inflight) return state.inflight;

  state.inflight = (async () => {
    const client = getPublicClient();
    const sql = await getSql();
    const key = cacheKey(registry, deployBlock);
    await hydrateFromCache(sql, [
      { key, address: registry, apply: (log) => applyRegistryLog(sql, registry, log) },
    ]);
    const latest = Number(await client.getBlockNumber());
    if (deployBlock > latest) {
      throw new Error("Deployment block is ahead of the chain head.");
    }
    const rows = await sql<{ last_scanned_block: number | string }>`
      select last_scanned_block from indexer_state
      where chain_id = ${MONAD_TESTNET.chainId} and contract_address = ${registry}
    `;
    let from = rows[0] ? Number(rows[0].last_scanned_block) + 1 : deployBlock;
    if (from < deployBlock) from = deployBlock;

    const seen: Log[] = [];
    const scannedTo = await scanLogs({
      client,
      seen,
      address: registry,
      from,
      latest,
      apply: (log) => applyRegistryLog(sql, registry, log),
      saveCursor: async (to) => {
        await sql`
          insert into indexer_state (chain_id, contract_address, last_scanned_block, updated_at)
          values (${MONAD_TESTNET.chainId}, ${registry}, ${to}, now())
          on conflict (chain_id, contract_address) do update set
            last_scanned_block = excluded.last_scanned_block,
            updated_at = now()
        `;
      },
    });

    const result: IndexerStatus = {
      status: "ok",
      lastScannedBlock: Math.max(scannedTo, from - 1),
      latestBlock: latest,
    };
    await recordScan(key, seen, result.lastScannedBlock);
    // Still catching up: do not cache, so the next request continues from the saved cursor.
    if (result.lastScannedBlock < latest) return result;
    state.last = result;
    state.at = Date.now();
    return result;
  })().finally(() => {
    state.inflight = undefined;
  });

  return state.inflight;
}

export async function syncRegistrySafe(): Promise<IndexerStatus> {
  try {
    return await syncRegistry();
  } catch (err) {
    const result: IndexerStatus = {
      status: "error",
      detail: err instanceof Error ? err.message : "Indexer failed",
    };
    const state = syncSlot();
    state.last = result;
    state.at = Date.now();
    return result;
  }
}

type AgentRow = {
  agent_id: string;
  owner: string;
  name: string;
  description: string;
  metadata_uri: string;
  capabilities: unknown;
  capability_bits: string | null;
  registered_at: string | null;
  registered_block: number | string | null;
  registration_log_index: number | string | null;
  active: boolean;
  tx_hash: string | null;
  last_update_tx_hash: string | null;
  deactivation_tx_hash: string | null;
};

export function mapAgent(row: AgentRow): IndexedAgent {
  return {
    agentId: row.agent_id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    metadataURI: row.metadata_uri,
    capabilities: asStringList(row.capabilities),
    capabilityBits: row.capability_bits,
    registeredAt: row.registered_at,
    registeredBlock: row.registered_block == null ? null : Number(row.registered_block),
    registrationLogIndex: row.registration_log_index == null ? null : Number(row.registration_log_index),
    active: row.active,
    txHash: row.tx_hash,
    lastUpdateTxHash: row.last_update_tx_hash,
    deactivationTxHash: row.deactivation_tx_hash,
  };
}

export async function listIndexedAgents(limit = 100): Promise<IndexedAgent[]> {
  const sql = await getSql();
  const rows = await sql<AgentRow>`
    select agent_id, owner, name, description, metadata_uri, capabilities, capability_bits,
           registered_at::text as registered_at, registered_block, registration_log_index,
           active, tx_hash, last_update_tx_hash, deactivation_tx_hash
    from indexed_agents
    where chain_id = ${MONAD_TESTNET.chainId}
    order by agent_id::bigint asc
    limit ${limit}
  `;
  return rows.map(mapAgent);
}

export async function getIndexedAgent(agentId: string): Promise<IndexedAgent | null> {
  if (!/^\d+$/.test(agentId) || agentId === "0") return null;
  const sql = await getSql();
  const rows = await sql<AgentRow>`
    select agent_id, owner, name, description, metadata_uri, capabilities, capability_bits,
           registered_at::text as registered_at, registered_block, registration_log_index,
           active, tx_hash, last_update_tx_hash, deactivation_tx_hash
    from indexed_agents
    where chain_id = ${MONAD_TESTNET.chainId} and agent_id = ${agentId}
  `;
  return rows[0] ? mapAgent(rows[0]) : null;
}

export async function listAgentsByOwner(owner: string): Promise<IndexedAgent[]> {
  const sql = await getSql();
  const rows = await sql<AgentRow>`
    select agent_id, owner, name, description, metadata_uri, capabilities, capability_bits,
           registered_at::text as registered_at, registered_block, registration_log_index,
           active, tx_hash, last_update_tx_hash, deactivation_tx_hash
    from indexed_agents
    where chain_id = ${MONAD_TESTNET.chainId} and owner = ${owner.toLowerCase()}
    order by agent_id::bigint asc
    limit 100
  `;
  return rows.map(mapAgent);
}

export async function searchIndexedAgents(query: string): Promise<IndexedAgent[]> {
  const q = query.trim().toLowerCase().slice(0, 80);
  if (!q) return [];
  const sql = await getSql();
  const rows = await sql<AgentRow>`
    select agent_id, owner, name, description, metadata_uri, capabilities, capability_bits,
           registered_at::text as registered_at, registered_block, registration_log_index,
           active, tx_hash, last_update_tx_hash, deactivation_tx_hash
    from indexed_agents
    where chain_id = ${MONAD_TESTNET.chainId}
      and (
        agent_id = ${q}
        or owner = ${q}
        or position(${q} in lower(name)) > 0
        or position(${q} in lower(description)) > 0
      )
    order by agent_id::bigint asc
    limit 50
  `;
  return rows.map(mapAgent);
}

type EventRow = {
  event_name: string;
  block_number: number | string;
  tx_hash: string;
  log_index: number | string;
  payload: unknown;
};

export async function listAgentEvents(agentId: string, limit = 20): Promise<AgentEvent[]> {
  const sql = await getSql();
  const rows = await sql<EventRow>`
    select event_name, block_number, tx_hash, log_index, payload
    from indexed_events
    where chain_id = ${MONAD_TESTNET.chainId} and agent_id = ${agentId}
    order by block_number desc, log_index desc
    limit ${limit}
  `;
  return rows.map((row) => ({
    event: row.event_name,
    blockNumber: Number(row.block_number),
    txHash: row.tx_hash,
    logIndex: Number(row.log_index),
    args:
      (typeof row.payload === "string"
        ? (JSON.parse(row.payload) as { [key: string]: JsonValue })
        : (row.payload as { [key: string]: JsonValue })) ?? {},
  }));
}

export async function confirmRegistrationReceipt(
  sql: Sql,
  txHash: `0x${string}`,
): Promise<
  | { state: "pending" }
  | { state: "failed"; error: string }
  | { state: "registered"; agentId: string; owner: string; blockTimestamp: number }
> {
  const registry = configuredRegistry();
  if (!registry) {
    return { state: "failed", error: "Agent Registry is not configured." };
  }
  const client = getPublicClient();
  let receipt: TransactionReceipt | null = null;
  try {
    receipt = await client.getTransactionReceipt({ hash: txHash });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/not found|could not be found/i.test(message)) return { state: "pending" };
    throw err;
  }
  if (receipt.status !== "success") {
    return { state: "failed", error: "Transaction reverted on Monad. The agent was not registered." };
  }
  for (const log of receipt.logs) {
    await applyRegistryLog(sql, registry, log);
  }
  const rows = await sql<{ agent_id: string; owner: string }>`
    select agent_id, owner from indexed_agents
    where chain_id = ${MONAD_TESTNET.chainId} and tx_hash = ${txHash.toLowerCase()}
    order by agent_id::bigint desc
    limit 1
  `;
  const row = rows[0];
  if (!row) {
    return {
      state: "failed",
      error: "The transaction succeeded but no AgentRegistered event was found.",
    };
  }
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });
  return {
    state: "registered",
    agentId: row.agent_id,
    owner: row.owner,
    blockTimestamp: Number(block.timestamp),
  };
}

export function decodeRegisterCall(data: `0x${string}`): {
  name: string;
  description: string;
  metadataURI: string;
  capabilities: string[];
} | null {
  try {
    const decoded = decodeFunctionData({ abi: agentRegistryAbi, data });
    if (decoded.functionName !== "registerAgent") return null;
    const [name, description, metadataURI, capabilities] = decoded.args as readonly [
      string,
      string,
      string,
      bigint,
    ];
    return {
      name,
      description,
      metadataURI,
      capabilities: capabilitiesFromChain(capabilities).names,
    };
  } catch {
    return null;
  }
}
