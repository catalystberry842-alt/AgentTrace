/**
 * Public record of contract deployments.
 * Addresses stay null until a confirmed Monad transaction writes them.
 * Never invent an address here.
 */
export const deployment = {
  chainId: 10143 as const,
  agentRegistry: null as `0x${string}` | null,
  deployBlock: null as number | null,
  deployTx: null as `0x${string}` | null,
  agentFirewall: null as `0x${string}` | null,
  firewallDeployBlock: null as number | null,
  firewallDeployTx: null as `0x${string}` | null,
  agentProof: null as `0x${string}` | null,
  proofDeployBlock: null as number | null,
  proofDeployTx: null as `0x${string}` | null,
  /** AgentTrace Demo Protocol. Null until a confirmed testnet deployment exists. */
  demoProtocol: null as `0x${string}` | null,
};
