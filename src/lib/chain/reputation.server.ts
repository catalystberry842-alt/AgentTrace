import { getSql } from "@/lib/db";
import { HISTORY_METHOD } from "@/lib/agents/history-copy";
import { MONAD_TESTNET } from "@/lib/chain/network";
import type {
  AgentActivityItem,
  AgentReputation,
  HistoryEntry,
  HistoryFlag,
  OutcomeRecord,
  OutcomeStatus,
} from "@/lib/agents/types";

export { HISTORY_METHOD };

const chain = MONAD_TESTNET.chainId;

function page(limit?: number, offset?: number): { limit: number; offset: number } {
  const size = Math.min(100, Math.max(1, Math.floor(limit ?? 50)));
  const start = Math.max(0, Math.floor(offset ?? 0));
  return { limit: size, offset: start };
}

function links(agentId: string): AgentReputation["links"] {
  return {
    executions: `/agents/${agentId}/activity`,
    proofs: `/agents/${agentId}/proofs`,
    outcomes: `/agents/${agentId}/outcomes`,
  };
}

export async function deriveAgentReputation(agentId: string): Promise<AgentReputation> {
  const sql = await getSql();
  const totals = await sql<{ total: number }>`
    select count(*)::int as total from firewall_actions
    where chain_id = ${chain} and agent_id = ${agentId}
  `;
  const verified = await sql<{ total: number }>`
    select count(*)::int as total
    from execution_proofs p
    where p.chain_id = ${chain}
      and p.agent_id = ${agentId}
      and p.verification_status = 'receipt_verified'
      and exists (
        select 1 from firewall_actions a
        where a.chain_id = p.chain_id and a.execution_id = p.execution_id
      )
  `;
  const outcomes = await sql<{ status: string; total: number }>`
    select status, count(*)::int as total
    from execution_outcomes
    where chain_id = ${chain} and agent_id = ${agentId}
    group by status
  `;
  const times = await sql<{ first_at: string | null; last_at: string | null }>`
    select min(ts)::text as first_at, max(ts)::text as last_at
    from (
      select executed_at as ts from firewall_actions
      where chain_id = ${chain} and agent_id = ${agentId} and executed_at is not null
      union all
      select coalesce(verified_at, created_at) as ts from execution_outcomes
      where chain_id = ${chain} and agent_id = ${agentId}
    ) activity
  `;
  const byStatus = new Map(outcomes.map((row) => [row.status, Number(row.total)]));
  return {
    agentId,
    totalExecutions: Number(totals[0]?.total ?? 0),
    verifiedExecutions: Number(verified[0]?.total ?? 0),
    verifiedOutcomes: byStatus.get("verified") ?? 0,
    failedOutcomes: byStatus.get("failed") ?? 0,
    unverifiableOutcomes: byStatus.get("unverifiable") ?? 0,
    firstActivityAt: times[0]?.first_at ?? null,
    lastActivityAt: times[0]?.last_at ?? null,
    updatedAt: new Date().toISOString(),
    links: links(agentId),
  };
}

export async function listHistoryFlags(): Promise<HistoryFlag[]> {
  const sql = await getSql();
  const rows = await sql<{ agent_id: string; verified_executions: number; verified_outcomes: number }>`
    select ag.agent_id,
      (
        select count(*)::int from execution_proofs p
        where p.chain_id = ag.chain_id
          and p.agent_id = ag.agent_id
          and p.verification_status = 'receipt_verified'
          and exists (
            select 1 from firewall_actions a
            where a.chain_id = p.chain_id and a.execution_id = p.execution_id
          )
      ) as verified_executions,
      (
        select count(*)::int from execution_outcomes o
        where o.chain_id = ag.chain_id and o.agent_id = ag.agent_id and o.status = 'verified'
      ) as verified_outcomes
    from indexed_agents ag
    where ag.chain_id = ${chain}
    order by ag.agent_id::bigint asc
  `;
  return rows.map((row) => ({
    agentId: row.agent_id,
    verifiedExecutions: Number(row.verified_executions),
    verifiedOutcomes: Number(row.verified_outcomes),
  }));
}

