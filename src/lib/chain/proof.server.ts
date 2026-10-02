import { createPublicClient, createWalletClient, decodeEventLog, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { defineChain } from "viem";
import { getSql, type Sql } from "@/lib/db";
import { agentProofAbi } from "@/lib/chain/abi";
import { deployment } from "@/lib/chain/deployment";
import { readAddress } from "@/lib/chain/addresses.server";
import { configuredFirewall } from "@/lib/chain/firewall.server";
import { getPublicClient } from "@/lib/chain/indexer.server";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { monadRpcUrl, monadTransport } from "@/lib/chain/rpc.server";
import { assessExecution, VERIFICATION_METHOD, type AssessedLog } from "@/lib/chain/proof-assess";
import { computeProofHash } from "@/lib/chain/proof-hash";
import { publishDeveloperEvent } from "@/lib/developer/webhooks.server";
import type { ProofRecord, ProofStatus, VerificationCheck } from "@/lib/agents/types";

function monadChain() {
  return defineChain({
    id: MONAD_TESTNET.chainId,
    name: MONAD_TESTNET.name,
    nativeCurrency: { name: "MON", symbol: MONAD_TESTNET.nativeSymbol, decimals: 18 },
    rpcUrls: { default: { http: [monadRpcUrl()] } },
  });
}

export function configuredProofAnchor(): `0x${string}` | null {
  return readAddress(deployment.agentProof, "MONAD_TESTNET_AGENT_PROOF", "AGENT_PROOF_ADDRESS");
}

export function configuredProofDeployBlock(): number | null {
  const fromEnv = process.env.AGENT_PROOF_DEPLOY_BLOCK?.trim() ?? "";
  if (/^\d+$/.test(fromEnv)) return Number(fromEnv);
  return deployment.proofDeployBlock;
}

function verifierKey(): `0x${string}` | null {
  const key = process.env.AGENT_PROOF_VERIFIER_PRIVATE_KEY?.trim() ?? "";
  if (!/^0x[a-fA-F0-9]{64}$/.test(key)) return null;
  return key as `0x${string}`;
}

type ProofRow = {
  proof_id: string;
  execution_id: string;
  agent_id: string;
  agent_name: string | null;
  firewall_id: string;
  firewall_active: boolean | null;
  firewall_paused: boolean | null;
  executor: string;
  tx_hash: string;
  block_number: number | string;
  block_timestamp: string | null;
  target: string;
  function_selector: string;
  value: string;
  calldata_hash: string;
  proof_hash: string | null;
  verification_status: ProofStatus;
  verification_method: string | null;
  verified_at: string | null;
  anchored: boolean;
  anchor_tx_hash: string | null;
  anchor_block_number: number | string | null;
  last_error: string | null;
  created_at: string | null;
  permanent: boolean;
  attempt_count: number | string;
  last_attempt_at: string | null;
};

function firewallStatus(row: ProofRow): string | null {
  if (row.firewall_active == null) return null;
  if (!row.firewall_active) return "inactive";
  if (row.firewall_paused) return "paused";
  return "active";
}

function mapProof(row: ProofRow, checks: VerificationCheck[]): ProofRecord {
  return {
    proofId: row.proof_id,
    executionId: row.execution_id,
    agentId: row.agent_id,
    agentName: row.agent_name ?? "",
    firewallId: row.firewall_id,
    firewallStatus: firewallStatus(row),
    executor: row.executor,
    txHash: row.tx_hash,
    blockNumber: Number(row.block_number),
    blockTimestamp: row.block_timestamp,
    target: row.target,
    functionSelector: row.function_selector,
    value: row.value,
    calldataHash: row.calldata_hash,
    proofHash: row.proof_hash,
    verificationStatus: row.verification_status,
    verificationMethod: row.verification_method,
    verifiedAt: row.verified_at,
    anchored: row.anchored,
    anchorTxHash: row.anchor_tx_hash,
    anchorBlockNumber: row.anchor_block_number == null ? null : Number(row.anchor_block_number),
    createdAt: row.created_at,
    checks,
    lastError: row.last_error,
  };
}

async function checksFor(sql: Sql, executionId: string): Promise<VerificationCheck[]> {
  const rows = await sql<{ check_name: string; passed: boolean; details: string }>`
    select check_name, passed, details from verification_checks
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId}
    order by check_name asc
  `;
  return rows.map((row) => ({ name: row.check_name, passed: row.passed, details: row.details }));
}

async function readProof(sql: Sql, id: string): Promise<ProofRecord | null> {
  const key = id.trim().toLowerCase();
  const rows = await sql<ProofRow>`
    select p.proof_id, p.execution_id, p.agent_id, a.name as agent_name, p.firewall_id,
           f.active as firewall_active, f.paused as firewall_paused, p.executor, p.tx_hash, p.block_number,
           p.block_timestamp::text as block_timestamp, p.target, p.function_selector, p.value, p.calldata_hash,
           p.proof_hash, p.verification_status, p.verification_method, p.verified_at::text as verified_at,
           p.anchored, p.anchor_tx_hash, p.anchor_block_number, p.last_error, p.created_at::text as created_at,
           p.permanent, p.attempt_count, p.last_attempt_at::text as last_attempt_at
    from execution_proofs p
    left join indexed_agents a on a.chain_id = p.chain_id and a.agent_id = p.agent_id
    left join indexed_firewalls f on f.chain_id = p.chain_id and f.firewall_id = p.firewall_id
    where p.chain_id = ${MONAD_TESTNET.chainId}
      and (p.execution_id = ${key} or p.proof_id = ${key})
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  return mapProof(row, await checksFor(sql, row.execution_id));
}

export async function getExecutionProof(id: string): Promise<ProofRecord | null> {
  return readProof(await getSql(), id);
}

export async function listExecutionProofs(limit = 100): Promise<ProofRecord[]> {
  const sql = await getSql();
  const rows = await sql<ProofRow>`
    select p.proof_id, p.execution_id, p.agent_id, a.name as agent_name, p.firewall_id,
           f.active as firewall_active, f.paused as firewall_paused, p.executor, p.tx_hash, p.block_number,
           p.block_timestamp::text as block_timestamp, p.target, p.function_selector, p.value, p.calldata_hash,
           p.proof_hash, p.verification_status, p.verification_method, p.verified_at::text as verified_at,
           p.anchored, p.anchor_tx_hash, p.anchor_block_number, p.last_error, p.created_at::text as created_at,
           p.permanent, p.attempt_count, p.last_attempt_at::text as last_attempt_at
    from execution_proofs p
    left join indexed_agents a on a.chain_id = p.chain_id and a.agent_id = p.agent_id
    left join indexed_firewalls f on f.chain_id = p.chain_id and f.firewall_id = p.firewall_id
    where p.chain_id = ${MONAD_TESTNET.chainId}
    order by p.block_number desc, p.execution_id asc
    limit ${limit}
  `;
  return rows.map((row) => mapProof(row, []));
}

export async function listProofsForAgent(agentId: string, verifiedOnly = false): Promise<ProofRecord[]> {
  const sql = await getSql();
  const rows = await sql<ProofRow>`
    select p.proof_id, p.execution_id, p.agent_id, a.name as agent_name, p.firewall_id,
           f.active as firewall_active, f.paused as firewall_paused, p.executor, p.tx_hash, p.block_number,
           p.block_timestamp::text as block_timestamp, p.target, p.function_selector, p.value, p.calldata_hash,
           p.proof_hash, p.verification_status, p.verification_method, p.verified_at::text as verified_at,
           p.anchored, p.anchor_tx_hash, p.anchor_block_number, p.last_error, p.created_at::text as created_at,
           p.permanent, p.attempt_count, p.last_attempt_at::text as last_attempt_at
    from execution_proofs p
    left join indexed_agents a on a.chain_id = p.chain_id and a.agent_id = p.agent_id
    left join indexed_firewalls f on f.chain_id = p.chain_id and f.firewall_id = p.firewall_id
    where p.chain_id = ${MONAD_TESTNET.chainId} and p.agent_id = ${agentId}
      and (${verifiedOnly} = false or p.verification_status = 'receipt_verified')
    order by p.block_number desc
    limit 50
  `;
  return rows.map((row) => mapProof(row, []));
}

export async function listProofsForFirewall(firewallId: string): Promise<ProofRecord[]> {
  const sql = await getSql();
  const rows = await sql<ProofRow>`
    select p.proof_id, p.execution_id, p.agent_id, a.name as agent_name, p.firewall_id,
           f.active as firewall_active, f.paused as firewall_paused, p.executor, p.tx_hash, p.block_number,
           p.block_timestamp::text as block_timestamp, p.target, p.function_selector, p.value, p.calldata_hash,
           p.proof_hash, p.verification_status, p.verification_method, p.verified_at::text as verified_at,
           p.anchored, p.anchor_tx_hash, p.anchor_block_number, p.last_error, p.created_at::text as created_at,
           p.permanent, p.attempt_count, p.last_attempt_at::text as last_attempt_at
    from execution_proofs p
    left join indexed_agents a on a.chain_id = p.chain_id and a.agent_id = p.agent_id
    left join indexed_firewalls f on f.chain_id = p.chain_id and f.firewall_id = p.firewall_id
    where p.chain_id = ${MONAD_TESTNET.chainId} and p.firewall_id = ${firewallId}
    order by p.block_number desc
    limit 50
  `;
  return rows.map((row) => mapProof(row, []));
}

function notFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|could not be found|unknown transaction/i.test(message);
}

async function markTemporary(sql: Sql, executionId: string, message: string): Promise<void> {
  await sql`
    update execution_proofs set
      verification_status = 'temporary_error',
      permanent = false,
      last_error = ${message.slice(0, 500)},
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      updated_at = now()
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId}
      and verification_status <> 'receipt_verified'
  `;
}

async function markRequested(sql: Sql, executionId: string): Promise<void> {
  await sql`
    update execution_proofs set
      verification_status = 'requested',
      last_attempt_at = now(),
      updated_at = now()
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId}
      and verification_status <> 'receipt_verified'
  `;
}

export async function verifyIndexedExecution(executionId: string, force = false): Promise<ProofRecord | null> {
  const id = executionId.trim().toLowerCase();
  if (!/^0x[a-fA-F0-9]{64}$/.test(id)) return null;
  const sql = await getSql();
  const actions = await sql<{
    execution_id: string;
    agent_id: string;
    firewall_id: string;
    executor: string;
    target: string;
    selector: string;
    value: string;
    calldata_hash: string;
    tx_hash: string;
    block_number: number | string;
    agent_exists: boolean;
    firewall_agent_id: string | null;
  }>`
    select fa.execution_id, fa.agent_id, fa.firewall_id, fa.executor, fa.target, fa.selector, fa.value,
           fa.calldata_hash, fa.tx_hash, fa.block_number,
           (ia.agent_id is not null) as agent_exists,
           fw.agent_id as firewall_agent_id
    from firewall_actions fa
    left join indexed_agents ia on ia.chain_id = fa.chain_id and ia.agent_id = fa.agent_id
    left join indexed_firewalls fw on fw.chain_id = fa.chain_id and fw.firewall_id = fa.firewall_id
    where fa.chain_id = ${MONAD_TESTNET.chainId} and fa.execution_id = ${id}
  `;
  const action = actions[0];
  if (!action) return null;

  const current = await readProof(sql, id);
  if (!current) return null;
  if (current.verificationStatus === "receipt_verified") return current;
  if (!force && current.verificationStatus === "unverifiable") return current;
  if (!force && current.verificationStatus === "temporary_error" && current.lastError) {
    const row = await sql<{ recent: boolean }>`
      select last_attempt_at > now() - interval '20 seconds' as recent
      from execution_proofs
      where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
    `;
    if (row[0]?.recent) return current;
  }

  await markRequested(sql, id);
  const firewall = configuredFirewall();
  if (!firewall) {
    await markTemporary(sql, id, "Agent Firewall is not deployed, so the event cannot be tied to a contract.");
    return readProof(sql, id);
  }

  const client = getPublicClient();
  const hash = action.tx_hash as Hex;
  try {
    const tx = await client.getTransaction({ hash }).catch((err: unknown) => {
      if (notFound(err)) return null;
      throw err;
    });
    let latest: bigint | null = null;
    if (!tx) {
      latest = await client.getBlockNumber().catch(() => null);
      const recent = latest == null || BigInt(action.block_number) + 20n >= latest;
      if (recent) {
        await markTemporary(sql, id, "The transaction is not available on the RPC yet.");
        return readProof(sql, id);
      }
    }
    const receipt = tx
      ? await client.getTransactionReceipt({ hash }).catch((err: unknown) => {
          if (notFound(err)) return null;
          throw err;
        })
      : null;
    if (tx && !receipt) {
      await markTemporary(sql, id, "The transaction has no receipt yet.");
      return readProof(sql, id);
    }
    const assessment = assessExecution({
      action: {
        executionId: action.execution_id,
        agentId: action.agent_id,
        firewallId: action.firewall_id,
        executor: action.executor,
        target: action.target,
        selector: action.selector,
        value: action.value,
        calldataHash: action.calldata_hash,
        txHash: action.tx_hash,
        blockNumber: Number(action.block_number),
      },
      agentExists: action.agent_exists,
      firewallAgentId: action.firewall_agent_id,
      firewallContract: firewall,
      tx: tx
        ? { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, value: tx.value }
        : null,
      receipt: receipt
        ? {
            status: receipt.status,
            transactionHash: receipt.transactionHash,
            blockNumber: Number(receipt.blockNumber),
            logs: receipt.logs.map((log) => ({
              address: log.address,
              topics: log.topics,
              data: log.data,
            })) as AssessedLog[],
          }
        : null,
    });
    await sql`delete from verification_checks where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}`;
    for (const item of assessment.checks) {
      await sql`
        insert into verification_checks (chain_id, execution_id, check_name, passed, details, verified_at)
        values (
          ${MONAD_TESTNET.chainId}, ${id}, ${item.name}, ${item.passed}, ${item.details}, now()
        )
      `;
    }
    await sql`
      update execution_proofs set
        verification_status = ${assessment.status},
        verification_method = ${VERIFICATION_METHOD},
        proof_hash = ${assessment.proofHash},
        verified_at = now(),
        permanent = ${assessment.status === "unverifiable"},
        last_error = ${assessment.status === "unverifiable" ? "One or more checks failed." : null},
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        updated_at = now()
      where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${id}
        and verification_status <> 'receipt_verified'
    `;
    const next = await readProof(sql, id);
    if (next && assessment.status === "receipt_verified") {
      try {
        await publishDeveloperEvent("proof.verified", {
          executionId: id,
          agentId: action.agent_id,
          proofHash: next.proofHash,
        });
      } catch (err) {
        console.error("[agenttrace-webhook]", err);
      }
    }
    if (next && assessment.status === "unverifiable" && current.verificationStatus !== "unverifiable") {
      try {
        await publishDeveloperEvent("proof.unverifiable", {
          executionId: id,
          agentId: action.agent_id,
          proofHash: next.proofHash,
        });
      } catch (err) {
        console.error("[agenttrace-webhook]", err);
      }
    }
    return next;
  } catch (err) {
    const message = err instanceof Error ? err.message : "The RPC request failed.";
    await markTemporary(sql, id, message);
    return readProof(sql, id);
  }
}

export async function settlePendingProofs(limit = 1): Promise<void> {
  const sql = await getSql();
  const rows = await sql<{ execution_id: string }>`
    select execution_id from execution_proofs
    where chain_id = ${MONAD_TESTNET.chainId}
      and permanent = false
      and verification_status in ('executed', 'requested', 'temporary_error')
      and attempt_count < 12
      and (last_attempt_at is null or last_attempt_at < now() - interval '20 seconds')
    order by created_at asc
    limit ${limit}
  `;
  for (const row of rows) {
    await verifyIndexedExecution(row.execution_id, false);
  }
}

function recomputedHash(proof: ProofRecord): `0x${string}` | null {
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.executionId)) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.txHash)) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(proof.executor)) return null;
  if (!/^0x[a-fA-F0-9]{40}$/.test(proof.target)) return null;
  if (!/^0x[a-fA-F0-9]{8}$/.test(proof.functionSelector)) return null;
  if (!/^0x[a-fA-F0-9]{64}$/.test(proof.calldataHash)) return null;
  try {
    return computeProofHash({
      chainId: BigInt(MONAD_TESTNET.chainId),
      agentId: BigInt(proof.agentId),
      firewallId: BigInt(proof.firewallId),
      executionId: proof.executionId as `0x${string}`,
      executor: proof.executor as `0x${string}`,
      transactionHash: proof.txHash as `0x${string}`,
      blockNumber: BigInt(proof.blockNumber),
      target: proof.target as `0x${string}`,
      functionSelector: proof.functionSelector as `0x${string}`,
      value: BigInt(proof.value),
      calldataHash: proof.calldataHash as `0x${string}`,
    });
  } catch {
    return null;
  }
}

async function receiptStillMatches(proof: ProofRecord): Promise<string | null> {
  const firewall = configuredFirewall();
  if (!firewall) return "Agent Firewall is not deployed. No anchor transaction was sent.";
  const sql = await getSql();
  const actions = await sql<{
    execution_id: string;
    agent_id: string;
    firewall_id: string;
    executor: string;
    target: string;
    selector: string;
    value: string;
    calldata_hash: string;
    tx_hash: string;
    block_number: number | string;
    agent_exists: boolean;
    firewall_agent_id: string | null;
  }>`
    select fa.execution_id, fa.agent_id, fa.firewall_id, fa.executor, fa.target, fa.selector, fa.value,
           fa.calldata_hash, fa.tx_hash, fa.block_number,
           (ia.agent_id is not null) as agent_exists,
           fw.agent_id as firewall_agent_id
    from firewall_actions fa
    left join indexed_agents ia on ia.chain_id = fa.chain_id and ia.agent_id = fa.agent_id
    left join indexed_firewalls fw on fw.chain_id = fa.chain_id and fw.firewall_id = fa.firewall_id
    where fa.chain_id = ${MONAD_TESTNET.chainId} and fa.execution_id = ${proof.executionId}
  `;
  const action = actions[0];
  if (!action) return "No AgentAction is indexed for this execution. No anchor transaction was sent.";
  const client = getPublicClient();
  const hash = action.tx_hash as Hex;
  try {
    const tx = await client.getTransaction({ hash });
    const receipt = await client.getTransactionReceipt({ hash });
    const assessment = assessExecution({
      action: {
        executionId: action.execution_id,
        agentId: action.agent_id,
        firewallId: action.firewall_id,
        executor: action.executor,
        target: action.target,
        selector: action.selector,
        value: action.value,
        calldataHash: action.calldata_hash,
        txHash: action.tx_hash,
        blockNumber: Number(action.block_number),
      },
      agentExists: action.agent_exists,
      firewallAgentId: action.firewall_agent_id,
      firewallContract: firewall,
      tx: { hash: tx.hash, from: tx.from, to: tx.to, input: tx.input, value: tx.value },
      receipt: {
        status: receipt.status,
        transactionHash: receipt.transactionHash,
        blockNumber: Number(receipt.blockNumber),
        logs: receipt.logs.map((log) => ({
          address: log.address,
          topics: log.topics,
          data: log.data,
        })) as AssessedLog[],
      },
    });
    if (assessment.status !== "receipt_verified" || assessment.proofHash !== proof.proofHash?.toLowerCase()) {
      return "The receipt does not match this proof. No anchor transaction was sent.";
    }
    return null;
  } catch (err) {
    if (notFound(err)) return "The transaction is not available on the RPC. No anchor transaction was sent.";
    const message = err instanceof Error ? err.message : "The receipt could not be read again.";
    return `${message} No anchor transaction was sent.`;
  }
}

export async function anchorVerifiedProof(
  executionId: string,
): Promise<{ anchored: boolean; reason: string; txHash: string | null; proof: ProofRecord | null }> {
  const proof = await getExecutionProof(executionId);
  if (!proof) {
    return { anchored: false, reason: "No AgentAction is indexed for this execution.", txHash: null, proof: null };
  }
  if (proof.anchored && proof.anchorTxHash) {
    return { anchored: true, reason: "Already anchored.", txHash: proof.anchorTxHash, proof };
  }
  if (proof.verificationStatus !== "receipt_verified" || !proof.proofHash) {
    return {
      anchored: false,
      reason: "Only a receipt-verified proof can be anchored.",
      txHash: null,
      proof,
    };
  }
  const again = recomputedHash(proof);
  if (!again || again !== proof.proofHash.toLowerCase()) {
    return { anchored: false, reason: "Stored proof hash does not match the execution record.", txHash: null, proof };
  }
  const contract = configuredProofAnchor();
  const key = verifierKey();
  if (!contract || !key) {
    return {
      anchored: false,
      reason: "Verifier credentials are not configured. No anchor transaction was sent.",
      txHash: null,
      proof,
    };
  }
  const account = privateKeyToAccount(key);
  const still = await receiptStillMatches(proof);
  if (still) return { anchored: false, reason: still, txHash: null, proof };
  const rpcUrl = monadRpcUrl();
  const chain = monadChain();
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 20_000 }) });
  const publicClient = createPublicClient({ chain, transport: monadTransport(20_000) });
  try {
    const hash = await wallet.writeContract({
      address: contract,
      abi: agentProofAbi,
      functionName: "anchorProof",
      args: [
        proof.proofHash as Hex,
        proof.executionId as Hex,
        BigInt(proof.agentId),
        BigInt(proof.firewallId),
        proof.txHash as Hex,
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== "success") {
      return { anchored: false, reason: "The anchor transaction reverted. The proof was not anchored.", txHash: hash, proof };
    }
    for (const log of receipt.logs) await applyProofLog(log);
    const next = await getExecutionProof(proof.executionId);
    if (!next?.anchored) {
      return {
        anchored: false,
        reason: "The transaction confirmed but the proof hash was not anchored for this execution.",
        txHash: hash,
        proof: next,
      };
    }
    return { anchored: true, reason: "Proof anchored.", txHash: hash, proof: next };
  } catch (err) {
    const message = err instanceof Error ? err.message : "The anchor transaction was not sent.";
    return { anchored: false, reason: message, txHash: null, proof };
  }
}

export async function applyProofLog(log: { address?: string; topics: Hex[]; data: Hex; blockNumber?: bigint | null; transactionHash?: Hex | null }): Promise<void> {
  const contract = configuredProofAnchor();
  if (!contract || !log.address || log.address.toLowerCase() !== contract) return;
  if (log.topics.length === 0) return;
  let decoded: { eventName: string; args: Record<string, unknown> };
  try {
    decoded = decodeEventLog({
      abi: agentProofAbi,
      data: log.data,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    }) as {
      eventName: string;
      args: Record<string, unknown>;
    };
  } catch {
    return;
  }
  if (decoded.eventName !== "ExecutionProofAnchored") return;
  const executionId = String(decoded.args.executionId ?? "").toLowerCase();
  const proofHash = String(decoded.args.proofHash ?? "").toLowerCase();
  const txHash = String(decoded.args.transactionHash ?? "").toLowerCase();
  if (!/^0x[a-fA-F0-9]{64}$/.test(executionId) || !/^0x[a-fA-F0-9]{64}$/.test(proofHash)) return;
  const sql = await getSql();
  await sql`
    update execution_proofs set
      anchored = true,
      anchor_tx_hash = ${log.transactionHash?.toLowerCase() ?? null},
      anchor_block_number = ${log.blockNumber == null ? null : Number(log.blockNumber)},
      updated_at = now()
    where chain_id = ${MONAD_TESTNET.chainId}
      and execution_id = ${executionId}
      and proof_hash = ${proofHash}
      and tx_hash = ${txHash}
      and verification_status = 'receipt_verified'
  `;
}
