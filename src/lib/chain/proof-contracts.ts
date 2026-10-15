/**
 * Which proof contracts the server writes to and reads anchors from.
 * - Default (no AGENT_PROOF_QUORUM_ADDRESS): write + read the single-verifier AgentProof (unchanged).
 * - Quorum mode: write (attest) to AgentProofQuorum; read anchors from BOTH, AgentProof first, so
 *   proofs anchored before the switch keep showing as anchored.
 */
type Env = Record<string, string | undefined>;
type Addr = `0x${string}`;

const ADDR = /^0x[a-fA-F0-9]{40}$/;

export function quorumAddress(env: Env): Addr | null {
  const raw = env.AGENT_PROOF_QUORUM_ADDRESS?.trim() ?? "";
  return ADDR.test(raw) ? (raw.toLowerCase() as Addr) : null;
}

export function quorumDeployBlock(env: Env): number | null {
  const raw = env.AGENT_PROOF_QUORUM_DEPLOY_BLOCK?.trim() ?? "";
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

export function writeTarget(legacy: Addr | null, env: Env): Addr | null {
  return quorumAddress(env) ?? legacy;
}

export function readContracts(legacy: Addr | null, env: Env): Addr[] {
  const out: Addr[] = [];
  for (const a of [legacy?.toLowerCase() as Addr | undefined, quorumAddress(env)]) if (a && !out.includes(a)) out.push(a);
  return out;
}
