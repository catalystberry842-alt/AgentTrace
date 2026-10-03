import { decodeEventLog, decodeFunctionData, type Log, type TransactionReceipt } from "viem";
import { getSql, type Sql } from "@/lib/db";
import { agentFirewallAbi } from "@/lib/chain/abi";
import { deployment } from "@/lib/chain/deployment";
import { readAddress } from "@/lib/chain/addresses.server";
import {
  applyRegistryLog,
  configuredDeployBlock,
  configuredRegistry,
  getPublicClient,
  syncRegistry,
} from "@/lib/chain/indexer.server";
import { cacheKey, hydrateFromCache, recordScan } from "@/lib/chain/chain-cache.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { scanLogs } from "@/lib/chain/log-scan.server";
import { ensureExecutedProof } from "@/lib/chain/proof-store";
import { publishDeveloperEvent } from "@/lib/developer/webhooks.server";
import type {
  FirewallAction,
  FirewallFunctionRule,
  FirewallRecord,
  FirewallTarget,
  IndexerStatus,
  JsonValue,
} from "@/lib/agents/types";

const SYNC_INTERVAL_MS = 15_000;

type SyncSlot = {
  at?: number;
  last?: IndexerStatus;
  inflight?: Promise<IndexerStatus>;
};

const slot = globalThis as typeof globalThis & { __agenttraceFirewallSync?: SyncSlot };

function syncSlot(): SyncSlot {
  slot.__agenttraceFirewallSync ??= {};
  return slot.__agenttraceFirewallSync;
}

export function configuredFirewall(): `0x${string}` | null {
  return readAddress(
    deployment.agentFirewall,
    "MONAD_TESTNET_AGENT_FIREWALL",
    "AGENT_FIREWALL_ADDRESS",
  );
}

export function configuredFirewallDeployBlock(): number | null {
  const fromEnv = process.env.AGENT_FIREWALL_DEPLOY_BLOCK?.trim() ?? "";
  if (/^\d+$/.test(fromEnv)) return Number(fromEnv);
  return deployment.firewallDeployBlock;
}

function asId(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return null;
}

function asAddr(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(value)) return null;
  return value.toLowerCase();
}

function asHex(value: unknown): string | null {
  if (typeof value !== "string" || !/^0x[a-fA-F0-9]+$/.test(value)) return null;
  return value.toLowerCase();
}

function asUint(value: unknown): string | null {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return String(value);
  return null;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true";
}

function jsonArgs(value: unknown): { [key: string]: JsonValue } {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as { [key: string]: JsonValue };
}

function firewallStatus(active: boolean, paused: boolean): FirewallRecord["status"] {
  if (!active) return "inactive";
  if (paused) return "paused";
  return "active";
}

const KNOWN = new Set([
  "FirewallCreated",
  "ExecutorUpdated",
  "TargetAllowed",
  "TargetDisabled",
  "FunctionAllowed",
  "FunctionDisabled",
  "AgentAction",
  "FirewallPaused",
  "FirewallUnpaused",
  "FirewallDeactivated",
  "PolicyUpdated",
  "FirewallOwnerSynced",
]);

