import { useCallback, useSyncExternalStore } from "react";
import { getServerWalletState, getWalletState, subscribeWallet, disconnectWallet, setWalletConnecting } from "@/lib/chain/wallet-store";
import { MONAD_TESTNET } from "@/lib/chain/network";

/**
 * The app-wide wallet connection (see wallet-store). Connecting here, from the header or any
 * page, switches the wallet to Monad and unlocks every write action; nothing else signs in.
 */
export function useWalletAccount(): {
  address: `0x${string}` | null;
  chainId: string | null;
  onMonad: boolean;
  ready: boolean;
  available: boolean;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  error: string | null;
} {
  const state = useSyncExternalStore(subscribeWallet, getWalletState, getServerWalletState);
  const connect = useCallback(async () => {
    setWalletConnecting(true);
    try {
      const { connectWallet } = await import("@/lib/chain/wallet");
      await connectWallet();
      setWalletConnecting(false);
    } catch (err) {
      setWalletConnecting(false, err instanceof Error ? err.message : "The wallet did not connect.");
    }
  }, []);
  return {
    ...state,
    onMonad: state.chainId === MONAD_TESTNET.chainIdHex,
    connect,
    disconnect: disconnectWallet,
  };
}