export async function listAgentsWithHistory(
  limit?: number,
  offset?: number,
): Promise<{ agents: AgentReputation[]; total: number; limit: number; offset: number }> {
  const sql = await getSql();
  const window = page(limit, offset);
  const totals = await sql<{ total: number }>`
    select count(*)::int as total
    from indexed_agents ag
    where ag.chain_id = ${chain}
      and (
        exists (
          select 1 from firewall_actions a
          where a.chain_id = ag.chain_id and a.agent_id = ag.agent_id
        )
        or exists (
          select 1 from execution_outcomes o
          where o.chain_id = ag.chain_id and o.agent_id = ag.agent_id
        )
      )
  `;
  const rows = await sql<{ agent_id: string }>`
    select ag.agent_id
    from indexed_agents ag
    where ag.chain_id = ${chain}
      and (
        exists (
          select 1 from firewall_actions a
          where a.chain_id = ag.chain_id and a.agent_id = ag.agent_id
        )
        or exists (
          select 1 from execution_outcomes o
          where o.chain_id = ag.chain_id and o.agent_id = ag.agent_id
        )
      )
    order by ag.agent_id::bigint asc
    limit ${window.limit} offset ${window.offset}
  `;
  const agents: AgentReputation[] = [];
  for (const row of rows) agents.push(await deriveAgentReputation(row.agent_id));
  return { agents, total: Number(totals[0]?.total ?? 0), limit: window.limit, offset: window.offset };
}

type TimelineRow = { kind: string; at: string | null; ref: string; label: string; status: string | null };

export async function listAgentTimeline(agentId: string, limit = 100): Promise<HistoryEntry[]> {
  const sql = await getSql();
  const size = Math.min(200, Math.max(1, Math.floor(limit)));
  const rows = await sql<TimelineRow>`
    select kind, at::text as at, ref, label, status from (
      select 'identity'::text as kind, registered_at as at, agent_id as ref,
             'Agent created'::text as label, null::text as status
      from indexed_agents
      where chain_id = ${chain} and agent_id = ${agentId}
      union all
      select 'firewall', created_at, firewall_id, 'Firewall configured', null
      from indexed_firewalls
      where chain_id = ${chain} and agent_id = ${agentId}
      union all
      select
        case when p.verification_status = 'receipt_verified' then 'proof' else 'execution' end,
        a.executed_at,
        a.execution_id,
        case when p.verification_status = 'receipt_verified' then 'Execution verified' else 'Execution indexed' end,
        p.verification_status
      from firewall_actions a
      left join execution_proofs p on p.chain_id = a.chain_id and p.execution_id = a.execution_id
      where a.chain_id = ${chain} and a.agent_id = ${agentId}
      union all
      select 'outcome', coalesce(verified_at, created_at), outcome_id,
        case status
          when 'verified' then 'Outcome verified'
          when 'failed' then 'Outcome failed'
          else 'Outcome unverifiable'
        end,
        status
      from execution_outcomes
      where chain_id = ${chain} and agent_id = ${agentId}
      union all
      select 'anchor', p.updated_at, p.execution_id, 'Proof anchored', 'anchored'
      from execution_proofs p
      where p.chain_id = ${chain} and p.agent_id = ${agentId} and p.anchored = true
    ) events
    order by at desc nulls last, kind asc, ref asc
    limit ${size}
  `;
  return rows.map((row) => ({
    id: `${row.kind}:${row.ref}`,
    at: row.at,
    category:
      row.kind === "identity"
        ? "Identity"
        : row.kind === "firewall"
          ? "Permissions"
          : row.kind === "proof" || row.kind === "anchor"
          ? "Proof"
          : row.kind === "outcome"
              ? "Outcome"
              : "Execution",
    label: row.label,
    href: hrefFor(agentId, row),
  }));
}

function hrefFor(agentId: string, row: TimelineRow): string {
  if (row.kind === "identity") return `/agents/${agentId}`;
  if (row.kind === "firewall") return `/firewalls/${row.ref}`;
  if (row.kind === "anchor" || row.kind === "proof" || row.kind === "execution") return `/proofs/${row.ref}`;
  if (row.kind === "outcome") {
    const status = row.status === "failed" || row.status === "unverifiable" || row.status === "verified" ? row.status : "verified";
    return `/agents/${agentId}/outcomes?status=${status}`;
  }
  return `/proofs/${row.ref}`;
}

