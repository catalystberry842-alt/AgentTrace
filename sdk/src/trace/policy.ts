import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { AgentTraceError } from "../errors/error.ts";

/**
 * Off-chain argument cap, checked by traceCall before anything is simulated or sent.
 *
 * `argIndex` is the 0-based index of a static uint256 argument after the 4-byte selector,
 * e.g. 1 for `amount` in deposit(uint256 agentId, uint256 amount). This is the same rule shape
 * as AgentFirewallV2.setArgCap, so a limit enforced here can later move onchain unchanged.
 *
 * It runs inside the agent's own process. It protects against a confused or prompt-injected
 * model, not against someone who holds the executor key and bypasses the SDK; for that the
 * cap has to be onchain (AgentFirewallV2) or the call has to be impossible (AgentFirewall
 * target/selector allowlist, which is enforced onchain today).
 */
export type AmountLimit = {
  /** 0x-prefixed 4-byte selector, e.g. toFunctionSelector("deposit(uint256,uint256)"). */
  selector: Hex;
  /** Limit applies to this target only. Omit to apply to every target with this selector. */
  target?: Address;
  argIndex: number;
  maxAmount: bigint;
};

export function validateLimits(limits: readonly AmountLimit[]): void {
  for (const limit of limits) {
    if (!isHex(limit.selector) || limit.selector.length !== 10) {
      throw new AgentTraceError("BAD_POLICY", `Limit selector ${String(limit.selector)} is not a 4-byte hex selector.`, 400);
    }
    if (!Number.isInteger(limit.argIndex) || limit.argIndex < 0 || limit.argIndex > 255) {
      throw new AgentTraceError("BAD_POLICY", `Limit argIndex ${String(limit.argIndex)} must be an integer from 0 to 255.`, 400);
    }
    if (typeof limit.maxAmount !== "bigint" || limit.maxAmount < 0n) {
      throw new AgentTraceError("BAD_POLICY", "Limit maxAmount must be a non-negative bigint.", 400);
    }
    if (limit.target !== undefined && !isAddress(limit.target)) {
      throw new AgentTraceError("BAD_POLICY", `Limit target ${String(limit.target)} is not an address.`, 400);
    }
  }
}

/** Throws POLICY_REJECTED when calldata breaks a limit. Nothing has been sent at that point. */
export function enforceLimits(limits: readonly AmountLimit[] | undefined, target: Address, data: Hex): void {
  if (!limits?.length) return;
  validateLimits(limits);
  if (!isHex(data) || data.length < 10) {
    throw new AgentTraceError("POLICY_REJECTED", "Calldata is shorter than a selector. Nothing was sent.", 403);
  }
  const selector = data.slice(0, 10).toLowerCase();
  for (const limit of limits) {
    if (limit.selector.toLowerCase() !== selector) continue;
    if (limit.target && getAddress(limit.target) !== getAddress(target)) continue;
    const start = 10 + limit.argIndex * 64;
    const word = data.slice(start, start + 64);
    if (word.length !== 64) {
      throw new AgentTraceError(
        "POLICY_REJECTED",
        `Argument ${limit.argIndex} of ${selector} is missing from the calldata, so its limit cannot be checked. Nothing was sent.`,
        403,
      );
    }
    const amount = BigInt(`0x${word}`);
    if (amount > limit.maxAmount) {
      throw new AgentTraceError(
        "POLICY_REJECTED",
        `Argument ${limit.argIndex} of ${selector} is ${amount}, above the maxAmount ${limit.maxAmount}. Nothing was sent.`,
        403,
      );
    }
  }
}
