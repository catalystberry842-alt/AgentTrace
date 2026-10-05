/**
 * Public record of contract deployments on Monad mainnet (chain id 143).
 * Written by scripts/deploy-contracts.mjs only after each confirmed Monad transaction.
 * Never invent an address here.
 */
export const mainnetDeployment = {
  chainId: 143 as const,
  agentRegistry: "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e" as `0x${string}`,
  deployBlock: 110869327 as number | null,
  deployTx: "0x65bf8edd7aefa5805afae5984e94f6f0e65315a9fc9f152b3e25900d4a395255" as `0x${string}`,
  agentFirewall: "0x694178a2396b54bff6a25caa0aa9cca6eb079441" as `0x${string}`,
  firewallDeployBlock: 110869330 as number | null,
  firewallDeployTx: "0xd1c07b28ad4c7e937bc2d5f78124cb14cefe4ac3c0f22ffea3f131c9663e308f" as `0x${string}`,
  agentProof: "0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e" as `0x${string}`,
  proofDeployBlock: 110869333 as number | null,
  proofDeployTx: "0xa347bfa7657e54d7457c52b0503eed3209df39e10def8fe3798646bd89a47619" as `0x${string}`,
  /** AgentTrace Demo Protocol. Null until a confirmed deployment exists. */
  demoProtocol: "0x1664be58ee54af91c756428f466bad6e4f9911c3" as `0x${string}`,
  demoProtocolDeployBlock: 110869336 as number | null,
  demoProtocolDeployTx: "0x3e13bee34bd16a9701c6372d6338245f593b411f52e9e0fd2b63a2e25ce38b37" as `0x${string}`,
};
