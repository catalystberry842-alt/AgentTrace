import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getLiveStats, verifyOnchain, type LiveStats, type VerifyResult } from "@/lib/agents/live";
import { IS_MAINNET, MONAD_TESTNET } from "@/lib/chain/network";
import { CopyButton } from "@/components/values";

const REFRESH_MS = 12_000;

/** Polls `load` every interval while the tab is visible. */
export function usePolling<T>(load: () => Promise<T>, intervalMs = REFRESH_MS): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const tick = () => {
      if (document.visibilityState === "visible") {
        load()
          .then((value) => {
            if (!cancelled) {
              setData(value);
              setError(false);
            }
          })
          .catch(() => {
            if (!cancelled) setError(true);
          });
      }
      timer = window.setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [load, intervalMs]);
  return { data, error };
}

export function LiveDot({ label = "Live" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-widest text-faint uppercase">
      <span className="relative inline-flex h-1.5 w-1.5">
        <span className="absolute inset-0 rounded-full bg-ok opacity-60 motion-safe:animate-ping" style={{ animationDuration: "2.4s" }} />
        <span className="relative h-1.5 w-1.5 rounded-full bg-ok" />
      </span>
      {label}
    </span>
  );
}

const loadStats = () => getLiveStats();

export function LiveStatsStrip() {
  const { data, error } = usePolling<LiveStats>(loadStats);
  const items: { label: string; value: number | null; mono?: boolean; href?: string }[] = [
    { label: "Agents registered", value: data?.agents ?? null, href: "/agents" },
    { label: "Firewalls", value: data?.firewalls ?? null, href: "/firewalls" },
    { label: "Verified executions", value: data?.verifiedExecutions ?? null, href: "/proofs" },
    { label: "Proofs anchored", value: data?.anchoredProofs ?? null, href: "/proofs" },
    { label: `Latest ${MONAD_TESTNET.label} block`, value: data?.latestBlock ?? null, mono: true },
  ];
  // Only numbers read from the chain or its index are shown; anything unavailable is left out.
  const shown = data ? items.filter((item) => item.value !== null) : items;
  return (
    <section aria-label="Live network stats" className="mt-12 rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border px-5 py-2.5">
        <LiveDot label={`Live · chain ${MONAD_TESTNET.chainId}`} />
        <span className="text-xs text-faint">{error ? "Reconnecting…" : "Read from Monad · refreshes every 12s"}</span>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-5">
        {shown.map((item) => {
          const body = (
            <>
              <dt className="text-xs text-muted">{item.label}</dt>
              <dd className={`mt-1 text-xl font-medium tabular-nums ${item.mono ? "font-mono text-lg" : ""}`}>
                {data ? (item.value ?? 0).toLocaleString("en-US") : <span className="skeleton inline-block h-6 w-14 align-middle" />}
              </dd>
            </>
          );
          return (
            <div key={item.label} className="bg-bg">
              {item.href ? (
                <a href={item.href} className="block px-5 py-4 hover:bg-surface">
                  {body}
                </a>
              ) : (
                <div className="px-5 py-4">{body}</div>
              )}
            </div>
          );
        })}
      </dl>
    </section>
  );
}

const CHECK_LABELS: Record<string, string> = {
  "rpc chain id": `RPC is ${MONAD_TESTNET.label} (chain ${MONAD_TESTNET.chainId})`,
  "AgentProof.isAnchored": "Anchored in AgentProof",
  "anchor tx matches execution tx": "Anchor points at this execution tx",
  "execution receipt status success": "Execution receipt succeeded",
  "execution sent to AgentFirewall": "Sent through AgentFirewall",
  "AgentAction log with this executionId": "AgentAction log found",
  "tx sender is executor": "Sender is the authorized executor",
  "calldataHash = keccak256(execute data)": "Calldata hash recomputed",
  "execute args match event": "execute() args match the event",
  "decode execute() input": "execute() input decodes",
  "proof hash matches AgentProof.getAnchor": "Rebuilt proof hash = onchain anchor",
  "anchor agent/firewall ids match": "Agent and firewall ids match",
};

