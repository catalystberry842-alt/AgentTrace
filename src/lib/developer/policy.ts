import type { FirewallRecord } from "@/lib/agents/types";
import type { ApiErrorCode } from "@/lib/developer/errors";

export type PolicyCall = { target: string; value: string; data: string };

export type PolicyDecision =
  | { ok: true; selector: string }
  | { ok: false; code: ApiErrorCode; message: string };

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const UINT = /^\d+$/;

/** Indexed firewall policy. This does not send a transaction. */
export function assessFirewallCall(firewall: FirewallRecord, call: PolicyCall): PolicyDecision {
  if (!firewall.active) {
    return { ok: false, code: "FIREWALL_INACTIVE", message: "The firewall is not active. No transaction was sent." };
  }
  if (firewall.paused || firewall.status === "paused") {
    return { ok: false, code: "FIREWALL_PAUSED", message: "The firewall is currently paused." };
  }
  if (!ADDRESS.test(call.target)) {
    return { ok: false, code: "INVALID_REQUEST", message: "Target must be an address." };
  }
  if (!UINT.test(call.value)) {
    return { ok: false, code: "INVALID_REQUEST", message: "Value must be a decimal amount of wei." };
  }
  if (!/^0x[a-fA-F0-9]*$/.test(call.data) || call.data.length < 10) {
    return { ok: false, code: "INVALID_REQUEST", message: "Call data must include a 4-byte function selector." };
  }
  const target = call.target.toLowerCase();
  const selector = call.data.slice(0, 10).toLowerCase();
  const targetAllowed = firewall.allowedTargets.some((item) => item.active && item.target.toLowerCase() === target);
  if (!targetAllowed) {
    return { ok: false, code: "TARGET_NOT_ALLOWED", message: "The target is not allowed by this firewall." };
  }
  const functionAllowed = firewall.allowedFunctions.some(
    (item) => item.active && item.target.toLowerCase() === target && item.selector.toLowerCase() === selector,
  );
  if (!functionAllowed) {
    return { ok: false, code: "FUNCTION_NOT_ALLOWED", message: "The function selector is not allowed by this firewall." };
  }
  const amount = BigInt(call.value);
  if (amount > 0n) {
    if (!firewall.allowValueTransfer) {
      return { ok: false, code: "VALUE_LIMIT_EXCEEDED", message: "Value transfer is disabled on this firewall." };
    }
    if (amount > BigInt(firewall.maxValuePerTransaction || "0")) {
      return { ok: false, code: "VALUE_LIMIT_EXCEEDED", message: "The value exceeds the per-transaction limit." };
    }
    const spent = BigInt(firewall.spentInPeriod || "0");
    const cap = BigInt(firewall.maxValuePerPeriod || "0");
    if (amount + spent > cap) {
      return { ok: false, code: "VALUE_LIMIT_EXCEEDED", message: "The value exceeds the remaining period limit." };
    }
  }
  return { ok: true, selector };
}