export async function applyFirewallLog(sql: Sql, firewall: string, log: Log): Promise<boolean> {
  if (!log.address || log.address.toLowerCase() !== firewall.toLowerCase()) return false;
  if (log.blockNumber == null || log.logIndex == null || !log.transactionHash) return false;

  let decoded: { eventName: string; args: unknown };
  try {
    decoded = decodeEventLog({
      abi: agentFirewallAbi,
      data: log.data,
      topics: log.topics,
    }) as { eventName: string; args: unknown };
  } catch {
    return false;
  }
  if (!KNOWN.has(decoded.eventName)) return false;

  const args = decoded.args as Record<string, unknown>;
  const firewallId = asId(args.firewallId);
  const agentIdFromEvent = asId(args.agentId);
  if (!firewallId) throw new Error(`${decoded.eventName} is missing a firewall id`);

  let agentId = agentIdFromEvent;
  if (!agentId) {
    const found = await sql<{ agent_id: string }>`
      select agent_id from indexed_firewalls
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${firewallId}
    `;
    if (!found.length) throw new Error(`${decoded.eventName} for unknown firewall ${firewallId}`);
    agentId = found[0].agent_id;
  }

  const blockNumber = Number(log.blockNumber);
  const logIndex = Number(log.logIndex);
  const txHash = log.transactionHash.toLowerCase();
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
      ${JSON.stringify(jsonArgs(args))}::jsonb
    )
    on conflict (chain_id, tx_hash, log_index) do nothing
    returning id
  `;
  if (!claimed.length) return true;

  try {
    await mutate(sql, decoded.eventName, args, {
      firewallId,
      agentId,
      blockNumber,
      logIndex,
      txHash,
    });
  } catch (err) {
    await sql`delete from indexed_events where id = ${claimed[0].id}`;
    throw err;
  }
  return true;
}

async function requireRow(sql: Sql, firewallId: string, event: string): Promise<void> {
  const rows = await sql<{ firewall_id: string }>`
    select firewall_id from indexed_firewalls
    where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${firewallId}
  `;
  if (!rows.length) throw new Error(`${event} for unknown firewall ${firewallId}`);
}

async function mutate(
  sql: Sql,
  event: string,
  args: Record<string, unknown>,
  ctx: {
    firewallId: string;
    agentId: string;
    blockNumber: number;
    logIndex: number;
    txHash: string;
  },
): Promise<void> {
  const nowTs = asUint(args.timestamp) ?? "0";
  if (event === "FirewallCreated") {
    const owner = asAddr(args.owner);
    const executor = asAddr(args.executor);
    const maxTx = asUint(args.maxValuePerTransaction);
    const maxPeriod = asUint(args.maxValuePerPeriod);
    const period = asUint(args.periodDuration);
    if (!owner || !executor || !maxTx || !maxPeriod || !period) {
      throw new Error("FirewallCreated is missing policy fields");
    }
    await sql`
      insert into indexed_firewalls (
        chain_id, firewall_id, agent_id, owner, executor, active, paused, created_at,
        execution_nonce, allow_value_transfer, max_value_per_tx, max_value_per_period,
        spent_in_period, period_start_unix, period_duration, creation_tx_hash, updated_at
      ) values (
        ${MONAD_TESTNET.chainId},
        ${ctx.firewallId},
        ${ctx.agentId},
        ${owner},
        ${executor},
        true,
        false,
        to_timestamp(${Number(nowTs)}),
        '0',
        ${asBool(args.allowValueTransfer)},
        ${maxTx},
        ${maxPeriod},
        '0',
        ${nowTs},
        ${period},
        ${ctx.txHash},
        now()
      )
      on conflict (chain_id, firewall_id) do update set
        agent_id = excluded.agent_id,
        owner = excluded.owner,
        executor = excluded.executor,
        active = true,
        paused = false,
        created_at = excluded.created_at,
        execution_nonce = '0',
        allow_value_transfer = excluded.allow_value_transfer,
        max_value_per_tx = excluded.max_value_per_tx,
        max_value_per_period = excluded.max_value_per_period,
        spent_in_period = '0',
        period_start_unix = excluded.period_start_unix,
        period_duration = excluded.period_duration,
        creation_tx_hash = excluded.creation_tx_hash,
        updated_at = now()
    `;
    return;
  }

  await requireRow(sql, ctx.firewallId, event);

  if (event === "ExecutorUpdated") {
    const executor = asAddr(args.executor);
    if (!executor) throw new Error("ExecutorUpdated is missing an executor");
    await sql`
      update indexed_firewalls
      set executor = ${executor}, updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "TargetAllowed") {
    const target = asAddr(args.target);
    if (!target) throw new Error("TargetAllowed is missing a target");
    const name = String(args.name ?? "").slice(0, 64);
    await sql`
      insert into firewall_targets (chain_id, firewall_id, target, name, active)
      values (${MONAD_TESTNET.chainId}, ${ctx.firewallId}, ${target}, ${name}, true)
      on conflict (chain_id, firewall_id, target) do update set name = excluded.name, active = true
    `;
    return;
  }

  if (event === "TargetDisabled") {
    const target = asAddr(args.target);
    if (!target) throw new Error("TargetDisabled is missing a target");
    await sql`
      update firewall_targets set active = false
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId} and target = ${target}
    `;
    return;
  }

  if (event === "FunctionAllowed" || event === "FunctionDisabled") {
    const target = asAddr(args.target);
    const selector = asHex(args.selector);
    if (!target || !selector) throw new Error(`${event} is missing a target or selector`);
    await sql`
      insert into firewall_functions (chain_id, firewall_id, target, selector, active)
      values (
        ${MONAD_TESTNET.chainId},
        ${ctx.firewallId},
        ${target},
        ${selector},
        ${event === "FunctionAllowed"}
      )
      on conflict (chain_id, firewall_id, target, selector) do update set active = excluded.active
    `;
    return;
  }

  if (event === "FirewallPaused") {
    await sql`
      update indexed_firewalls set paused = true, updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "FirewallUnpaused") {
    await sql`
      update indexed_firewalls set paused = false, updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "FirewallDeactivated") {
    await sql`
      update indexed_firewalls set active = false, updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "PolicyUpdated") {
    const maxTx = asUint(args.maxValuePerTransaction);
    const maxPeriod = asUint(args.maxValuePerPeriod);
    const period = asUint(args.periodDuration);
    if (!maxTx || !maxPeriod || !period) throw new Error("PolicyUpdated is missing policy fields");
    await sql`
      update indexed_firewalls set
        allow_value_transfer = ${asBool(args.allowValueTransfer)},
        max_value_per_tx = ${maxTx},
        max_value_per_period = ${maxPeriod},
        period_duration = ${period},
        spent_in_period = '0',
        period_start_unix = ${nowTs},
        updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "FirewallOwnerSynced") {
    const owner = asAddr(args.owner);
    if (!owner) throw new Error("FirewallOwnerSynced is missing an owner");
    await sql`
      update indexed_firewalls set owner = ${owner}, updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    return;
  }

  if (event === "AgentAction") {
    const executor = asAddr(args.executor);
    const target = asAddr(args.target);
    const selector = asHex(args.functionSelector);
    const value = asUint(args.value);
    const nonce = asUint(args.executionNonce);
    const executionId = asHex(args.executionId);
    const calldataHash = asHex(args.calldataHash);
    if (!executor || !target || !selector || !value || !nonce || !executionId || !calldataHash) {
      throw new Error("AgentAction is missing execution fields");
    }
    const current = await sql<{
      spent_in_period: string;
      period_start_unix: string;
      period_duration: string;
      execution_nonce: string;
    }>`
      select spent_in_period, period_start_unix, period_duration, execution_nonce
      from indexed_firewalls
      where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = ${ctx.firewallId}
    `;
    const row = current[0];
    if (!row) throw new Error(`AgentAction for unknown firewall ${ctx.firewallId}`);
    let spent = BigInt(row.spent_in_period || "0");
    let periodStart = BigInt(row.period_start_unix || "0");
    const duration = BigInt(row.period_duration || "0");
    const timestamp = BigInt(nowTs);
    const amount = BigInt(value);
    if (amount > 0n) {
      if (timestamp >= periodStart + duration) {
        spent = 0n;
        periodStart = timestamp;
      }
      spent += amount;
    }
    const nextNonce = BigInt(nonce) + 1n;
    const storedNonce = BigInt(row.execution_nonce || "0");
    const nonceOut = (nextNonce > storedNonce ? nextNonce : storedNonce).toString();
    const written = await sql<{ execution_id: string }>`
      with inserted as (
        insert into firewall_actions (
          chain_id, execution_id, firewall_id, agent_id, executor, target, selector, value,
          execution_nonce, calldata_hash, executed_at, tx_hash, log_index, block_number
        ) values (
          ${MONAD_TESTNET.chainId},
          ${executionId},
          ${ctx.firewallId},
          ${ctx.agentId},
          ${executor},
          ${target},
          ${selector},
          ${value},
          ${nonce},
          ${calldataHash},
          to_timestamp(${Number(nowTs)}),
          ${ctx.txHash},
          ${ctx.logIndex},
          ${ctx.blockNumber}
        )
        on conflict (chain_id, execution_id) do nothing
        returning execution_id
      )
      update indexed_firewalls set
        execution_nonce = ${nonceOut},
        spent_in_period = ${spent.toString()},
        period_start_unix = ${periodStart.toString()},
        updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId}
        and firewall_id = ${ctx.firewallId}
        and exists (select 1 from inserted)
      returning (select execution_id from inserted) as execution_id
    `;
    if (!written.length) {
      const existing = await sql<{ execution_id: string }>`
        select execution_id from firewall_actions
        where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId}
      `;
      if (!existing.length) throw new Error(`AgentAction ${executionId} was not stored`);
    } else {
      try {
        await publishDeveloperEvent("execution.executed", {
          executionId,
          agentId: ctx.agentId,
          firewallId: ctx.firewallId,
          transactionHash: ctx.txHash,
        });
      } catch (err) {
        console.error("[agenttrace-webhook]", err);
      }
    }
    await ensureExecutedProof(sql, {
      executionId,
      agentId: ctx.agentId,
      firewallId: ctx.firewallId,
      executor,
      target,
      selector,
      value,
      calldataHash,
      txHash: ctx.txHash,
      blockNumber: ctx.blockNumber,
      timestampUnix: Number(nowTs),
    });
  }
}

export async function syncFirewall(force = false, budgetMs?: number): Promise<IndexerStatus> {
  const firewall = configuredFirewall();
  if (!firewall) {
    return {
      status: "unconfigured",
      detail: "Agent Firewall is not deployed. No firewalls are indexed.",
    };
  }
  const deployBlock = configuredFirewallDeployBlock();
  if (deployBlock == null) {
    return {
      status: "error",
      detail:
        "Firewall address is set but the deployment block is unknown, so indexing has not started.",
    };
  }

  const state = syncSlot();
  const now = Date.now();
  if (!force && state.last && state.at && now - state.at < SYNC_INTERVAL_MS) return state.last;
  if (state.inflight) return state.inflight;

  state.inflight = (async () => {
    const client = getPublicClient();
    const sql = await getSql();
    const key = cacheKey(firewall, deployBlock);
    const registry = configuredRegistry();
    const registryBlock = configuredDeployBlock();
    await hydrateFromCache(sql, [
      ...(registry && registryBlock != null
        ? [
            {
              key: cacheKey(registry, registryBlock),
              address: registry,
              apply: (log: Log) => applyRegistryLog(sql, registry, log),
            },
          ]
        : []),
      { key, address: firewall, apply: (log: Log) => applyFirewallLog(sql, firewall, log) },
    ]);
    const latest = Number(await client.getBlockNumber());
    if (deployBlock > latest)
      throw new Error("Firewall deployment block is ahead of the chain head.");
    const rows = await sql<{ last_scanned_block: number | string }>`
      select last_scanned_block from indexer_state
      where chain_id = ${MONAD_TESTNET.chainId} and contract_address = ${firewall}
    `;
    let from = rows[0] ? Number(rows[0].last_scanned_block) + 1 : deployBlock;
    if (from < deployBlock) from = deployBlock;
    const seen: Log[] = [];
    const scannedTo = await scanLogs({
      client,
      seen,
      budgetMs,
      address: firewall,
      from,
      latest,
      apply: (log) => applyFirewallLog(sql, firewall, log),
      saveCursor: async (to) => {
        await sql`
          insert into indexer_state (chain_id, contract_address, last_scanned_block, updated_at)
          values (${MONAD_TESTNET.chainId}, ${firewall}, ${to}, now())
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

