import { useCallback, useEffect, useState } from "react";

type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function injected(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const eth = (window as Window & { ethereum?: InjectedProvider }).ethereum;
  return eth?.request ? eth : null;
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
    const eth = injected();
    setAvailable(Boolean(eth));
    if (!eth) {
      setReady(true);
      return;
    }
    let cancelled = false;
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
    const eth = injected();
    if (!eth) {
      setError("No wallet found in this browser.");
      return;
    }
    setError(null);
    try {
      setAddress(firstAccount(await eth.request({ method: "eth_requestAccounts" })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The wallet did not connect.");
    }
  }, []);

  return { address, ready, available, connect, error };
}
