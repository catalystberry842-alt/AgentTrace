export function computeProofHash(fields: Record<string, unknown>): `0x${string}`;
export function verifyProof(input: {
  id: string;
  chain?: "mainnet" | "testnet";
  rpc?: string;
  log?: (line: string) => void;
  firewall?: string;
  proof?: string;
  requireAnchor?: boolean;
}): Promise<{ pass: boolean; checks: { name: string; ok: boolean }[]; proofHash?: string; executionId?: string }>;
