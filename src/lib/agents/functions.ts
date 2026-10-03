import { createServerFn } from "@tanstack/react-start";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  confirmRegistrationReceipt,
  configuredRegistry,
  decodeRegisterCall,
  findTransaction,
  getIndexedAgent,
  getPublicClient,
  listAgentEvents,
  listIndexedAgents,
  searchIndexedAgents,
  syncRegistrySafe,
} from "@/lib/chain/indexer.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { parseCreateInput } from "./validate";
import { parseFirewallDraft } from "./firewall-input";
import { encodeCapabilities } from "./capabilities";
import { getIntentForUser, listIntentsForUser, readChainStatus } from "./queries.server";
import {
  configuredFirewall,
  decodeCreateFirewallCall,
  getIndexedFirewall,
  ingestFirewallReceipt,
  listActionsByAgent,
  listFirewallActions,
  listFirewallsByAgent,
  listIndexedFirewalls,
  syncFirewallSafe,
} from "@/lib/chain/firewall.server";
import {
  anchorVerifiedProof,
  getExecutionProof,
  listExecutionProofs,
  listProofsForAgent,
  settlePendingProofs,
  verifyIndexedExecution,
} from "@/lib/chain/proof.server";
import {
  deriveAgentReputation,
  listAgentActivity,
  listAgentOutcomes,
  listAgentTimeline,
  listHistoryFlags,
  getOutcomeByExecution,
} from "@/lib/chain/reputation.server";
import { readDemoFirewall } from "@/lib/chain/demo.server";
import { verifyDemoDepositOutcome } from "@/lib/developer/outcome.server";
import type {
  AgentEvent,
  AgentReputation,
  ExecutionRecord,
  FirewallIntent,
  FirewallRecord,
  HistoryEntry,
  IndexerStatus,
  OutcomeRecord,
  OutcomeStatus,
  ProofRecord,
  RegistrationIntent,
} from "./types";

async function reconcileIntent(userId: string, intent: RegistrationIntent): Promise<RegistrationIntent> {
  if (intent.status === "pending" && intent.txHash) return applyReceipt(userId, intent);
  return intent;
}

async function applyReceipt(userId: string, intent: RegistrationIntent): Promise<RegistrationIntent> {
  if (!intent.txHash) return intent;
  const sql = await getSql();
  const outcome = await confirmRegistrationReceipt(sql, intent.txHash as `0x${string}`);
  if (outcome.state === "pending") return intent;
  if (outcome.state === "failed") {
    await sql`
      update registration_intents
      set status = 'failed', error = ${outcome.error}, chain_agent_id = null, updated_at = now()
      where id = ${intent.id} and user_id = ${userId}
    `;
    return { ...intent, status: "failed", error: outcome.error, chainAgentId: null };
  }
  const createdMs = Date.parse(intent.createdAt);
  if (Number.isFinite(createdMs) && outcome.blockTimestamp * 1000 + 120_000 < createdMs) {
    const error = "This transaction was mined before the agent record was created.";
    await sql`
      update registration_intents
      set status = 'failed', error = ${error}, chain_agent_id = null, updated_at = now()
      where id = ${intent.id} and user_id = ${userId}
    `;
    return { ...intent, status: "failed", error, chainAgentId: null };
  }
  await sql`
    update registration_intents
    set status = 'active', chain_agent_id = ${outcome.agentId}, owner_address = ${outcome.owner},
        error = null, updated_at = now()
    where id = ${intent.id} and user_id = ${userId}
  `;
  return {
    ...intent,
    status: "active",
    chainAgentId: outcome.agentId,
    ownerAddress: outcome.owner,
    error: null,
  };
}

function sameCapabilities(left: string[], right: string[]): boolean {
  try {
    return encodeCapabilities(left) === encodeCapabilities(right);
  } catch {
    return false;
  }
}

async function readRegistrationTx(
  txHash: `0x${string}`,
  expected: { name: string; description: string; metadataURI: string; capabilities: string[] },
) {
  const registry = configuredRegistry();
  if (!registry) throw new Error("Agent Registry is not deployed. No transaction was sent.");
  const tx = await findTransaction(txHash);
  if (!tx) throw new Error("Transaction was not found on Monad testnet.");
  if (!tx.to || tx.to.toLowerCase() !== registry) {
    throw new Error("Transaction does not call the Agent Registry.");
  }
  const call = decodeRegisterCall(tx.input);
  if (!call) throw new Error("Transaction is not an Agent Registry registration.");
  if (
    call.name !== expected.name ||
    call.description !== expected.description ||
    call.metadataURI !== expected.metadataURI ||
    !sameCapabilities(call.capabilities, expected.capabilities)
  ) {
    throw new Error("Transaction arguments do not match this agent record.");
  }
  return { registry, owner: tx.from.toLowerCase() };
}

