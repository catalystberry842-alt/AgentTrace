import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { searchTrace } from "@/lib/agents/functions";
import { useWalletAccount } from "@/lib/chain/wallet-account";
import { IS_MAINNET, MONAD_TESTNET } from "@/lib/chain/network";
import { toast } from "sonner";
import { isMobileBrowser, metamaskDeepLink, noWalletMessage } from "@/lib/chain/injected";

const NAV = [
  { to: "/agents", label: "Agents", match: (path: string) => path.startsWith("/agents") },
  { to: "/firewalls", label: "Firewalls", match: (path: string) => path.startsWith("/firewalls") },
  { to: "/proofs", label: "Proofs", match: (path: string) => path.startsWith("/proofs") || path.startsWith("/outcomes") },
  { to: "/demo", label: "Demo", match: (path: string) => path.startsWith("/demo") },
  { to: "/developers", label: "Developers", match: (path: string) => path.startsWith("/developers") },
] as const;

type NavTo = "/agents" | "/firewalls" | "/proofs" | "/demo" | "/developers" | "/settings" | "/login" | "/";

type Hit = { kind: string; id: string; label: string; href: string };

function NavLink({
  to,
  label,
  active,
  onNavigate,
}: {
  to: NavTo;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={`relative flex h-14 items-center text-sm transition-colors duration-150 ${active ? "text-fg after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-accent" : "text-muted hover:text-fg"}`}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </Link>
  );
}

function CommandSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits(null);
    setActive(0);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      searchTrace({ data: q })
        .then((result) => {
          if (!cancelled) {
            setHits(result.hits);
            setActive(0);
          }
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  function go(hit: Hit) {
    onOpenChange(false);
    router.history.push(hit.href);
  }

  if (!open) return null;
  const count = hits?.length ?? 0;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-bg/80 px-4 pt-[12vh]" role="presentation" onMouseDown={() => onOpenChange(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search AgentTrace"
        className="w-full max-w-lg border border-border bg-bg"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="search"
          value={query}
          aria-label="Search agents, executions, proofs, transactions"
          aria-controls={listId}
          aria-activedescendant={hits?.[active] ? `hit-${active}` : undefined}
          placeholder="Agents, executions, proofs, transactions"
          className="h-12 w-full bg-transparent px-4 text-sm text-fg outline-none placeholder:text-faint"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((value) => (count === 0 ? 0 : (value + 1) % count));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((value) => (count === 0 ? 0 : (value - 1 + count) % count));
            } else if (event.key === "Enter" && hits?.[active]) {
              event.preventDefault();
              go(hits[active]);
            }
          }}
        />
        <ul id={listId} role="listbox" className="max-h-80 overflow-auto border-t border-border">
          {!query.trim() ? <li className="px-4 py-3 text-sm text-muted">Search by agent name, Agent ID, execution ID, or transaction hash.</li> : null}
          {query.trim() && hits === null ? (
            <li className="px-4 py-3" aria-hidden>
              <span className="skeleton block h-4 w-40" />
            </li>
          ) : null}
          {hits && hits.length === 0 ? (
            <li className="px-4 py-4 text-sm">
              <p className="font-medium">No matching resources</p>
              <p className="mt-1 text-muted">Try an agent name, Agent ID, execution ID or transaction hash.</p>
            </li>
          ) : null}
          {hits?.map((hit, index) => (
            <li key={`${hit.kind}:${hit.id}`} id={`hit-${index}`} role="option" aria-selected={index === active}>
              <a
                href={hit.href}
                className={`flex min-h-11 flex-col justify-center px-4 py-2 ${index === active ? "bg-subtle" : "hover:bg-surface"}`}
                onMouseEnter={() => setActive(index)}
                onClick={(event) => {
                  event.preventDefault();
                  go(hit);
                }}
              >
                <span className="type-caption text-faint">{hit.kind}</span>
                <span className="text-sm break-all">{hit.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  // Wallet-only deployments have no application account: the wallet signs each chain action.
  if (!authEnabled) return null;
  return <AccountMenuSignedIn onNavigate={onNavigate} />;
}

function AccountMenuSignedIn({ onNavigate }: { onNavigate?: () => void }) {
  const { user, isPending } = useCurrentUserState();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  if (isPending) return <span className="skeleton block h-4 w-16" />;
  if (!user) {
    return <NavLink to="/login" label="Sign in" active={false} onNavigate={onNavigate} />;
  }

  const name = user.displayName ?? user.primaryEmail ?? "Account";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="flex h-11 items-center text-sm text-muted hover:text-fg"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        Account
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-56 border border-border bg-bg py-1">
          <p className="truncate px-3 py-2 text-xs text-faint">{name}</p>
          <Link
            to="/settings"
            role="menuitem"
            className="flex h-11 items-center px-3 text-sm hover:bg-subtle"
            onClick={() => {
              setOpen(false);
              onNavigate?.();
            }}
          >
            Settings
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex h-11 w-full items-center px-3 text-left text-sm text-muted hover:bg-subtle hover:text-fg"
            onClick={() => {
              setError(null);
              void signOut("/").catch((err: unknown) => {
                setError(err instanceof Error ? err.message : "Sign-out failed");
              });
            }}
          >
            Sign out
          </button>
          {error ? <p className="px-3 pb-2 text-xs text-danger">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** The single wallet connection for the app. Every write action reuses it. */
export function WalletButton({ full = false }: { full?: boolean }) {
  const wallet = useWalletAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (wallet.error) toast.error(wallet.error);
  }, [wallet.error]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", onPointer);
    return () => window.removeEventListener("mousedown", onPointer);
  }, [open]);

  const base = `inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors duration-150 ${full ? "w-full" : ""}`;

  if (!wallet.ready) return <span className={`skeleton block h-9 ${full ? "w-full" : "w-32"}`} aria-hidden />;

  if (!wallet.address) {
    return (
      <button
        type="button"
        data-testid="connect-wallet"
        disabled={wallet.connecting}
        className={`${base} bg-accent text-accent-fg hover:bg-accent-hover disabled:opacity-60`}
        onClick={() => {
          if (!wallet.available) {
            if (isMobileBrowser()) {
              toast.error(noWalletMessage(), { action: { label: "Open in MetaMask", onClick: () => window.location.assign(metamaskDeepLink()) } });
            } else {
              toast.error(noWalletMessage());
            }
            return;
          }
          void wallet.connect();
        }}
      >
        {wallet.connecting ? "Connecting…" : "Connect wallet"}
      </button>
    );
  }

  if (!wallet.onMonad) {
    return (
      <button type="button" className={`${base} border border-warn/50 text-warn hover:bg-subtle`} onClick={() => void wallet.connect()}>
        Switch to {MONAD_TESTNET.label}
      </button>
    );
  }

  return (
    <div className={`relative ${full ? "w-full" : ""}`} ref={ref}>
      <button
        type="button"
        data-testid="wallet-connected"
        className={`${base} border border-border bg-surface font-mono text-xs text-fg hover:border-border-strong`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
        {shortAddress(wallet.address)}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-30 mt-2 w-60 rounded-md border border-border bg-surface py-1 shadow-xl">
          <p className="px-3 pt-2 font-mono text-xs break-all text-muted">{wallet.address}</p>
          <p className="px-3 pt-1 pb-2 text-xs text-faint">
            {MONAD_TESTNET.label} · chain {MONAD_TESTNET.chainId}
          </p>
          <button
            type="button"
            role="menuitem"
            className="flex h-10 w-full items-center px-3 text-left text-sm hover:bg-subtle"
            onClick={() => {
              void navigator.clipboard?.writeText(wallet.address ?? "");
              toast.success("Address copied");
              setOpen(false);
            }}
          >
            Copy address
          </button>
          <a
            role="menuitem"
            className="flex h-10 items-center px-3 text-sm hover:bg-subtle"
            href={`${MONAD_TESTNET.explorerUrl}/address/${wallet.address}`}
            target="_blank"
            rel="noreferrer"
          >
            View on explorer ↗
          </a>
          <Link role="menuitem" to="/agents/new" className="flex h-10 items-center px-3 text-sm hover:bg-subtle" onClick={() => setOpen(false)}>
            Register an agent
          </Link>
          <button
            type="button"
            role="menuitem"
            className="flex h-10 w-full items-center border-t border-border px-3 text-left text-sm text-muted hover:bg-subtle hover:text-fg"
            onClick={() => {
              wallet.disconnect();
              setOpen(false);
            }}
          >
            Disconnect
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  useEffect(() => {
    setMenu(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setMenu(false);
        setSearchOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg/95 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center gap-8 px-5 lg:px-8">
          <Link to="/" className="flex shrink-0 items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-accent font-mono text-[10px] text-accent-fg" aria-hidden>
              AT
            </span>
            AgentTrace
          </Link>
          <nav className="hidden items-center gap-6 lg:flex" aria-label="Product">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} active={item.match(pathname)} />
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <button
              type="button"
              className="flex h-9 w-56 items-center justify-between rounded-md border border-border px-3 text-sm text-faint hover:border-border-strong hover:text-muted"
              onClick={() => setSearchOpen(true)}
            >
              Search agents, txs…
              <kbd className="font-mono text-[11px] text-faint">Ctrl K</kbd>
            </button>
            <span className="flex h-9 items-center gap-2 rounded-md border border-border px-3 font-mono text-xs text-muted" title={`Chain ${MONAD_TESTNET.chainId}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${IS_MAINNET ? "bg-accent" : "bg-warn"}`} aria-hidden />
              {IS_MAINNET ? "Mainnet" : "Testnet"} · {MONAD_TESTNET.chainId}
            </span>
            <AccountMenu />
            <WalletButton />
          </div>
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            <WalletButton />
            <button
              type="button"
              className="h-9 rounded-md border border-border px-3 text-sm text-muted"
              aria-expanded={menu}
              aria-controls="mobile-nav"
              onClick={() => setMenu((value) => !value)}
            >
              {menu ? "Close" : "Menu"}
            </button>
          </div>
        </div>
        {menu ? (
          <div id="mobile-nav" className="border-t border-border px-5 py-2 lg:hidden">
            <nav aria-label="Product" className="flex flex-col">
              {NAV.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMenu(false)}
                  className={`flex h-11 items-center text-sm ${item.match(pathname) ? "text-fg" : "text-muted"}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <button type="button" className="flex h-11 items-center text-sm text-muted" onClick={() => { setMenu(false); setSearchOpen(true); }}>
              Search
            </button>
            <p className="flex h-11 items-center gap-2 font-mono text-xs text-faint">
              <span className={`h-1.5 w-1.5 rounded-full ${IS_MAINNET ? "bg-accent" : "bg-warn"}`} aria-hidden />
              {MONAD_TESTNET.label} · chain {MONAD_TESTNET.chainId}
            </p>
            <AccountMenu onNavigate={() => setMenu(false)} />
          </div>
        ) : null}
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <main className={`mx-auto w-full flex-1 px-5 py-8 md:py-12 lg:px-8 ${wide ? "max-w-[1240px]" : "max-w-[1240px]"}`}>
        {wide ? children : <div className="mx-auto w-full max-w-[920px]">{children}</div>}
      </main>
      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2 px-5 py-6 text-xs text-faint sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>AgentTrace · identity, control and proof for onchain agents on Monad</span>
          <span className="flex gap-4">
            <a className="hover:text-muted" href="https://github.com/catalystberry842-alt/AgentTrace" target="_blank" rel="noreferrer">GitHub ↗</a>
            <a className="hover:text-muted" href={MONAD_TESTNET.explorerUrl} target="_blank" rel="noreferrer">Explorer ↗</a>
            <Link className="hover:text-muted" to="/developers">Docs</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
