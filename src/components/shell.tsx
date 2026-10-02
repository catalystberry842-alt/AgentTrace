import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { authEnabled, signOut } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { searchTrace } from "@/lib/agents/functions";

const NAV = [
  { to: "/agents", label: "Agents", match: (path: string) => path.startsWith("/agents") },
  { to: "/proofs", label: "Proofs", match: (path: string) => path.startsWith("/proofs") || path.startsWith("/outcomes") },
  { to: "/developers", label: "Developers", match: (path: string) => path.startsWith("/developers") },
] as const;

type NavTo = "/agents" | "/proofs" | "/developers" | "/settings" | "/login" | "/";

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
      className={`flex h-11 items-center text-sm transition-colors duration-150 ${active ? "text-fg" : "text-muted hover:text-fg"}`}
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
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-bg">
        <div className={`mx-auto flex h-14 w-full items-center gap-6 px-5 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
          <Link to="/" className="shrink-0 text-sm font-medium tracking-tight">
            AgentTrace
          </Link>
          <nav className="hidden items-center gap-5 md:flex" aria-label="Product">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} active={item.match(pathname)} />
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-4 md:flex">
            <button type="button" className="flex h-11 items-center gap-3 text-sm text-muted hover:text-fg" onClick={() => setSearchOpen(true)}>
              Search
              <kbd className="hidden font-mono text-xs text-faint lg:inline">Ctrl K</kbd>
            </button>
            <AccountMenu />
          </div>
          <button
            type="button"
            className="ml-auto h-11 px-1 text-sm text-muted md:hidden"
            aria-expanded={menu}
            aria-controls="mobile-nav"
            onClick={() => setMenu((value) => !value)}
          >
            {menu ? "Close" : "Menu"}
          </button>
        </div>
        {menu ? (
          <div id="mobile-nav" className="border-t border-border px-5 py-2 md:hidden">
            <button type="button" className="flex h-11 items-center text-sm text-muted" onClick={() => { setMenu(false); setSearchOpen(true); }}>
              Search
            </button>
            <nav aria-label="Product">
              {NAV.map((item) => (
                <NavLink key={item.to} to={item.to} label={item.label} active={item.match(pathname)} onNavigate={() => setMenu(false)} />
              ))}
            </nav>
            <AccountMenu onNavigate={() => setMenu(false)} />
          </div>
        ) : null}
      </header>
      <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
      <main className={`page-enter mx-auto w-full px-5 py-10 md:py-14 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>{children}</main>
    </div>
  );
}