export const submitRegistration = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const parsed = parseCreateInput(input);
    if (!parsed.ok) throw new Error(parsed.error);
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    const txHash = (input as { txHash?: unknown }).txHash;
    if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error("Invalid transaction hash.");
    }
    return { ...parsed.value, txHash: txHash as `0x${string}` };
  })
  .handler(async ({ context, data }) => {
    const { registry, owner } = await readRegistrationTx(data.txHash, data);
    const sql = await getSql();
    const taken = await sql<{ id: string }>`
      select id from registration_intents where lower(tx_hash) = ${data.txHash.toLowerCase()}
    `;
    if (taken.length) throw new Error("That transaction is already linked to another record.");
    const id = crypto.randomUUID();
    await sql`
      insert into registration_intents (
        id, user_id, name, description, capabilities, metadata_uri, owner_address, status, tx_hash
      ) values (
        ${id},
        ${context.userId},
        ${data.name},
        ${data.description},
        ${JSON.stringify(data.capabilities)}::jsonb,
        ${data.metadataURI},
        ${owner},
        'pending',
        ${data.txHash.toLowerCase()}
      )
    `;
    const pending: RegistrationIntent = {
      id,
      name: data.name,
      description: data.description,
      capabilities: data.capabilities,
      metadataURI: data.metadataURI,
      ownerAddress: owner,
      status: "pending",
      txHash: data.txHash.toLowerCase(),
      chainAgentId: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    return { intent: await applyReceipt(context.userId, pending), registry };
  });

export const listMyIntents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const intents = await listIntentsForUser(context.userId);
    const registry = configuredRegistry();
    return { intents, registry };
  });

export const getMyIntent = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid agent record.");
    return id;
  })
  .handler(async ({ context, data }) => {
    const found = await getIntentForUser(context.userId, data);
    if (!found) return { intent: null as RegistrationIntent | null, registry: configuredRegistry() };
    const intent = await reconcileIntent(context.userId, found);
    return { intent, registry: configuredRegistry() };
  });

export const refreshIntent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid agent record.");
    return id;
  })
  .handler(async ({ context, data }) => {
    const found = await getIntentForUser(context.userId, data);
    if (!found) throw new Error("Agent record not found.");
    const intent = await reconcileIntent(context.userId, found);
    if (!intent.txHash || intent.status === "active") return { intent, registry: configuredRegistry() };
    return { intent: await applyReceipt(context.userId, intent), registry: configuredRegistry() };
  });

export const attachRegistrationTx = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    const raw = input as Record<string, unknown>;
    if (typeof raw.intentId !== "string" || !/^[0-9a-f-]{36}$/i.test(raw.intentId)) {
      throw new Error("Invalid agent record.");
    }
    if (typeof raw.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(raw.txHash)) {
      throw new Error("Invalid transaction hash.");
    }
    return { intentId: raw.intentId, txHash: raw.txHash as `0x${string}` };
  })
  .handler(async ({ context, data }) => {
    const existing = await getIntentForUser(context.userId, data.intentId);
    if (!existing) throw new Error("Agent record not found.");
    if (existing.status === "active") return { intent: existing, registry: configuredRegistry() };
    if (existing.status !== "draft" && existing.status !== "failed" && existing.status !== "pending") {
      throw new Error("This record cannot be registered in its current state.");
    }
    const { registry, owner } = await readRegistrationTx(data.txHash, existing);
    const sql = await getSql();
    const taken = await sql<{ id: string }>`
      select id from registration_intents
      where lower(tx_hash) = ${data.txHash.toLowerCase()} and id <> ${existing.id}
    `;
    if (taken.length) throw new Error("That transaction is already linked to another record.");
    await sql`
      update registration_intents
      set tx_hash = ${data.txHash.toLowerCase()}, owner_address = ${owner},
          status = 'pending', error = null, updated_at = now()
      where id = ${existing.id} and user_id = ${context.userId}
    `;
    const pending: RegistrationIntent = {
      ...existing,
      txHash: data.txHash.toLowerCase(),
      ownerAddress: owner,
      status: "pending",
      error: null,
    };
    return { intent: await applyReceipt(context.userId, pending), registry };
  });

