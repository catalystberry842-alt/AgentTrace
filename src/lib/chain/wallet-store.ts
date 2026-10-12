/**
 * One wallet connection for the whole app. The header button and every write action
 * (register, firewall, execute, verify, anchor, ERC-8004) read and update this store,
 * so connecting once unlocks everything. No private key is created, stored, or read.
 */
import { injectedProvider, waitForProvider } from "@/lib/chain/injected";

type Listener = () => void;

export type WalletState = {
  address: `0x${string}` | null;
  chainId: string | null;
  ready: boolean;
  available: boolean;
  connecting: boolean;
  error: string | null;
};

const SESSION_KEY = "agenttrace.wallet";

let state: WalletState = { address: null, chainId: null, ready: false, available: false, connecting: false, error: null };
const listeners = new Set<Listener>();
let started = false;

export function firstAccount(value: unknown): `0x${string}` | null {
  const first = Array.isArray(value) ? value[0] : null;
  return typeof first === "string" && /^0x[a-fA-F0-9]{40}$/.test(first) ? (first.toLowerCase() as `0x${string}`) : null;
}

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function remembered(): boolean {
  try {
    return window.localStorage.getItem(SESSION_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    if (on) window.localStorage.setItem(SESSION_KEY, "1");
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // storage unavailable (private mode): the session lasts for this page only
  }
}

function start() {
  if (started || typeof window === "undefined") return;
  started = true;
  const now = injectedProvider();
  if (now) attach(now);
  else {
    // Wallets that only announce via EIP-6963 can answer a moment after load.
    void waitForProvider().then((late) => {
      if (late) attach(late);
      else set({ ready: true, available: false });
    });
  }
}

function attach(eth: NonNullable<ReturnType<typeof injectedProvider>>) {
  set({ available: true });
  eth.on?.("accountsChanged", (accounts: unknown) => {
    const address = firstAccount(accounts);
    if (!address) remember(false);
    set({ address: address && (remembered() || state.address) ? address : null });
  });
  eth.on?.("chainChanged", (chainId: unknown) => set({ chainId: typeof chainId === "string" ? chainId.toLowerCase() : null }));
  Promise.all([
    remembered() ? eth.request({ method: "eth_accounts" }).catch(() => []) : Promise.resolve([]),
    eth.request({ method: "eth_chainId" }).catch(() => null),
  ])
    .then(([accounts, chainId]) => set({ address: firstAccount(accounts), chainId: typeof chainId === "string" ? chainId.toLowerCase() : null }))
    .finally(() => set({ ready: true }));
}

export function subscribeWallet(listener: Listener) {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getWalletState(): WalletState {
  return state;
}

const SERVER_STATE: WalletState = { address: null, chainId: null, ready: false, available: false, connecting: false, error: null };
export function getServerWalletState(): WalletState {
  return SERVER_STATE;
}

/** Called after any successful eth_requestAccounts so the header reflects the connection. */
export function markConnected(address: `0x${string}`, chainId?: string | null) {
  remember(true);
  set({ address: address.toLowerCase() as `0x${string}`, error: null, ...(chainId ? { chainId: chainId.toLowerCase() } : {}) });
}

export function setWalletChain(chainId: string | null) {
  set({ chainId: chainId?.toLowerCase() ?? null });
}

export function setWalletConnecting(connecting: boolean, error: string | null = null) {
  set({ connecting, error });
}

export function disconnectWallet() {
  remember(false);
  set({ address: null, error: null });
}
