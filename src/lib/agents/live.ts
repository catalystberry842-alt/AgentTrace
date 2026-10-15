import { createServerFn } from "@tanstack/react-start";

export type LiveStats = {
  agents: number | null;
  firewalls: number | null;
  verifiedExecutions: number | null;
  anchoredProofs: number | null;
  latestBlock: number | null;
  readAt: string;
};

export type VerifyCheck = { name: string; ok: boolean };
export type VerifyResult = {
  pass: boolean;
  executionId: string | null;
  proofHash: string | null;
  checks: VerifyCheck[];
  log: string[];
  error: string | null;
};

/** Live counters, read from the chain (registry/firewall counters, latest block) and the receipt-verified index. */
export const getLiveStats = createServerFn({ method: "GET" }).handler(async (): Promise<LiveStats> => {
  const { readLiveStats } = await import("@/lib/chain/stats.server");
  return readLiveStats();
});

/** Independent proof recompute: the same steps as scripts/verify-proof.mjs, run against a public Monad RPC. */
export const verifyOnchain = createServerFn({ method: "POST" })
  .validator((id: string) => String(id ?? "").trim().slice(0, 80))
  .handler(async ({ data }): Promise<VerifyResult> => {
    const { enforceRateLimit } = await import("@/lib/rate-limit.server");
    enforceRateLimit("verifyOnchain", 20);
    const { recomputeProof } = await import("@/lib/chain/stats.server");
    return recomputeProof(data);
  });
