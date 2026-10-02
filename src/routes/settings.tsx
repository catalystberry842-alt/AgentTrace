import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getChainStatus } from "@/lib/agents/functions";
import type { ChainStatus } from "@/lib/agents/types";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Fact, Mono, Section, SkeletonLines } from "@/components/ui";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user, isPending } = useCurrentUserState();
  const [status, setStatus] = useState<ChainStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    getChainStatus()
      .then((result) => {
        if (!cancelled) setStatus(result);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isPending) {
    return (
      <Shell>
        <SkeletonLines />
      </Shell>
    );
  }
  if (!user) return <RedirectToSignIn />;

  return (
    <Shell>
      <header>
        <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
        <p className="mt-2 max-w-md text-sm text-muted">Account and signing. Agents, firewalls, and proofs stay with the agent.</p>
      </header>
      <div className="mt-4">
        <Section title="Account">
          <dl>
            <Fact label="Name">{user.displayName ?? "—"}</Fact>
            <Fact label="Email">{user.primaryEmail ?? "—"}</Fact>
          </dl>
          <p className="pt-3 text-sm text-muted">
            <Link to="/" className="hover:text-fg hover:underline">
              Your agents
            </Link>{" "}
            is where identities are managed.
          </p>
        </Section>
        <Section title="Authentication">
          <p className="text-sm text-muted">Google identifies this account. It is not a wallet and not an agent.</p>
          <div className="pt-4">
            <UserButton />
          </div>
        </Section>
        <Section title="Wallet / signing">
          <p className="text-sm text-muted">A wallet is requested only when you submit a chain transaction. AgentTrace does not store a key.</p>
          {status ? (
            <dl className="mt-4">
              <Fact label="Network">
                {status.chainName} <Mono>{status.chainId}</Mono>
              </Fact>
              <Fact label="Registry">{status.registry ? <Mono>{status.registry}</Mono> : "Not deployed"}</Fact>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">Chain status is unavailable.</p>
          )}
        </Section>
        <Section title="Notifications">
          <p className="text-sm text-muted">Notifications are not enabled.</p>
        </Section>
        <Section title="Developer settings">
          <Link to="/developers/api-keys" className="inline-flex h-11 items-center text-sm hover:underline">
            API keys
          </Link>
        </Section>
      </div>
    </Shell>
  );
}
