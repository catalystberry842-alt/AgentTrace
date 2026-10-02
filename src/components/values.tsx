import { useState, type ReactNode } from "react";
import { addressUrl, shortAddress, shortHash, txUrl } from "@/lib/format";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="h-11 shrink-0 px-1 text-xs text-muted hover:text-fg"
      aria-label={done ? `${label} copied` : `Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function SplitMono({ desktop, mobile, title }: { desktop: string; mobile: string; title: string }) {
  return (
    <>
      <span className="font-mono text-sm sm:hidden" title={title}>
        {mobile}
      </span>
      <span className="hidden font-mono text-sm sm:inline" title={title}>
        {desktop}
      </span>
    </>
  );
}

export function AddressValue({
  value,
  copy = false,
  explorer = false,
}: {
  value: string | null;
  copy?: boolean;
  explorer?: boolean;
}) {
  const href = addressUrl(value);
  if (!value) return "—";
  const mobile = /^0x[a-fA-F0-9]{40}$/.test(value) ? `${value.slice(0, 4)}…${value.slice(-4)}` : value;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      <SplitMono desktop={shortAddress(value)} mobile={mobile} title={value} />
      {copy ? <CopyButton value={value} label="address" /> : null}
      {explorer && href ? (
        <a href={href} className="inline-flex h-11 items-center px-1 text-xs text-muted hover:text-fg" rel="noreferrer">
          Explorer
        </a>
      ) : null}
    </span>
  );
}

export function TxValue({ hash, copy = false }: { hash: string | null | undefined; copy?: boolean }) {
  const href = txUrl(hash);
  if (!hash) return "—";
  const desktop = shortHash(hash);
  const mobile = /^0x[a-fA-F0-9]{64}$/.test(hash) ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : desktop;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      {href ? (
        <a href={href} className="underline-offset-4 hover:underline" rel="noreferrer">
          <SplitMono desktop={desktop} mobile={mobile} title={hash} />
        </a>
      ) : (
        <SplitMono desktop={hash.length > 22 ? desktop : hash} mobile={mobile} title={hash} />
      )}
      {copy ? <CopyButton value={hash} label="transaction" /> : null}
    </span>
  );
}

export function Identifier({
  label,
  value,
  href,
  copy = true,
}: {
  label: string;
  value: string;
  href?: string | null;
  copy?: boolean;
}) {
  const desktop = value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
  const mobile = value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
  const body = <SplitMono desktop={desktop} mobile={mobile} title={value} />;
  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs tracking-widest text-faint uppercase">{label}</span>
      {href ? (
        <a href={href} className="underline-offset-4 hover:underline" rel="noreferrer">
          {body}
        </a>
      ) : (
        body
      )}
      {copy ? <CopyButton value={value} label={label} /> : null}
    </span>
  );
}

export function TechnicalValue({ children }: { children: ReactNode }) {
  return <span className="font-mono text-sm break-all">{children}</span>;
}