export const getDirectory = createServerFn({ method: "GET" }).handler(async () => {
  const indexer: IndexerStatus = await syncRegistrySafe();
  const agents = await listIndexedAgents(100);
  const history = await listHistoryFlags();
  return { agents, indexer, registry: configuredRegistry(), history };
});

export const getPublicAgent = createServerFn({ method: "GET" })
  .validator((agentId: string) => agentId)
  .handler(async ({ data }) => {
    if (!/^\d+$/.test(data)) return { agent: null, events: [] as AgentEvent[] };
    await syncRegistrySafe();
    const agent = await getIndexedAgent(data);
    if (!agent) return { agent: null, events: [] };
    const events = await listAgentEvents(data, 21);
    return { agent, events };
  });

export const searchAgents = createServerFn({ method: "GET" })
  .validator((query: string) => query.slice(0, 80))
  .handler(async ({ data }) => {
    await syncRegistrySafe();
    return { query: data, agents: await searchIndexedAgents(data), history: await listHistoryFlags() };
  });

export type TraceHit = { kind: "Agent" | "Execution" | "Proof" | "Transaction"; id: string; label: string; href: string };

export const searchTrace = createServerFn({ method: "GET" })
  .validator((query: string) => query.trim().slice(0, 80))
  .handler(async ({ data }) => {
    const q = data;
    if (!q) return { hits: [] as TraceHit[] };
    const term = q.toLowerCase().replace(/[%_\\]/g, "").trim();
    if (!term) return { hits: [] as TraceHit[] };
    const agentId = /^\d+$/.test(q) ? BigInt(q).toString() : q;
    const sql = await getSql();
    const chain = MONAD_TESTNET.chainId;
    const hits: TraceHit[] = [];
    const like = `%${term}%`;
    const agents = await sql<{ agent_id: string; name: string }>`
      select agent_id, name
      from indexed_agents
      where chain_id = ${chain}
        and (
          agent_id = ${agentId}
          or lower(name) like ${like}
          or lower(tx_hash) = ${term}
          or lower(coalesce(last_update_tx_hash, '')) = ${term}
        )
      order by agent_id::bigint asc
      limit 8
    `;
    for (const row of agents) {
      const padded = row.agent_id.padStart(3, "0");
      hits.push({
        kind: "Agent",
        id: row.agent_id,
        label: row.name ? `${row.name} · #${padded}` : `Agent #${padded}`,
        href: `/agents/${row.agent_id}`,
      });
    }
    if (/^0x[a-f0-9]{64}$/.test(term)) {
      const actions = await sql<{ execution_id: string; tx_hash: string }>`
        select execution_id, tx_hash
        from firewall_actions
        where chain_id = ${chain}
          and (lower(execution_id) = ${term} or lower(tx_hash) = ${term})
        limit 8
      `;
      for (const row of actions) {
        const isTx = row.tx_hash.toLowerCase() === term;
        hits.push({
          kind: isTx ? "Transaction" : "Execution",
          id: row.execution_id,
          label: isTx ? row.tx_hash : `Execution ${row.execution_id.slice(0, 10)}…${row.execution_id.slice(-4)}`,
          href: `/proofs/${row.execution_id}`,
        });
      }
      const proofs = await sql<{ execution_id: string; proof_hash: string | null; verification_status: string }>`
        select execution_id, proof_hash, verification_status
        from execution_proofs
        where chain_id = ${chain}
          and (
            lower(execution_id) = ${term}
            or lower(coalesce(proof_hash, '')) = ${term}
          )
        limit 8
      `;
      for (const row of proofs) {
        const proofMatch = Boolean(row.proof_hash && row.proof_hash.toLowerCase() === term);
        if (proofMatch) {
          if (hits.some((hit) => hit.kind === "Proof" && hit.id === row.execution_id)) continue;
          hits.push({
            kind: "Proof",
            id: row.execution_id,
            label: `Execution ${row.execution_id.slice(0, 10)}…${row.execution_id.slice(-4)} · ${row.verification_status === "receipt_verified" ? "Verified" : row.verification_status === "unverifiable" ? "Unverifiable" : "Recorded"}`,
            href: `/proofs/${row.execution_id}`,
          });
          continue;
        }
        if (hits.some((hit) => hit.id === row.execution_id)) continue;
        hits.push({
          kind: "Execution",
          id: row.execution_id,
          label: `Execution ${row.execution_id.slice(0, 10)}…${row.execution_id.slice(-4)}`,
          href: `/proofs/${row.execution_id}`,
        });
      }
    }
    return { hits: hits.slice(0, 12) };
  });

