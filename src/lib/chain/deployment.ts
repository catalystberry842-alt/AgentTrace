/**
 * Public record of contract deployments on Monad testnet (chain id 10143).
 * Written by scripts/deploy-contracts.mjs only after each confirmed Monad transaction.
 * Never invent an address here.
 */
export const deployment = {
  chainId: 10143 as const,
  agentRegistry: "0xfa66d202dae4b7fb9aa5c6ee80390ca8bb48739e" as `0x${string}`,
  deployBlock: 67788394 as number | null,
  deployTx: "0x3426bbc9643ea6f04e278d109645d036aa85a9e3d485cd9f6cc3bbd98fc2dfff" as `0x${string}`,
  agentFirewall: "0x694178a2396b54bff6a25caa0aa9cca6eb079441" as `0x${string}`,
  firewallDeployBlock: 67788397 as number | null,
  firewallDeployTx: "0x9346cf54288f0cd0683e0c92a1e0ce50727d84409eb51a2a2bcb072a6f282044" as `0x${string}`,
  agentProof: "0x3ea5602072d6028f569f45ea164d5cbe36cbbd3e" as `0x${string}`,
  proofDeployBlock: 67788400 as number | null,
  proofDeployTx: "0x4e0172478ce7dde026c13d6c020cd5788e4ba64a9cf42d38554c02643b2d95b4" as `0x${string}`,
  /** AgentTrace Demo Protocol. Null until a confirmed testnet deployment exists. */
  demoProtocol: "0x1664be58ee54af91c756428f466bad6e4f9911c3" as `0x${string}`,
  demoProtocolDeployBlock: 67788404 as number | null,
  demoProtocolDeployTx: "0xd9f5fad6e0043f9980e084643ea60dc47c6572139072de9f6ded64c20f38bdae" as `0x${string}`,
};
