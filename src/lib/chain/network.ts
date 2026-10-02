/** Monad testnet. Public chain constants only — no keys. */
export const MONAD_TESTNET = {
  chainId: 10143,
  chainIdHex: "0x279f",
  name: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  /**
   * Other public testnet endpoints listed at docs.monad.xyz/developer-essentials/testnets.
   * Used, in order, when the primary endpoint fails or rate-limits.
   */
  fallbackRpcUrls: ["https://rpc-testnet.monadinfra.com", "https://rpc.ankr.com/monad_testnet"],
  explorerUrl: "https://testnet.monadvision.com",
  nativeSymbol: "MON",
  /**
   * Public testnet RPCs cap eth_getLogs at 100 blocks per call
   * (docs.monad.xyz/reference/rpc-limits). Larger ranges are rejected.
   */
  maxLogBlockRange: 100,
} as const;