export const getChainStatus = createServerFn({ method: "GET" }).handler(async () => {
  return readChainStatus();
});

function toExecution(action: {
  executionId: string;
  agentId: string;
  timestamp: string | null;
  selector: string;
  target: string;
  value: string;
  txHash: string;
  proofStatus: string | null;
}): ExecutionRecord {
  return {
    id: action.executionId,
    agentId: action.agentId,
    timestamp: action.timestamp ?? "",
    action: action.selector,
    target: action.target,
    value: action.value,
    txHash: action.txHash,
    proofId: action.proofStatus ? action.executionId : null,
  };
}

export const getAgentLayers = createServerFn({ method: "GET" })
  .validator((agentId: string) => agentId)
  .handler(async ({ data }) => {
    const firewallIndexer = await syncFirewallSafe();
    const firewalls = /^[1-9]\d*$/.test(data) ? await listFirewallsByAgent(data) : [];
    const actions = /^[1-9]\d*$/.test(data) ? await listActionsByAgent(data) : [];
    const proofs = /^[1-9]\d*$/.test(data) ? await listProofsForAgent(data, true) : [];
    const reputation = /^[1-9]\d*$/.test(data) ? await deriveAgentReputation(data) : null;
    const timeline = reputation ? await listAgentTimeline(data, 8) : [];
    const outcomes = reputation ? (await listAgentOutcomes(data, undefined, 8, 0)).items : [];
    return {
      agentId: data,
      executions: actions.map(toExecution),
      proofs,
      firewalls,
      reputation,
      timeline,
      outcomes,
      executionsDetail: actions.length ? "" : "No activity yet",
      proofsDetail: proofs.length ? "" : "No verified proofs yet",
      firewallsDetail: firewalls.length
        ? ""
        : firewallIndexer.status === "unconfigured"
          ? firewallIndexer.detail
          : "No firewall is indexed for this agent.",
    };
  });

export const getAgentReputation = createServerFn({ method: "GET" })
  .validator((agentId: string) => agentId)
  .handler(async ({ data }) => {
    if (!/^[1-9]\d*$/.test(data)) return { reputation: null as AgentReputation | null, timeline: [] as HistoryEntry[] };
    await syncRegistrySafe();
    const agent = await getIndexedAgent(data);
    if (!agent) return { reputation: null as AgentReputation | null, timeline: [] as HistoryEntry[] };
    return {
      reputation: await deriveAgentReputation(data),
      timeline: await listAgentTimeline(data, 100),
    };
  });

export const getAgentActivityPage = createServerFn({ method: "GET" })
  .validator((input: { agentId: string; status?: string; offset?: number }) => input)
  .handler(async ({ data }) => {
    if (!/^[1-9]\d*$/.test(data.agentId)) return { agent: null, items: [], total: 0, limit: 50, offset: 0 };
    const agent = await getIndexedAgent(data.agentId);
    if (!agent) return { agent: null, items: [], total: 0, limit: 50, offset: 0 };
    const status = data.status === "verified" || data.status === "unverified" ? data.status : undefined;
    const page = await listAgentActivity(data.agentId, status, 50, data.offset ?? 0);
    return { agent, ...page };
  });

export const getOutcome = createServerFn({ method: "GET" })
  .validator((executionId: string) => executionId.trim().toLowerCase())
  .handler(async ({ data }) => {
    if (!/^0x[a-f0-9]{64}$/.test(data)) return { outcome: null as OutcomeRecord | null, agentName: "" };
    const outcome = await getOutcomeByExecution(data);
    if (!outcome) return { outcome: null as OutcomeRecord | null, agentName: "" };
    const agent = await getIndexedAgent(outcome.agentId);
    return { outcome, agentName: agent?.name ?? "" };
  });