/** Scan firewall history until `target` is covered, with a longer budget than a page sync. */
async function catchUpFirewall(target: number): Promise<void> {
  const deadline = Date.now() + 25_000;
  for (;;) {
    const status = await syncFirewall(true, 8_000);
    if (status.status !== "ok" || status.lastScannedBlock >= target || Date.now() > deadline) return;
  }
}

export async function syncFirewallSafe(): Promise<IndexerStatus> {
  try {
    if (configuredRegistry()) await syncRegistry().catch(() => undefined);
    const status = await syncFirewall();
    // Executions replayed into a fresh database start as "executed". Re-run the receipt check for a
    // few of them so verified status does not depend on which server instance answered.
    const { settlePendingProofs } = await import("@/lib/chain/proof.server");
    await settlePendingProofs(6).catch(() => undefined);
    const { replayOutcomeRequests } = await import("@/lib/developer/outcome.server");
    await replayOutcomeRequests().catch(() => undefined);
    return status;
  } catch (err) {
    const result: IndexerStatus = {
      status: "error",
      detail: err instanceof Error ? err.message : "Firewall indexer failed",
    };
    const state = syncSlot();
    state.last = result;
    state.at = Date.now();
    return result;
  }
}

type FirewallRow = {
  firewall_id: string;
  agent_id: string;
  agent_name: string | null;
  owner: string;
  executor: string;
  active: boolean;
  paused: boolean;
  created_at: string | null;
  execution_nonce: string;
  allow_value_transfer: boolean;
  max_value_per_tx: string;
  max_value_per_period: string;
  spent_in_period: string;
  period_start_unix: string;
  period_duration: string;
  creation_tx_hash: string | null;
};

