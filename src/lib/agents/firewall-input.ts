const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const UINT = /^\d+$/;
const UINT64_MAX = 18446744073709551615n;
const ZERO = "0x0000000000000000000000000000000000000000";

export type FirewallDraft = {
  agentId: string;
  executor: `0x${string}`;
  allowValueTransfer: boolean;
  maxValuePerTransaction: string;
  maxValuePerPeriod: string;
  periodDuration: string;
};

export function parseFirewallDraft(
  input: unknown,
): { ok: true; value: FirewallDraft } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "Invalid firewall." };
  const raw = input as Record<string, unknown>;
  if (typeof raw.agentId !== "string" || !/^[1-9]\d*$/.test(raw.agentId)) {
    return { ok: false, error: "Select an agent." };
  }
  if (typeof raw.executor !== "string" || !ADDRESS.test(raw.executor)) {
    return { ok: false, error: "Executor must be an address." };
  }
  if (raw.executor.toLowerCase() === ZERO) {
    return { ok: false, error: "Executor cannot be the zero address." };
  }
  if (typeof raw.allowValueTransfer !== "boolean") {
    return { ok: false, error: "Value transfer must be explicit." };
  }
  const maxTx = typeof raw.maxValuePerTransaction === "string" ? raw.maxValuePerTransaction.trim() : "";
  const maxPeriod = typeof raw.maxValuePerPeriod === "string" ? raw.maxValuePerPeriod.trim() : "";
  const period = typeof raw.periodDuration === "string" ? raw.periodDuration.trim() : "";
  if (!UINT.test(period) || period === "0") return { ok: false, error: "Period length must be greater than zero." };
  if (BigInt(period) > UINT64_MAX) return { ok: false, error: "Period length is too large." };
  if (!raw.allowValueTransfer) {
    if ((maxTx !== "" && maxTx !== "0") || (maxPeriod !== "" && maxPeriod !== "0")) {
      return { ok: false, error: "Value limits must be zero when value transfer is disabled." };
    }
  } else {
    if (!UINT.test(maxTx) || maxTx === "0") {
      return { ok: false, error: "Max value per transaction must be greater than zero." };
    }
    if (!UINT.test(maxPeriod)) return { ok: false, error: "Max value per period is required." };
    if (BigInt(maxPeriod) < BigInt(maxTx)) {
      return { ok: false, error: "The period limit must cover at least one transaction." };
    }
  }
  return {
    ok: true,
    value: {
      agentId: raw.agentId,
      executor: raw.executor.toLowerCase() as `0x${string}`,
      allowValueTransfer: raw.allowValueTransfer,
      maxValuePerTransaction: raw.allowValueTransfer ? maxTx : "0",
      maxValuePerPeriod: raw.allowValueTransfer ? maxPeriod : "0",
      periodDuration: period,
    },
  };
}