export const getAgentOutcomesPage = createServerFn({ method: "GET" })
  .validator((input: { agentId: string; status?: string; offset?: number }) => input)
  .handler(async ({ data }) => {
    if (!/^[1-9]\d*$/.test(data.agentId)) return { agent: null, items: [] as OutcomeRecord[], total: 0, limit: 50, offset: 0 };
    const agent = await getIndexedAgent(data.agentId);
    if (!agent) return { agent: null, items: [] as OutcomeRecord[], total: 0, limit: 50, offset: 0 };
    const status: OutcomeStatus | undefined =
      data.status === "verified" || data.status === "failed" || data.status === "unverifiable" ? data.status : undefined;
    const page = await listAgentOutcomes(data.agentId, status, 50, data.offset ?? 0);
    return { agent, ...page };
  });

export const getAgentProofPage = createServerFn({ method: "GET" })
  .validator((input: { agentId: string; status?: string }) => input)
  .handler(async ({ data }) => {
    if (!/^[1-9]\d*$/.test(data.agentId)) return { agent: null, proofs: [] as ProofRecord[] };
    const agent = await getIndexedAgent(data.agentId);
    if (!agent) return { agent: null, proofs: [] as ProofRecord[] };
    const verifiedOnly = data.status === "verified";
    return { agent, proofs: await listProofsForAgent(data.agentId, verifiedOnly) };
  });

export const listFirewalls = createServerFn({ method: "GET" }).handler(async () => {
  const indexer = await syncFirewallSafe();
  const firewalls = await listIndexedFirewalls(100);
  const detail = firewalls.length
    ? ""
    : indexer.status === "ok"
      ? "No firewall events are indexed yet."
      : indexer.detail;
  return { firewalls, detail, indexer };
});

export const listProofs = createServerFn({ method: "GET" }).handler(async () => {
  await settlePendingProofs(1);
  const proofs = await listExecutionProofs(100);
  return {
    proofs,
    detail: proofs.length
      ? ""
      : "An AgentAction has to be indexed before a proof can exist. A transaction alone is not a proof.",
  };
});

export const getProof = createServerFn({ method: "GET" })
  .validator((id: string) => id.trim().toLowerCase())
  .handler(async ({ data }) => {
    const proof = await getExecutionProof(data);
    if (!proof) {
      return { proof: null as ProofRecord | null, detail: "This execution is not indexed." };
    }
    return { proof, detail: "" };
  });

export const verifyProof = createServerFn({ method: "POST" })
  .validator((executionId: string) => {
    const id = executionId.trim().toLowerCase();
    if (!/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("Invalid execution id.");
    return id;
  })
  .handler(async ({ data }) => {
    const proof = await verifyIndexedExecution(data, true);
    if (!proof) throw new Error("No AgentAction is indexed for this execution. A transaction hash is not a proof.");
    return { proof };
  });

export const anchorProof = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((executionId: string) => {
    const id = executionId.trim().toLowerCase();
    if (!/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("Invalid execution id.");
    return id;
  })
  .handler(async ({ data }) => anchorVerifiedProof(data));

export const getFirewall = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data }) => {
    if (!/^[1-9]\d*$/.test(data)) {
      return { firewall: null as FirewallRecord | null, actions: [], detail: "Firewall not found." };
    }
    await syncFirewallSafe();
    const firewall = await getIndexedFirewall(data);
    if (!firewall) {
      return {
        firewall: null as FirewallRecord | null,
        actions: [],
        detail: "This firewall is not indexed.",
      };
    }
    return { firewall, actions: await listFirewallActions(data), detail: "" };
  });

export const listConfigurableAgents = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    // Optional connected wallet. Agents it owns onchain are configurable by it; the firewall
    // contract still checks the owner on every configuration transaction.
    const owner =
      input && typeof input === "object" ? (input as { owner?: unknown }).owner : undefined;
    return {
      owner:
        typeof owner === "string" && /^0x[a-fA-F0-9]{40}$/.test(owner) ? owner.toLowerCase() : null,
    };
  })
  .handler(async ({ context, data }) => {
    await syncRegistrySafe();
    const sql = await getSql();
    const rows = await sql<{ agent_id: string; name: string; owner: string }>`
      select a.agent_id, a.name, a.owner
      from indexed_agents a
      where a.chain_id = ${MONAD_TESTNET.chainId}
        and a.active = true
        and (
          a.owner = ${data.owner ?? ""}
          or a.owner in (
            select lower(owner_address) from registration_intents
            where user_id = ${context.userId} and owner_address is not null
          )
        )
      order by a.agent_id::bigint asc
    `;
    return {
      agents: rows.map((row) => ({ agentId: row.agent_id, name: row.name, owner: row.owner })),
      firewall: configuredFirewall(),
    };
  });

