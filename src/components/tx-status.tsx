import { ChainError, Status } from "@/components/ui";
import { TxValue } from "@/components/values";
import { readableChainError, txUrl } from "@/lib/format";

export type TxPhase = "awaiting_signature" | "submitting" | "pending" | "confirmed" | "failed";

const STEPS = [
  { id: "awaiting_signature", label: "Awaiting wallet confirmation" },
  { id: "submitting", label: "Transaction submitted" },
  { id: "pending", label: "Waiting for Monad confirmation" },
  { id: "confirmed", label: "Confirmed" },
] as const;

const ORDER: Record<TxPhase, number> = {
  awaiting_signature: 0,
  submitting: 1,
  pending: 2,
  confirmed: 3,
  failed: -1,
};

export function TxStatus({
  title,
  phase,
  hash,
  detail,
}: {
  title: string;
  phase: TxPhase;
  hash?: string | null;
  detail?: string | null;
}) {
  const href = txUrl(hash);
  const rejected = phase === "failed" && detail ? /reject|denied/i.test(detail) : false;
  const readable = detail ? readableChainError(detail) : null;
  const active = ORDER[phase];

  return (
    <div>
      <p className="type-caption text-faint">Monad testnet</p>
      <h1 className="type-heading mt-2 md:text-3xl">{title}</h1>
      {phase === "failed" ? (
        <div className="mt-6">
          <Status status="failed" label={rejected ? "Rejected" : readable?.message === "The transaction could not be completed." ? "Reverted" : "Failed"} />
          <p className="mt-3 max-w-md text-sm text-muted">
            {rejected ? "Transaction rejected. No changes were made." : "The transaction did not complete. Nothing new was indexed."}
          </p>
          {detail ? (
            <div className="mt-4">
              <ChainError raw={detail} />
            </div>
          ) : null}
        </div>
      ) : (
        <ol className="mt-8 max-w-md space-y-3" aria-label="Transaction">
          {STEPS.map((step, index) => {
            const done = active > index;
            const current = active === index;
            return (
              <li key={step.id} className={`flex items-center gap-3 text-sm ${current || done ? "text-fg" : "text-faint"}`} aria-current={current ? "step" : undefined}>
                <span aria-hidden className="w-4">
                  {done ? "✓" : current ? "→" : "○"}
                </span>
                <span>{step.id === "confirmed" && phase === "confirmed" ? title : step.label}</span>
              </li>
            );
          })}
        </ol>
      )}
      {hash ? (
        <div className="mt-8">
          <p className="type-caption text-faint">Transaction</p>
          <p className="mt-2">
            <TxValue hash={hash} copy />
          </p>
          {href ? (
            <a href={href} className="mt-1 inline-flex h-11 items-center text-sm text-muted hover:text-fg" rel="noreferrer">
              View transaction
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