export async function listAgentActivity(
  agentId: string,
  status?: "verified" | "unverified",
  limit?: number,
  offset?: number,
): Promise<{ items: AgentActivityItem[]; total: number; limit: number; offset: number }> {
  const sql = await getSql();
  const window = page(limit, offset);
  const filter = status ?? null;
  const totals = await sql<{ total: number }>`
    select count(*)::int as total
    from firewall_actions a
    left join execution_proofs p on p.chain_id = a.chain_id and p.execution_id = a.execution_id
    where a.chain_id = ${chain} and a.agent_id = ${agentId}
      and (
        ${filter}::text is null
        or (${filter} = 'verified' and p.verification_status = 'receipt_verified')
        or (${filter} = 'unverified' and coalesce(p.verification_status, '') <> 'receipt_verified')
      )
  `;
  const rows = await sql<{
    execution_id: string;
    selector: string;
    target: string;
    value: string;
    tx_hash: string;
    executed_at: string | null;
    verification_status: string | null;
    anchored: boolean | null;
  }>`
    select a.execution_id, a.selector, a.target, a.value, a.tx_hash,
           a.executed_at::text as executed_at, p.verification_status, p.anchored
    from firewall_actions a
    left join execution_proofs p on p.chain_id = a.chain_id and p.execution_id = a.execution_id
    where a.chain_id = ${chain} and a.agent_id = ${agentId}
      and (
        ${filter}::text is null
        or (${filter} = 'verified' and p.verification_status = 'receipt_verified')
        or (${filter} = 'unverified' and coalesce(p.verification_status, '') <> 'receipt_verified')
      )
    order by a.block_number desc, a.log_index desc
    limit ${window.limit} offset ${window.offset}
  `;
  return {
    items: rows.map((row) => ({
      executionId: row.execution_id,
      agentId,
      selector: row.selector,
      target: row.target,
      value: row.value,
      txHash: row.tx_hash,
      timestamp: row.executed_at,
      proofStatus: row.verification_status,
      anchored: Boolean(row.anchored),
      verified: row.verification_status === "receipt_verified",
    })),
    total: Number(totals[0]?.total ?? 0),
    limit: window.limit,
    offset: window.offset,
  };
}

export async function listAgentOutcomes(
  agentId: string,
  status?: OutcomeStatus,
  limit?: number,
  offset?: number,
): Promise<{ items: OutcomeRecord[]; total: number; limit: number; offset: number }> {
  const sql = await getSql();
  const window = page(limit, offset);
  const filter = status ?? null;
  const totals = await sql<{ total: number }>`
    select count(*)::int as total from execution_outcomes
    where chain_id = ${chain} and agent_id = ${agentId}
      and (${filter}::text is null or status = ${filter})
  `;
  const rows = await sql<{
    outcome_id: string;
    execution_id: string;
    status: OutcomeStatus;
    expected: string;
    observed: string;
    evidence: string;
    reason: string;
    created_at: string | null;
    verified_at: string | null;
  }>`
    select outcome_id, execution_id, status, expected, observed, evidence, reason,
           created_at::text as created_at, verified_at::text as verified_at
    from execution_outcomes
    where chain_id = ${chain} and agent_id = ${agentId}
      and (${filter}::text is null or status = ${filter})
    order by coalesce(verified_at, created_at) desc, outcome_id asc
    limit ${window.limit} offset ${window.offset}
  `;
  return {
    items: rows.map((row) => ({
      outcomeId: row.outcome_id,
      executionId: row.execution_id,
      agentId,
      status: row.status,
      expected: row.expected,
      observed: row.observed,
      evidence: row.evidence,
      reason: row.reason,
      createdAt: row.created_at,
      verifiedAt: row.verified_at,
    })),
    total: Number(totals[0]?.total ?? 0),
    limit: window.limit,
    offset: window.offset,
  };
}

export async function getOutcomeByExecution(executionId: string): Promise<OutcomeRecord | null> {
  const id = executionId.trim().toLowerCase();
  if (!/^0x[a-f0-9]{64}$/.test(id)) return null;
  const sql = await getSql();
  const rows = await sql<{
    outcome_id: string;
    execution_id: string;
    agent_id: string;
    status: OutcomeStatus;
    expected: string;
    observed: string;
    evidence: string;
    reason: string;
    created_at: string | null;
    verified_at: string | null;
  }>`
    select outcome_id, execution_id, agent_id, status, expected, observed, evidence, reason,
           created_at::text as created_at, verified_at::text as verified_at
    from execution_outcomes
    where chain_id = ${chain} and lower(execution_id) = ${id}
    order by coalesce(verified_at, created_at) desc, outcome_id asc
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    outcomeId: row.outcome_id,
    executionId: row.execution_id,
    agentId: row.agent_id,
    status: row.status,
    expected: row.expected,
    observed: row.observed,
    evidence: row.evidence,
    reason: row.reason,
    createdAt: row.created_at,
    verifiedAt: row.verified_at,
  };
}
