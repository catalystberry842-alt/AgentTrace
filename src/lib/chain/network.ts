/**
 * Monad network constants. Public values only — no keys.
 *
 * One build serves one network, chosen with VITE_MONAD_NETWORK ("testnet" by default, or
 * "mainnet"). The hosted testnet app and the mainnet app are the same code with a different value.
 */
const TESTNET = {
  key: "testnet",
  chainId: 10143,
  chainIdHex: "0x279f",
  name: "Monad Testnet",
  label: "Monad testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  /**
   * Other public testnet endpoints listed at docs.monad.xyz/developer-essentials/testnets.
   * Used, in order, when the primary endpoint fails or rate-limits.
   */
  fallbackRpcUrls: ["https://rpc-testnet.monadinfra.com", "https://rpc.ankr.com/monad_testnet"],
  explorerUrl: "https://testnet.monadvision.com",
  nativeSymbol: "MON",
  /**
   * Public RPCs cap eth_getLogs at 100 blocks per call (docs.monad.xyz/reference/rpc-limits).
   * Larger ranges are rejected.
   */
  maxLogBlockRange: 100,
} as const;

const MAINNET = {
  key: "mainnet",
  chainId: 143,
  chainIdHex: "0x8f",
  name: "Monad",
  label: "Monad mainnet",
  rpcUrl: "https://rpc.monad.xyz",
  fallbackRpcUrls: ["https://rpc-mainnet.monadinfra.com"],
  explorerUrl: "https://monadvision.com",
  nativeSymbol: "MON",
  maxLogBlockRange: 100,
} as const;

export type MonadNetwork = typeof TESTNET | typeof MAINNET;

function selected(): "testnet" | "mainnet" {
  let value: string | undefined;
  try {
    value = import.meta.env?.VITE_MONAD_NETWORK as string | undefined;
  } catch {
    value = undefined;
  }
  if (!value && typeof process !== "undefined") value = process.env?.VITE_MONAD_NETWORK;
  return value?.trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
}

export const MONAD_NETWORKS = { testnet: TESTNET, mainnet: MAINNET } as const;

/** The network this build serves. */
export const MONAD: MonadNetwork = selected() === "mainnet" ? MAINNET : TESTNET;

/**
 * Historical name for the active network, kept so existing imports stay unchanged.
 * On a mainnet build it holds the mainnet values.
 */
export const MONAD_TESTNET: MonadNetwork = MONAD;

export const IS_MAINNET = MONAD.key === "mainnet";