type IntentRow = {
  id: string;
  agent_id: string;
  executor: string;
  allow_value_transfer: boolean;
  max_value_per_tx: string;
  max_value_per_period: string;
  period_duration: string;
  status: FirewallIntent["status"];
  tx_hash: string | null;
  chain_firewall_id: string | null;
  error: string | null;
  created_at: string;
};

function mapFirewallIntent(row: IntentRow): FirewallIntent {
  return {
    id: row.id,
    agentId: row.agent_id,
    executor: row.executor,
    allowValueTransfer: row.allow_value_transfer,
    maxValuePerTransaction: row.max_value_per_tx,
    maxValuePerPeriod: row.max_value_per_period,
    periodDuration: row.period_duration,
    status: row.status,
    txHash: row.tx_hash,
    chainFirewallId: row.chain_firewall_id,
    error: row.error,
    createdAt: row.created_at,
  };
}

async function applyFirewallIntent(userId: string, intent: FirewallIntent): Promise<FirewallIntent> {
  if (!intent.txHash) return intent;
  const sql = await getSql();
  const outcome = await ingestFirewallReceipt(sql, intent.txHash as `0x${string}`);
  if (outcome.state === "pending") return intent;
  if (outcome.state !== "indexed") {
    const error = outcome.error;
    await sql`
      update firewall_intents
      set status = 'failed', error = ${error}, chain_firewall_id = null, updated_at = now()
      where id = ${intent.id} and user_id = ${userId}
    `;
    return { ...intent, status: "failed", error, chainFirewallId: null };
  }
  const created = await sql<{ firewall_id: string; created_at: string }>`
    select firewall_id, created_at::text as created_at
    from indexed_firewalls
    where chain_id = ${MONAD_TESTNET.chainId}
      and creation_tx_hash = ${intent.txHash.toLowerCase()}
      and agent_id = ${intent.agentId}
    order by firewall_id::bigint desc
    limit 1
  `;
  const row = created[0];
  if (!row) {
    const error = "The transaction succeeded but no FirewallCreated event was found for this agent.";
    await sql`
      update firewall_intents
      set status = 'failed', error = ${error}, chain_firewall_id = null, updated_at = now()
      where id = ${intent.id} and user_id = ${userId}
    `;
    return { ...intent, status: "failed", error, chainFirewallId: null };
  }
  const receipt = await getPublicClient().getTransactionReceipt({ hash: intent.txHash as `0x${string}` });
  const block = await getPublicClient().getBlock({ blockNumber: receipt.blockNumber });
  const createdMs = Date.parse(intent.createdAt);
  if (Number.isFinite(createdMs) && Number(block.timestamp) * 1000 + 120_000 < createdMs) {
    const error = "This transaction was mined before the firewall record was created.";
    await sql`
      update firewall_intents
      set status = 'failed', error = ${error}, chain_firewall_id = null, updated_at = now()
      where id = ${intent.id} and user_id = ${userId}
    `;
    return { ...intent, status: "failed", error, chainFirewallId: null };
  }
  await sql`
    update firewall_intents
    set status = 'active', chain_firewall_id = ${row.firewall_id}, error = null, updated_at = now()
    where id = ${intent.id} and user_id = ${userId}
  `;
  return { ...intent, status: "active", chainFirewallId: row.firewall_id, error: null };
}

