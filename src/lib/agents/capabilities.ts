import { CAPABILITIES, type Capability } from "./types.ts";

/** Onchain bit order. Matches AgentRegistry. */
const BIT_ORDER = [
  "Trading",
  "Yield",
  "DeFi",
  "Payments",
  "Research",
  "Data",
  "Social",
  "Gaming",
  "Other",
] as const satisfies readonly Capability[];

export const CAPABILITY_BITS: Record<Capability, bigint> = {
  Trading: 1n << 0n,
  Yield: 1n << 1n,
  DeFi: 1n << 2n,
  Payments: 1n << 3n,
  Research: 1n << 4n,
  Data: 1n << 5n,
  Social: 1n << 6n,
  Gaming: 1n << 7n,
  Other: 1n << 8n,
};

export const CAPABILITY_MASK = (1n << BigInt(BIT_ORDER.length)) - 1n;

export function encodeCapabilities(names: readonly string[]): bigint {
  let bits = 0n;
  for (const name of names) {
    if (!isCapability(name)) throw new Error("Unknown capability.");
    bits |= CAPABILITY_BITS[name];
  }
  if (bits === 0n || (bits & ~CAPABILITY_MASK) !== 0n) throw new Error("Invalid capabilities.");
  return bits;
}

export function decodeCapabilities(bits: bigint): Capability[] {
  const names: Capability[] = [];
  for (const name of BIT_ORDER) {
    if ((bits & CAPABILITY_BITS[name]) !== 0n) names.push(name);
  }
  return names;
}

export function capabilitiesFromChain(value: unknown): { names: Capability[]; bits: string } {
  let bits = 0n;
  if (typeof value === "bigint") bits = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) bits = BigInt(value);
  else if (typeof value === "string" && /^\d+$/.test(value)) bits = BigInt(value);
  else if (typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)) bits = BigInt(value);
  return { names: decodeCapabilities(bits), bits: bits.toString(10) };
}

function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
