import { deployment } from "@/lib/chain/deployment";

/** One reader for public contract addresses. Env overrides the deployment record. Never invent an address. */
export function readAddress(fallback: `0x${string}` | null, ...envNames: string[]): `0x${string}` | null {
  for (const name of envNames) {
    const value = process.env[name]?.trim() ?? "";
    if (/^0x[a-fA-F0-9]{40}$/.test(value)) return value.toLowerCase() as `0x${string}`;
  }
  return fallback ? (fallback.toLowerCase() as `0x${string}`) : null;
}

export function configuredDemoProtocol(): `0x${string}` | null {
  return readAddress(deployment.demoProtocol, "MONAD_TESTNET_DEMO_PROTOCOL", "AGENT_DEMO_PROTOCOL");
}