function mapFirewall(
  row: FirewallRow,
  targets: FirewallTarget[],
  functions: FirewallFunctionRule[],
): FirewallRecord {
  return {
    id: row.firewall_id,
    agentId: row.agent_id,
    agentName: row.agent_name ?? "",
    owner: row.owner,
    executor: row.executor,
    active: row.active,
    paused: row.paused,
    status: firewallStatus(row.active, row.paused),
    createdAt: row.created_at,
    executionNonce: row.execution_nonce,
    allowValueTransfer: row.allow_value_transfer,
    maxValuePerTransaction: row.max_value_per_tx,
    maxValuePerPeriod: row.max_value_per_period,
    spentInPeriod: row.spent_in_period,
    periodStartUnix: row.period_start_unix,
    periodDuration: row.period_duration,
    creationTxHash: row.creation_tx_hash,
    allowedTargets: targets,
    allowedFunctions: functions,
  };
}

async function attachRules(rows: FirewallRow[]): Promise<FirewallRecord[]> {
  if (!rows.length) return [];
  const sql = await getSql();
  const ids = rows.map((row) => row.firewall_id);
  const targets = await sql<{ firewall_id: string; target: string; name: string; active: boolean }>`
    select firewall_id, target, name, active from firewall_targets
    where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = any(${ids}::text[])
    order by target asc
  `;
  const functions = await sql<{
    firewall_id: string;
    target: string;
    selector: string;
    active: boolean;
  }>`
    select firewall_id, target, selector, active from firewall_functions
    where chain_id = ${MONAD_TESTNET.chainId} and firewall_id = any(${ids}::text[])
    order by target asc, selector asc
  `;
  return rows.map((row) =>
    mapFirewall(
      row,
      targets
        .filter((item) => item.firewall_id === row.firewall_id)
        .map((item) => ({ target: item.target, name: item.name, active: item.active })),
      functions
        .filter((item) => item.firewall_id === row.firewall_id)
        .map((item) => ({ target: item.target, selector: item.selector, active: item.active })),
    ),
  );
}