export function VerifyBox({ example }: { example: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  async function run(id: string) {
    setBusy(true);
    setResult(null);
    try {
      setResult(await verifyOnchain({ data: id }));
    } catch (err) {
      setResult({ pass: false, executionId: null, proofHash: null, checks: [], log: [], error: err instanceof Error ? err.message : "Verification failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="verify" className="rounded-lg border border-border bg-surface p-5">
      <h2 id="verify" className="text-sm font-medium">
        Verify a proof yourself
      </h2>
      <p className="mt-1 text-sm text-muted">
        Paste an execution id or transaction hash. The server re-reads the receipt from a public Monad RPC, rebuilds the proof hash and compares it with{" "}
        <span className="font-mono text-xs">AgentProof.getAnchor</span>, the same steps as <span className="font-mono text-xs">scripts/verify-proof.mjs</span>.
      </p>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim()) void run(value.trim());
        }}
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="0x… execution id or tx hash"
          aria-label="Execution id or transaction hash"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-md border border-border bg-bg px-3 font-mono text-xs text-fg outline-none placeholder:text-faint focus-visible:border-border-strong"
        />
        <button type="submit" disabled={busy || !value.trim()} className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-40">
          {busy ? "Recomputing…" : "Verify"}
        </button>
      </form>
      <button
        type="button"
        className="mt-2 text-xs text-muted hover:text-fg"
        onClick={() => {
          setValue(example);
          void run(example);
        }}
      >
        Try a real {IS_MAINNET ? "mainnet" : "testnet"} proof →
      </button>
      {result ? (
        <div className="mt-4 border-t border-border pt-4" aria-live="polite" data-testid="verify-result">
          <p className={`font-mono text-sm font-medium ${result.pass ? "text-ok" : "text-danger"}`}>
            {result.pass ? "PASS · proof hash matches the onchain anchor" : "FAIL"}
            {!result.pass && result.error ? <span className="font-sans font-normal text-muted"> · {result.error}</span> : null}
          </p>
          {result.checks.length ? (
            <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {result.checks.map((check) => (
                <li key={check.name} className="flex items-start gap-2">
                  <span className={check.ok ? "text-ok" : "text-danger"} aria-hidden>
                    {check.ok ? "✓" : "×"}
                  </span>
                  <span className={check.ok ? "text-fg" : "text-muted"}>{CHECK_LABELS[check.name] ?? check.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {result.proofHash ? (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              Rebuilt hash <span className="font-mono break-all text-fg">{result.proofHash}</span>
              <CopyButton value={result.proofHash} label="proof hash" />
            </p>
          ) : null}
          {result.executionId && result.pass ? (
            <Link to="/proofs/$proofId" params={{ proofId: result.executionId }} className="mt-2 inline-block text-sm text-accent hover:underline">
              Open the proof page →
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

type Step = { title: string; text: string; where: string; detail: string; href: string; cta: string; external?: boolean };

export function StepExplorer({ steps }: { steps: readonly Step[] }) {
  const [open, setOpen] = useState(0);
  const step = steps[open];
  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-border">
      <ol className="grid gap-px bg-border sm:grid-cols-3 lg:grid-cols-6" role="tablist" aria-label="Pipeline stages">
        {steps.map((item, index) => {
          const active = index === open;
          return (
            <li key={item.title} className="bg-bg">
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setOpen(index)}
                className={`flex h-full w-full flex-col p-5 text-left transition-colors duration-150 ${active ? "bg-surface" : "hover:bg-surface/60"}`}
              >
                <span className={`font-mono text-xs ${active ? "text-accent" : "text-faint"}`}>{String(index + 1).padStart(2, "0")}</span>
                <span className="mt-3 text-sm font-medium">{item.title}</span>
                <span className="mt-1 flex-1 text-sm text-muted">{item.text}</span>
                <span className="type-technical mt-4 text-xs text-faint">{item.where}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {step ? (
        <div role="tabpanel" className="flex flex-col gap-3 border-t border-border bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-3xl text-sm text-muted">{step.detail}</p>
          {step.external ? (
            <a href={step.href} target="_blank" rel="noreferrer" className="shrink-0 text-sm text-accent hover:underline">
              {step.cta} ↗
            </a>
          ) : (
            <a href={step.href} className="shrink-0 text-sm text-accent hover:underline">
              {step.cta} →
            </a>
          )}
        </div>
      ) : null}
    </div>
  );
}
