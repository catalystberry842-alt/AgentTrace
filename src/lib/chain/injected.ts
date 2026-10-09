/**
 * Finds the browser wallet. `window.ethereum` alone misses wallets that only announce themselves
 * through EIP-6963 (and breaks when two extensions fight over `window.ethereum`), so this also
 * listens for EIP-6963 announcements and prefers the first announced provider.
 */
export type InjectedProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

type Announced = { info: { uuid: string; name: string; rdns?: string }; provider: InjectedProvider };

const announced: Announced[] = [];
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("eip6963:announceProvider", (event) => {
    const detail = (event as CustomEvent<Announced>).detail;
    if (!detail?.provider?.request) return;
    if (announced.some((item) => item.info.uuid === detail.info.uuid)) return;
    announced.push(detail);
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));
}

if (typeof window !== "undefined") listen();

/** The wallet provider available right now, or null. */
export function injectedProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  listen();
  const legacy = (window as Window & { ethereum?: InjectedProvider }).ethereum;
  if (legacy?.request) return legacy;
  return announced[0]?.provider ?? null;
}

/** Same, but gives wallets that announce late (EIP-6963) a moment to answer. */
export async function waitForProvider(timeoutMs = 600): Promise<InjectedProvider | null> {
  const now = injectedProvider();
  if (now) return now;
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const found = injectedProvider();
    if (found) return found;
  }
  return null;
}

export function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/** Opens the current page inside the MetaMask mobile app's browser, where a wallet is injected. */
export function metamaskDeepLink(): string {
  if (typeof window === "undefined") return "https://metamask.app.link/";
  return `https://metamask.app.link/dapp/${window.location.host}${window.location.pathname}`;
}

export function noWalletMessage(): string {
  return isMobileBrowser()
    ? "No wallet in this browser. On a phone, open this page inside your wallet app's browser (MetaMask, Rabby, OKX, Coinbase Wallet)."
    : "No wallet found in this browser. Install or unlock a wallet extension (MetaMask, Rabby, OKX), then reload.";
}