export async function listIndexedFirewalls(limit = 100): Promise<FirewallRecord[]> {
  const sql = await getSql();
  const rows = await sql<FirewallRow>`
    select f.firewall_id, f.agent_id, a.name as agent_name, f.owner, f.executor, f.active, f.paused,
           f.created_at::text as created_at, f.execution_nonce, f.allow_value_transfer,
           f.max_value_per_tx, f.max_value_per_period, f.spent_in_period, f.period_start_unix,
           f.period_duration, f.creation_tx_hash
    from indexed_firewalls f
    left join indexed_agents a on a.chain_id = f.chain_id and a.agent_id = f.agent_id
    where f.chain_id = ${MONAD_TESTNET.chainId}
    order by f.firewall_id::bigint asc
    limit ${limit}
  `;
  return attachRules(rows);
}

export async function getIndexedFirewall(firewallId: string): Promise<FirewallRecord | null> {
  if (!/^[1-9]\d*$/.test(firewallId)) return null;
  const sql = await getSql();
  const rows = await sql<FirewallRow>`
    select f.firewall_id, f.agent_id, a.name as agent_name, f.owner, f.executor, f.active, f.paused,
           f.created_at::text as created_at, f.execution_nonce, f.allow_value_transfer,
           f.max_value_per_tx, f.max_value_per_period, f.spent_in_period, f.period_start_unix,
           f.period_duration, f.creation_tx_hash
    from indexed_firewalls f
    left join indexed_agents a on a.chain_id = f.chain_id and a.agent_id = f.agent_id
    where f.chain_id = ${MONAD_TESTNET.chainId} and f.firewall_id = ${firewallId}
  `;
  const mapped = await attachRules(rows);
  return mapped[0] ?? null;
}

