import { getSql } from "@/lib/db";
import { ingestFirewallReceipt } from "@/lib/chain/firewall.server";
import { MONAD_TESTNET } from "@/lib/chain/network";

/**
 * Optional body { "transactionHash": "0x..." }: if this instance has not indexed the execution yet,
 * the server reads that receipt from Monad itself. The hash is only a hint; a proof still comes from
 * the receipt and the AgentAction log, never from the caller.
 */
export async function ingestReceiptHint(request: Request, executionId: string): Promise<void> {
  let hash: unknown;
  try {
    hash = ((await request.json()) as { transactionHash?: unknown })?.transactionHash;
  } catch {
    return;
  }
  if (typeof hash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(hash)) return;
  const sql = await getSql();
  const found = await sql<{ execution_id: string }>`
    select execution_id from firewall_actions
    where chain_id = ${MONAD_TESTNET.chainId} and execution_id = ${executionId.toLowerCase()}
  `;
  if (!found.length) await ingestFirewallReceipt(sql, hash.toLowerCase() as `0x${string}`).catch(() => undefined);
}
