import { decodeFunctionData, getAddress, parseAbi, type Hex } from "viem";

/**
 * Pure outcome adapters for known protocol calls. The expectation is derived from the execution
 * itself (target, selector, value, inner calldata), never supplied by the caller.
 *
 * - WMON deposit()                    -> Deposit(caller, value)
 * - WMON withdraw(uint256 wad)        -> Withdrawal(caller, wad)
 * - any ERC-20 transfer(dst, wad)     -> Transfer(caller, dst, wad)
 * - any ERC-20 approve(guy, wad)      -> Approval(caller, guy, wad)
 * - any ERC-20 transferFrom(src,dst,wad) -> Transfer(src, dst, wad)
 *
 * `caller` is the contract that made the call (the AgentFirewall, or the agent's vault on V3),
 * because tokens and WETH9 credit msg.sender.
 */
export const SELECTORS = {
  deposit: "0xd0e30db0",
  withdraw: "0x2e1a7d4d",
  transfer: "0xa9059cbb",
  approve: "0x095ea7b3",
  transferFrom: "0x23b872dd",
} as const;

const tokenAbi = parseAbi([
  "function deposit() payable",
  "function withdraw(uint256 wad)",
  "function transfer(address dst, uint256 wad) returns (bool)",
  "function approve(address guy, uint256 wad) returns (bool)",
  "function transferFrom(address src, address dst, uint256 wad) returns (bool)",
]);

export type EventExpectation = {
  type: "EVENT_EMITTED";
  event: string;
  eventSignature: string;
  conditions: Record<string, { operator: "=="; value: string }>;
};

export type ProtocolCall = {
  target: string;
  selector: string;
  value: bigint;
  /** Inner calldata the firewall forwarded; required for everything except deposit(). */
  data?: Hex;
  caller: string;
  /** Canonical WMON on this chain, if any. deposit/withdraw are only judged on WMON. */
  wmon?: string;
};

export type Derived = { ok: true; expectation: EventExpectation } | { ok: false; reason: string };

const eq = (value: string) => ({ operator: "==" as const, value });

export function deriveProtocolExpectation(call: ProtocolCall): Derived {
  const selector = call.selector.toLowerCase();
  const isWmon = !!call.wmon && call.target.toLowerCase() === call.wmon.toLowerCase();
  const caller = getAddress(call.caller);
  if (selector === SELECTORS.deposit) {
    if (!isWmon) return { ok: false, reason: "deposit() is only judged on canonical WMON." };
    return { ok: true, expectation: { type: "EVENT_EMITTED", event: "Deposit", eventSignature: "Deposit(address,uint256)", conditions: { arg0: eq(caller), arg1: eq(call.value.toString()) } } };
  }
  if (!call.data) return { ok: false, reason: "Calldata is required for this function." };
  let decoded;
  try {
    decoded = decodeFunctionData({ abi: tokenAbi, data: call.data });
  } catch {
    return { ok: false, reason: "Calldata does not decode as a supported token function." };
  }
  if (call.data.slice(0, 10).toLowerCase() !== selector) return { ok: false, reason: "Calldata selector does not match the indexed selector." };
  switch (decoded.functionName) {
    case "withdraw":
      if (!isWmon) return { ok: false, reason: "withdraw(uint256) is only judged on canonical WMON." };
      return { ok: true, expectation: { type: "EVENT_EMITTED", event: "Withdrawal", eventSignature: "Withdrawal(address,uint256)", conditions: { arg0: eq(caller), arg1: eq(decoded.args[0].toString()) } } };
    case "transfer":
      return { ok: true, expectation: { type: "EVENT_EMITTED", event: "Transfer", eventSignature: "Transfer(address,address,uint256)", conditions: { arg0: eq(caller), arg1: eq(getAddress(decoded.args[0])), arg2: eq(decoded.args[1].toString()) } } };
    case "approve":
      return { ok: true, expectation: { type: "EVENT_EMITTED", event: "Approval", eventSignature: "Approval(address,address,uint256)", conditions: { arg0: eq(caller), arg1: eq(getAddress(decoded.args[0])), arg2: eq(decoded.args[1].toString()) } } };
    case "transferFrom":
      return { ok: true, expectation: { type: "EVENT_EMITTED", event: "Transfer", eventSignature: "Transfer(address,address,uint256)", conditions: { arg0: eq(getAddress(decoded.args[0])), arg1: eq(getAddress(decoded.args[1])), arg2: eq(decoded.args[2].toString()) } } };
    default:
      return { ok: false, reason: "No built-in outcome adapter for this function." };
  }
}