export async function listFirewallsByAgent(agentId: string): Promise<FirewallRecord[]> {
  if (!/^[1-9]\d*$/.test(agentId)) return [];
  const sql = await getSql();
  const rows = await sql<FirewallRow>`
    select f.firewall_id, f.agent_id, a.name as agent_name, f.owner, f.executor, f.active, f.paused,
           f.created_at::text as created_at, f.execution_nonce, f.allow_value_transfer,
           f.max_value_per_tx, f.max_value_per_period, f.spent_in_period, f.period_start_unix,
           f.period_duration, f.creation_tx_hash
    from indexed_firewalls f
    left join indexed_agents a on a.chain_id = f.chain_id and a.agent_id = f.agent_id
    where f.chain_id = ${MONAD_TESTNET.chainId} and f.agent_id = ${agentId}
    order by f.firewall_id::bigint asc
  `;
  return attachRules(rows);
}

function mapAction(row: {
  execution_id: string;
  firewall_id: string;
  agent_id: string;
  executor: string;
  target: string;
  selector: string;
  value: string;
  execution_nonce: string;
  calldata_hash: string;
  executed_at: string | null;
  tx_hash: string;
  block_number: number | string;
  verification_status: string | null;
  anchored: boolean | null;
}): FirewallAction {
  return {
    executionId: row.execution_id,
    firewallId: row.firewall_id,
    agentId: row.agent_id,
    executor: row.executor,
    target: row.target,
    selector: row.selector,
    value: row.value,
    executionNonce: row.execution_nonce,
    calldataHash: row.calldata_hash,
    timestamp: row.executed_at,
    txHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    proofStatus: row.verification_status,
    anchored: Boolean(row.anchored),
  };
}

export async function listFirewallActions(
  firewallId: string,
  limit = 50,
): Promise<FirewallAction[]> {
  const sql = await getSql();
  const rows = await sql<Parameters<typeof mapAction>[0]>`
    select a.execution_id, a.firewall_id, a.agent_id, a.executor, a.target, a.selector, a.value,
           a.execution_nonce, a.calldata_hash, a.executed_at::text as executed_at, a.tx_hash, a.block_number,
           p.verification_status, p.anchored
    from firewall_actions a
    left join execution_proofs p on p.chain_id = a.chain_id and p.execution_id = a.execution_id
    where a.chain_id = ${MONAD_TESTNET.chainId} and a.firewall_id = ${firewallId}
    order by a.block_number asc, a.log_index asc
    limit ${limit}
  `;
  return rows.map(mapAction);
}