export const submitFirewall = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: unknown) => {
    const parsed = parseFirewallDraft(input);
    if (!parsed.ok) throw new Error(parsed.error);
    if (!input || typeof input !== "object") throw new Error("Invalid request.");
    const txHash = (input as { txHash?: unknown }).txHash;
    if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      throw new Error("Invalid transaction hash.");
    }
    return { ...parsed.value, txHash: txHash as `0x${string}` };
  })
  .handler(async ({ context, data }) => {
    const firewall = configuredFirewall();
    if (!firewall) throw new Error("Agent Firewall is not deployed. No transaction was sent.");
    const tx = await findTransaction(data.txHash);
    if (!tx) throw new Error("Transaction was not found on Monad testnet.");
    if (!tx.to || tx.to.toLowerCase() !== firewall) throw new Error("Transaction does not call the Agent Firewall.");
    const call = decodeCreateFirewallCall(tx.input);
    if (!call) throw new Error("Transaction is not a firewall creation.");
    if (
      call.agentId !== data.agentId ||
      call.executor !== data.executor ||
      call.allowValueTransfer !== data.allowValueTransfer ||
      call.maxValuePerTransaction !== data.maxValuePerTransaction ||
      call.maxValuePerPeriod !== data.maxValuePerPeriod ||
      call.periodDuration !== data.periodDuration
    ) {
      throw new Error("Transaction arguments do not match this firewall record.");
    }
    const sql = await getSql();
    const taken = await sql<{ id: string }>`
      select id from firewall_intents where lower(tx_hash) = ${data.txHash.toLowerCase()}
    `;
    if (taken.length) throw new Error("That transaction is already linked to another record.");
    const id = crypto.randomUUID();
    await sql`
      insert into firewall_intents (
        id, user_id, agent_id, executor, allow_value_transfer, max_value_per_tx,
        max_value_per_period, period_duration, status, tx_hash
      ) values (
        ${id},
        ${context.userId},
        ${data.agentId},
        ${data.executor},
        ${data.allowValueTransfer},
        ${data.maxValuePerTransaction},
        ${data.maxValuePerPeriod},
        ${data.periodDuration},
        'pending',
        ${data.txHash.toLowerCase()}
      )
    `;
    const pending: FirewallIntent = {
      id,
      agentId: data.agentId,
      executor: data.executor,
      allowValueTransfer: data.allowValueTransfer,
      maxValuePerTransaction: data.maxValuePerTransaction,
      maxValuePerPeriod: data.maxValuePerPeriod,
      periodDuration: data.periodDuration,
      status: "pending",
      txHash: data.txHash.toLowerCase(),
      chainFirewallId: null,
      error: null,
      createdAt: new Date().toISOString(),
    };
    return { intent: await applyFirewallIntent(context.userId, pending), firewall };
  });

export const refreshFirewallIntent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid firewall record.");
    return id;
  })
  .handler(async ({ context, data }) => {
    const sql = await getSql();
    const rows = await sql<IntentRow>`
      select id, agent_id, executor, allow_value_transfer, max_value_per_tx, max_value_per_period,
             period_duration, status, tx_hash, chain_firewall_id, error, created_at::text as created_at
      from firewall_intents
      where id = ${data} and user_id = ${context.userId}
    `;
    const found = rows[0] ? mapFirewallIntent(rows[0]) : null;
    if (!found) throw new Error("Firewall record not found.");
    if (!found.txHash || found.status === "active") return { intent: found };
    return { intent: await applyFirewallIntent(context.userId, found) };
  });

export const confirmFirewallTx = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { txHash?: string; firewallId?: string }) => {
    if (!input || typeof input.txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(input.txHash)) {
      throw new Error("Invalid transaction hash.");
    }
    if (input.firewallId != null && !/^[1-9]\d*$/.test(input.firewallId)) {
      throw new Error("Invalid firewall id.");
    }
    return { txHash: input.txHash as `0x${string}`, firewallId: input.firewallId };
  })
  .handler(async ({ data }) => {
    const sql = await getSql();
    const outcome = await ingestFirewallReceipt(sql, data.txHash);
    if (outcome.state === "indexed" && data.firewallId && !outcome.firewallIds.includes(data.firewallId)) {
      return {
        state: "empty" as const,
        error: "The transaction confirmed but it did not include this firewall.",
      };
    }
    return outcome;
  });

export const readDemoState = createServerFn({ method: "GET" })
  .validator((firewallId: string) => (firewallId && !/^[1-9]\d*$/.test(firewallId) ? "" : firewallId))
  .handler(async ({ data }) => readDemoFirewall(data));

export const verifyDemoDeposit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((executionId: string) => {
    const id = executionId.trim().toLowerCase();
    if (!/^0x[a-fA-F0-9]{64}$/.test(id)) throw new Error("Invalid execution id.");
    return id;
  })
  .handler(async ({ data }) => {
    const response = await verifyDemoDepositOutcome(data);
    const body = (await response.json()) as {
      error?: { message?: string };
      status?: string;
      expected?: string;
      observed?: string;
      evidence?: string;
      reason?: string;
    };
    if (!response.ok) throw new Error(body.error?.message ?? "Outcome verification did not complete.");
    return {
      status: body.status ?? "unverifiable",
      expected: body.expected ?? "",
      observed: body.observed ?? "",
      evidence: body.evidence ?? "",
      reason: body.reason ?? "",
    };
  });
