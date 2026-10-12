import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { getDirectory, searchAgents } from "@/lib/agents/functions";
import { CAPABILITIES, type Capability, type HistoryFlag, type IndexedAgent, type IndexerStatus } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { useWalletAccount } from "@/lib/chain/wallet-account";
import { buttonClass, EmptyState, ErrorNote, Mono, StatusText, TableSkeleton, TextInput } from "@/components/ui";
import { formatAgentLabel, formatUtc, shortAddress } from "@/lib/format";

const FILTERS = ["Active", "All", "Inactive"] as const;
type Filter = (typeof FILTERS)[number];
const CAPABILITY_FILTERS = CAPABILITIES.filter((item) => item !== "Other");
const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

export function Directory() {
  const { user, isPending } = useCurrentUserState();
  const wallet = useWalletAccount();
  const [mine, setMine] = useState(false);
  const [agents, setAgents] = useState<IndexedAgent[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [indexer, setIndexer] = useState<IndexerStatus | null>(null);
  const [query, setQuery] = useState("");
  // Deactivated identities stay on chain forever; list active ones unless asked.
  const [filter, setFilter] = useState<Filter>("Active");
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [history, setHistory] = useState<HistoryFlag[]>([]);
  const [verifiedExecutions, setVerifiedExecutions] = useState(false);
  const [verifiedOutcomes, setVerifiedOutcomes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      const run = query.trim()
        ? searchAgents({ data: query }).then((result) => {
            if (cancelled) return;
            setAgents(result.agents);
            setHistory(result.history);
          })
        : getDirectory().then((result) => {
            if (cancelled) return;
            setAgents(result.agents);
            setTotal(result.agents.length);
            setIndexer(result.indexer);
            setHistory(result.history);
          });
      run.catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load agents.");
      });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query]);

  const flags = new Map(history.map((row) => [row.agentId, row]));
  const visible = (agents ?? []).filter((agent) => {
    if (filter === "Active" && !agent.active) return false;
    if (filter === "Inactive" && agent.active) return false;
    if (capabilities.length > 0 && !capabilities.some((item) => agent.capabilities.includes(item))) return false;
    if (mine && wallet.address && agent.owner.toLowerCase() !== wallet.address) return false;
    const row = flags.get(agent.agentId);
    if (verifiedExecutions && (row?.verifiedExecutions ?? 0) < 1) return false;
    if (verifiedOutcomes && (row?.verifiedOutcomes ?? 0) < 1) return false;
    return true;
  });
  const noneIndexed = total === 0 && !query.trim();
  const hiddenInactive = filter === "Active" ? (agents ?? []).filter((agent) => !agent.active).length : 0;

  return (
    <div>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
        <h1 className="type-heading md:text-3xl">Agents</h1>
        <p className="mt-2 text-sm text-muted">AI agents with verifiable onchain identities, read from AgentRegistry.</p>
        </div>
        {!authEnabled ? (
          <Link to="/agents/new" className={buttonClass("primary", "w-full sm:w-auto")}>
            Register agent
          </Link>
        ) : null}
        {authEnabled && !isPending && user ? (
          <Link to="/" className="mt-3 inline-flex h-11 items-center text-sm text-muted hover:text-fg">
            ← Your agents
          </Link>
        ) : null}
      </header>

      <div className="mt-8">
        <TextInput
          value={query}
          placeholder="Search agents..."
          aria-label="Search agents"
          onChange={(event) => {
            setError(null);
            setQuery(event.target.value);
          }}
        />
      </div>

      <div className="mt-2 flex gap-5" role="tablist" aria-label="Filter agents">
        {FILTERS.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={filter === item}
            onClick={() => setFilter(item)}
            className={`relative h-11 text-sm transition-colors duration-150 ${filter === item ? "text-fg after:absolute after:inset-x-0 after:bottom-1 after:h-px after:bg-accent" : "text-muted hover:text-fg"}`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Filter by verified history">
        {wallet.address ? (
          <button
            type="button"
            aria-pressed={mine}
            onClick={() => setMine((value) => !value)}
            className={`h-8 rounded-full border px-3 text-xs transition-colors duration-150 ${mine ? "border-accent/60 bg-subtle text-fg" : "border-border text-muted hover:text-fg"}`}
          >
            Owned by my wallet
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={verifiedExecutions}
          onClick={() => setVerifiedExecutions((value) => !value)}
          className={`h-8 rounded-full border px-3 text-xs transition-colors duration-150 ${verifiedExecutions ? "border-accent/60 bg-subtle text-fg" : "border-border text-muted hover:text-fg"}`}
        >
          Has verified executions
        </button>
        <button
          type="button"
          aria-pressed={verifiedOutcomes}
          onClick={() => setVerifiedOutcomes((value) => !value)}
          className={`h-8 rounded-full border px-3 text-xs transition-colors duration-150 ${verifiedOutcomes ? "border-accent/60 bg-subtle text-fg" : "border-border text-muted hover:text-fg"}`}
        >
          Has verified outcomes
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2" aria-label="Filter by capability">
        {CAPABILITY_FILTERS.map((item) => {
          const selected = capabilities.includes(item);
          return (
            <button
              key={item}
              type="button"
              aria-pressed={selected}
              onClick={() =>
                setCapabilities((current) =>
                  current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item],
                )
              }
              className={`h-8 rounded-full border px-3 text-xs transition-colors duration-150 ${selected ? "border-accent/60 bg-subtle text-fg" : "border-border text-muted hover:text-fg"}`}
            >
              {item}
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-6">
          <ErrorNote>{error}</ErrorNote>
        </div>
      ) : null}
      {indexer?.status === "unconfigured" && !query.trim() ? (
        <p className="mt-4 text-sm text-muted">{indexer.detail}</p>
      ) : null}
      {indexer?.status === "error" && !query.trim() ? (
        <div className="mt-6">
          <ErrorNote>{indexer.detail}</ErrorNote>
        </div>
      ) : null}

      {agents === null && !error ? <TableSkeleton rows={5} /> : null}

      {agents && visible.length === 0 ? (
        <EmptyState
          title={noneIndexed ? "No agents yet" : "No matching agents"}
          description={noneIndexed ? "Create an onchain identity for your first AI agent." : "Nothing in AgentTrace matches this filter."}
          action={
            noneIndexed ? (
              <>
                {isPending ? <div className="skeleton h-11 w-44" /> : null}
                {authEnabled && !isPending && user ? (
                  <Link to="/agents/new" className={buttonClass("primary")}>
                    Create an agent
                  </Link>
                ) : null}
                {!isPending && !user && authEnabled && google ? (
                  <button type="button" className={buttonClass("primary")} onClick={() => void signIn(google.providerId, { callbackURL: "/agents/new" })}>
                    Create an agent
                  </button>
                ) : null}
              </>
            ) : null
          }
        />
      ) : null}

      {visible.length > 0 ? (
        <div className="mt-6 border-t border-border md:rounded-lg md:border">
          <div className="hidden grid-cols-6 gap-4 border-b border-border px-4 py-3 text-xs tracking-widest text-faint uppercase md:grid">
            <span>Agent</span>
            <span>Agent ID</span>
            <span>Capabilities</span>
            <span>Status</span>
            <span>Owner</span>
            <span>Registered</span>
          </div>
          <ul className="divide-y divide-border border-b border-border md:border-b-0">
            {visible.map((agent) => (
              <li key={agent.agentId}>
                <Link
                  to="/agents/$agentId"
                  params={{ agentId: agent.agentId }}
                  className="block py-4 transition-colors duration-150 hover:bg-surface md:px-4"
                >
                  <span className="grid gap-2 md:grid-cols-6 md:items-center md:gap-4">
                    <span className="text-sm font-medium">{agent.name}</span>
                    <Field label="Agent ID">
                      <Mono>{formatAgentLabel(agent.agentId)}</Mono>
                    </Field>
                    <Field label="Capabilities">
                      <span className="text-sm text-muted">{agent.capabilities.join(" · ") || "—"}</span>
                    </Field>
                    <Field label="Status">
                      <StatusText tone={agent.active ? "ok" : "muted"}>{agent.active ? "Active" : "Inactive"}</StatusText>
                    </Field>
                    <Field label="Owner">
                      <span className="text-sm text-muted" title={agent.owner}>
                        {shortAddress(agent.owner)}
                      </span>
                    </Field>
                    <Field label="Registered">
                      <span className="text-sm whitespace-nowrap text-muted">{formatUtc(agent.registeredAt)}</span>
                    </Field>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {agents && hiddenInactive > 0 ? (
        <p className="mt-4 text-sm text-muted">
          {hiddenInactive} deactivated {hiddenInactive === 1 ? "agent is" : "agents are"} hidden.{" "}
          <button type="button" className="text-fg underline-offset-4 hover:underline" onClick={() => setFilter("All")}>
            Show all
          </button>
        </p>
      ) : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="flex items-baseline justify-between gap-4 md:block">
      <span className="text-xs tracking-widest text-faint uppercase md:hidden">{label}</span>
      <span className="min-w-0 text-right break-words md:text-left">{children}</span>
    </span>
  );
}
