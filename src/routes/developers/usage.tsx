import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { getDeveloperUsage } from "@/lib/developer/functions";
import { DeveloperGate, DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { ErrorNote } from "@/components/ui";

export const Route = createFileRoute("/developers/usage")({ component: UsagePage });

type Usage = {
  requests: number;
  succeeded: number;
  failed: number;
  deliveries: number;
  delivered: number;
  deliveryFailed: number;
};

function UsagePage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">Usage</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">Counts come from API requests made with your keys. There is no billing.</p>
      <DeveloperNav current="/developers/usage" />
      <DeveloperGate callbackURL="/developers/usage">
        <UsageBody />
      </DeveloperGate>
    </Shell>
  );
}

function UsageBody() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getDeveloperUsage()
      .then((result) => {
        if (!cancelled) setUsage(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load usage.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="mt-8"><ErrorNote>{error}</ErrorNote></div>;
  if (!usage) return <p className="mt-8 text-sm text-muted">Loading usage.</p>;
  if (usage.requests === 0 && usage.deliveries === 0) return <p className="mt-8 text-sm text-muted">No API activity yet</p>;
  return (
    <dl className="mt-8 border-t border-border text-sm">
      <Row label="API requests" value={String(usage.requests)} />
      <Row label="Succeeded" value={String(usage.succeeded)} />
      <Row label="Failed" value={String(usage.failed)} />
      <Row label="Webhook deliveries" value={String(usage.deliveries)} />
      <Row label="Delivered" value={String(usage.delivered)} />
      <Row label="Delivery failed" value={String(usage.deliveryFailed)} />
    </dl>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 sm:flex-row sm:gap-8">
      <dt className="text-xs tracking-widest text-muted uppercase sm:w-40 sm:shrink-0">{label}</dt>
      <dd className="font-mono text-sm">{value}</dd>
    </div>
  );
}