export async function listActionsByAgent(agentId: string, limit = 50): Promise<FirewallAction[]> {
  const sql = await getSql();
  const rows = await sql<Parameters<typeof mapAction>[0]>`
    select a.execution_id, a.firewall_id, a.agent_id, a.executor, a.target, a.selector, a.value,
           a.execution_nonce, a.calldata_hash, a.executed_at::text as executed_at, a.tx_hash, a.block_number,
           p.verification_status, p.anchored
    from firewall_actions a
    left join execution_proofs p on p.chain_id = a.chain_id and p.execution_id = a.execution_id
    where a.chain_id = ${MONAD_TESTNET.chainId} and a.agent_id = ${agentId}
    order by a.block_number asc, a.log_index asc
    limit ${limit}
  `;
  return rows.map(mapAction);
}

export function decodeCreateFirewallCall(data: `0x${string}`): {
  agentId: string;
  executor: string;
  allowValueTransfer: boolean;
  maxValuePerTransaction: string;
  maxValuePerPeriod: string;
  periodDuration: string;
} | null {
  try {
    const decoded = decodeFunctionData({ abi: agentFirewallAbi, data });
    if (decoded.functionName !== "createFirewall") return null;
    const [agentId, executor, allowValueTransfer, maxTx, maxPeriod, period] = decoded.args;
    return {
      agentId: agentId.toString(),
      executor: executor.toLowerCase(),
      allowValueTransfer,
      maxValuePerTransaction: maxTx.toString(),
      maxValuePerPeriod: maxPeriod.toString(),
      periodDuration: period.toString(),
    };
  } catch {
    return null;
  }
}

export async function ingestFirewallReceipt(
  sql: Sql,
  txHash: `0x${string}`,
): Promise<
  | { state: "pending" }
  | { state: "reverted"; error: string }
  | { state: "indexed"; firewallIds: string[]; executionIds: string[] }
  | { state: "empty"; error: string }
> {
  const firewall = configuredFirewall();
  if (!firewall) {
    return { state: "empty", error: "Agent Firewall is not deployed. No transaction was sent." };
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
    return {
      state: "reverted",
      error: "Transaction reverted on Monad. The firewall was not changed.",
    };
  }
  const logs = receipt.logs.filter((log) => log.address.toLowerCase() === firewall);
  if (!logs.length) {
    return {
      state: "empty",
      error: "The transaction confirmed but it did not emit a firewall event.",
    };
  }
  const ids = new Set<string>();
  const executions = new Set<string>();
  for (const log of logs) {
    try {
      await applyFirewallLog(sql, firewall, log);
    } catch (err) {
      // This instance has not indexed the firewall yet (serverless instances do not share a
      // database). Catch the indexer up to the block before this receipt, then apply again.
      if (!(err instanceof Error && /unknown firewall/.test(err.message))) throw err;
      await catchUpFirewall(Number(receipt.blockNumber) - 1);
      await applyFirewallLog(sql, firewall, log);
    }
    try {
      const decoded = decodeEventLog({ abi: agentFirewallAbi, data: log.data, topics: log.topics });
      const args = decoded.args as { firewallId?: unknown; executionId?: unknown };
      const firewallId = asId(args.firewallId);
      if (firewallId) ids.add(firewallId);
      if (decoded.eventName === "AgentAction" && typeof args.executionId === "string") {
        executions.add(args.executionId.toLowerCase());
      }
    } catch {
      // already skipped inside apply
    }
  }
  return { state: "indexed", firewallIds: [...ids], executionIds: [...executions] };
}
