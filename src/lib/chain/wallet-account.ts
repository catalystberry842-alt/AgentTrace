import { useCallback, useEffect, useState } from "react";
import { injectedProvider, noWalletMessage, waitForProvider, type InjectedProvider } from "@/lib/chain/injected";

function injected(): InjectedProvider | null {
  return injectedProvider();
}

function firstAccount(value: unknown): `0x${string}` | null {
  const first = Array.isArray(value) ? value[0] : null;
  return typeof first === "string" && /^0x[a-fA-F0-9]{40}$/.test(first)
    ? (first.toLowerCase() as `0x${string}`)
    : null;
}

/**
 * The connected browser wallet address, read without a prompt (`eth_accounts`).
 * In wallet-only deployments this is the identity: agents are listed by their onchain owner.
 */
export function useWalletAccount(): {
  address: `0x${string}` | null;
  ready: boolean;
  available: boolean;
  connect: () => Promise<void>;
  error: string | null;
} {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const eth = injected();
    if (!eth) {
      // Wallets that only announce via EIP-6963 can answer a moment after load.
      void waitForProvider().then((late) => {
        if (cancelled) return;
        setAvailable(Boolean(late));
        setReady(true);
        if (!late) return;
        late
          .request({ method: "eth_accounts" })
          .then((accounts) => {
            if (!cancelled) setAddress(firstAccount(accounts));
          })
          .catch(() => undefined);
      });
      return () => {
        cancelled = true;
      };
    }
    setAvailable(true);
    eth
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (!cancelled) setAddress(firstAccount(accounts));
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setReady(true);
      });
    const onChange = (accounts: unknown) => setAddress(firstAccount(accounts));
    eth.on?.("accountsChanged", onChange);
    return () => {
      cancelled = true;
      eth.removeListener?.("accountsChanged", onChange);
    };
  }, []);

  const connect = useCallback(async () => {
    const eth = injected() ?? (await waitForProvider());
    if (!eth) {
      setError(noWalletMessage());
      return;
    }
    setAvailable(true);
    setError(null);
    try {
      setAddress(firstAccount(await eth.request({ method: "eth_requestAccounts" })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet did not connect.");
    }
  }, []);

  return { address, ready, available, connect, error };
}
