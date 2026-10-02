import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { listFirewalls } from "@/lib/agents/functions";
import type { FirewallRecord } from "@/lib/agents/types";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { ErrorNote, Mono, SkeletonLines, StatusText } from "@/components/ui";
import { formatAgentId, formatWei, shortAddress } from "@/lib/format";

export const Route = createFileRoute("/firewalls/")({ component: FirewallsPage });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

function spending(row: FirewallRecord): string {
  if (!row.allowValueTransfer) return "Value disabled";
  return `${formatWei(row.maxValuePerTransaction)} / tx`;
}

function FirewallsPage() {
  const { user, isPending } = useCurrentUserState();
  const [rows, setRows] = useState<FirewallRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFirewalls()
      .then((result) => {
        if (cancelled) return;
        setRows(result.firewalls);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load firewalls.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Shell wide>
      <header>
        <h1 className="text-2xl font-medium tracking-tight md:text-3xl">Firewalls</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">Control what your agents are allowed to do.</p>
      </header>
      <div className="mt-8">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {rows === null && !error ? <SkeletonLines /> : null}
        {rows && rows.length === 0 ? (
          <div>
            <p className="text-sm font-medium">No firewalls</p>
            <p className="mt-2 text-sm text-muted">Create a firewall.</p>
            <div className="mt-4">
              {isPending ? <div className="h-11 w-44 animate-pulse rounded-sm bg-subtle" /> : null}
              {!isPending && user ? (
                <Link
                  to="/firewalls/new"
                  className="inline-flex h-11 items-center justify-center rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg"
                >
                  Create a firewall
                </Link>
              ) : null}
              {!isPending && !user && authEnabled && google ? (
                <button
                  type="button"
                  className="inline-flex h-11 items-center justify-center rounded-sm bg-accent px-4 text-sm font-medium text-accent-fg"
                  onClick={() => void signIn(google.providerId, { callbackURL: "/firewalls/new" })}
                >
                  Create a firewall
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {rows && rows.length > 0 ? (
          <div>
            <div className="hidden grid-cols-6 gap-4 border-b border-border py-3 text-xs tracking-widest text-faint uppercase md:grid">
              <span>Firewall</span>
              <span>Agent</span>
              <span>Executor</span>
              <span>Status</span>
              <span>Spending limit</span>
              <span>Allowed targets</span>
            </div>
            <ul className="divide-y divide-border border-y border-border md:border-t-0">
              {rows.map((row) => {
                const targets = row.allowedTargets.filter((target) => target.active).length;
                return (
                  <li key={row.id}>
                    <Link
                      to="/firewalls/$firewallId"
                      params={{ firewallId: row.id }}
                      className="grid gap-2 py-4 text-sm md:grid-cols-6 md:items-center md:gap-4"
                    >
                      <Mono>Firewall {formatAgentId(row.id)}</Mono>
                      <span>
                        {row.agentName || "Agent"} <span className="text-muted">{formatAgentId(row.agentId)}</span>
                      </span>
                      <span className="font-mono text-sm">{shortAddress(row.executor)}</span>
                      <StatusText tone={row.status === "active" ? "ok" : "muted"}>
                        {row.status === "active" ? "Active" : row.status === "paused" ? "Paused" : "Inactive"}
                      </StatusText>
                      <span className="text-muted">{spending(row)}</span>
                      <span className="text-muted">{targets}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
