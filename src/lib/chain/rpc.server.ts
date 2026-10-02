import { MONAD_TESTNET } from "@/lib/chain/network";

/** Server-only RPC. A public https URL may override the default. Secrets never belong here. */
export function monadRpcUrl(): string {
  const fromEnv = process.env.MONAD_TESTNET_RPC_URL?.trim() ?? "";
  if (fromEnv.startsWith("https://") && !/\s/.test(fromEnv) && fromEnv.length < 300) return fromEnv;
  return MONAD_TESTNET.rpcUrl;
}
