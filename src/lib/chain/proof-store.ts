import type { Sql } from "@/lib/db";
import { MONAD_TESTNET } from "@/lib/chain/network";
import { proofIdFor } from "@/lib/chain/proof-hash";

export async function ensureExecutedProof(
  sql: Sql,
  action: {
    executionId: string;
    agentId: string;
    firewallId: string;
    executor: string;
    target: string;
    selector: string;
    value: string;
    calldataHash: string;
    txHash: string;
    blockNumber: number;
    timestampUnix: number | null;
  },
): Promise<void> {
  if (!/^0x[a-fA-F0-9]{64}$/.test(action.executionId)) return;
  const proofId = proofIdFor(MONAD_TESTNET.chainId, action.executionId.toLowerCase() as `0x${string}`);
  await sql`
    insert into execution_proofs (
      chain_id, proof_id, execution_id, agent_id, firewall_id, executor, tx_hash, block_number,
      block_timestamp, target, function_selector, value, calldata_hash, verification_status,
      anchored, created_at, updated_at
    ) values (
      ${MONAD_TESTNET.chainId},
      ${proofId},
      ${action.executionId.toLowerCase()},
      ${action.agentId},
      ${action.firewallId},
      ${action.executor.toLowerCase()},
      ${action.txHash.toLowerCase()},
      ${action.blockNumber},
      to_timestamp(${action.timestampUnix}::double precision),
      ${action.target.toLowerCase()},
      ${action.selector.toLowerCase()},
      ${action.value},
      ${action.calldataHash.toLowerCase()},
      'executed',
      false,
      now(),
      now()
    )
    on conflict (chain_id, execution_id) do nothing
  `;
}
