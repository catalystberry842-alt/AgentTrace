import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { readableChainError } from "@/lib/format";
import { MONAD_TESTNET } from "@/lib/chain/network";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "ghost" | "danger" | "destructive";

const BUTTON_BASE =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors duration-150 select-none disabled:cursor-not-allowed disabled:opacity-40";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-fg active:opacity-80",
  secondary: "border border-border bg-transparent text-fg hover:bg-subtle active:bg-surface-elevated",
  tertiary: "bg-transparent px-2 text-fg hover:text-muted",
  ghost: "bg-transparent px-2 text-muted hover:text-fg",
  danger: "border border-danger bg-transparent text-danger hover:bg-subtle",
  destructive: "border border-danger bg-transparent text-danger hover:bg-subtle",
};

export function buttonClass(variant: ButtonVariant = "primary", className = "") {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${className}`.trim();
}

export function Button({
  variant = "primary",
  className = "",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      className={buttonClass(variant, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {children}
    </button>
  );
}

const FIELD_CONTROL =
  "w-full rounded-md border border-border bg-surface px-3 text-sm text-fg outline-none placeholder:text-faint focus-visible:border-border-strong disabled:cursor-not-allowed disabled:opacity-50";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${FIELD_CONTROL} h-11 ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${FIELD_CONTROL} min-h-28 py-3 ${props.className ?? ""}`} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${FIELD_CONTROL} h-11 ${props.className ?? ""}`} />;
}

export function CodeInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput spellCheck={false} autoCapitalize="off" autoCorrect="off" {...props} className={`font-mono ${props.className ?? ""}`} />;
}

export function AddressInput({
  error,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: string }) {
  const invalid = Boolean(error);
  return (
    <TextInput
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      placeholder="0x"
      aria-invalid={invalid || undefined}
      {...props}
      className={`font-mono ${invalid ? "border-danger" : ""} ${props.className ?? ""}`}
    />
  );
}

export function AmountInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <TextInput inputMode="decimal" {...props} className={`font-mono ${props.className ?? ""}`} />;
}

export function Checkbox({
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-fg">
      <input type="checkbox" className="size-4 accent-fg" {...props} />
      {label}
    </label>
  );
}

export function Toggle({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={`inline-flex h-11 items-center gap-3 text-sm disabled:opacity-40 ${checked ? "text-fg" : "text-muted"}`}
    >
      <span className={`relative h-5 w-9 rounded-full border border-border ${checked ? "bg-subtle" : "bg-bg"}`} aria-hidden>
        <span className={`absolute top-0.5 size-3.5 rounded-full bg-fg transition-transform duration-150 ${checked ? "left-4" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

export function RadioGroup({
  name,
  value,
  onChange,
  options,
  label,
}: {
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string; description?: string }[];
  label: string;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium text-fg">{label}</legend>
      <div className="mt-2 space-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex min-h-11 items-start gap-3 text-sm">
            <input
              type="radio"
              name={name}
              className="mt-1 size-4 accent-fg"
              checked={value === option.value}
              onChange={() => onChange(option.value)}
            />
            <span>
              <span className="text-fg">{option.label}</span>
              {option.description ? <span className="mt-0.5 block text-muted">{option.description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-fg">
        {label}
        {required ? <span className="text-danger"> *</span> : null}
      </span>
      {hint ? <span className="mt-1 block text-sm text-pretty text-muted">{hint}</span> : null}
      <span className="mt-2 block">{children}</span>
      {error ? (
        <span className="mt-2 block text-sm text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="type-caption text-faint">{eyebrow}</p> : null}
        <h1 className={`type-heading text-balance md:text-3xl ${eyebrow ? "mt-2" : ""}`}>{title}</h1>
        {subtitle ? <p className="mt-2 max-w-xl text-sm text-pretty text-muted">{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

export function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="border-t border-border py-8">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border-subtle py-3 last:border-b-0 @md:grid-cols-[10rem_minmax(0,1fr)] @md:gap-6">
      <dt className="type-caption text-faint">{label}</dt>
      <dd className="min-w-0 text-sm text-fg">{children}</dd>
    </div>
  );
}

export type TraceStatus =
  | "active"
  | "inactive"
  | "paused"
  | "pending"
  | "confirmed"
  | "failed"
  | "blocked"
  | "verified"
  | "unverifiable"
  | "processing";

const STATUS_META: Record<TraceStatus, { label: string; mark: string; tone: string }> = {
  active: { label: "Active", mark: "●", tone: "text-ok" },
  inactive: { label: "Inactive", mark: "○", tone: "text-faint" },
  paused: { label: "Paused", mark: "◌", tone: "text-warn" },
  pending: { label: "Pending", mark: "◌", tone: "text-muted" },
  confirmed: { label: "Confirmed", mark: "✓", tone: "text-ok" },
  failed: { label: "Failed", mark: "×", tone: "text-danger" },
  blocked: { label: "Blocked", mark: "⊘", tone: "text-danger" },
  verified: { label: "Verified", mark: "✓", tone: "text-ok" },
  unverifiable: { label: "Unverifiable", mark: "×", tone: "text-danger" },
  processing: { label: "Processing", mark: "◌", tone: "text-muted" },
};

export function Status({ status, label }: { status: TraceStatus; label?: string }) {
  const meta = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${meta.tone}`}>
      <span aria-hidden>{meta.mark}</span>
      <span className="tracking-wide uppercase">{label ?? meta.label}</span>
    </span>
  );
}

export function StatusText({
  tone,
  children,
}: {
  tone: "ok" | "pending" | "muted" | "danger" | "warn";
  children: ReactNode;
}) {
  const mark = tone === "ok" ? "✓" : tone === "danger" ? "×" : tone === "warn" ? "◌" : tone === "pending" ? "◌" : "○";
  const color =
    tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : tone === "pending" ? "text-muted" : "text-faint";
  return (
    <span className={`inline-flex items-center gap-2 text-sm ${color}`}>
      <span aria-hidden>{mark}</span>
      {children}
    </span>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="type-technical break-all text-fg">{children}</span>;
}

/**
 * Shown under a skeleton only if loading takes more than a moment, so a cold serverless start
 * reads as "reading the chain" rather than a stalled page. Fast loads never show it.
 */
export function ReadingChain({ delayMs = 900 }: { delayMs?: number }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);
  return (
    <p role="status" className={`mt-6 font-mono text-xs text-faint transition-opacity duration-300 ${show ? "opacity-100" : "opacity-0"}`}>
      Reading {MONAD_TESTNET.label} · receipts and logs come straight from the chain
    </p>
  );
}

export function SkeletonLines() {
  return (
    <div>
    <div className="space-y-3" aria-hidden>
      <div className="skeleton h-7 w-40" />
      <div className="skeleton h-4 w-64 max-w-full" />
      <div className="skeleton mt-8 h-12" />
      <div className="skeleton h-12" />
    </div>
    <ReadingChain />
    </div>
  );
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-8 space-y-3" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton h-14" />
      ))}
      <ReadingChain />
    </div>
  );
}

export function PassportSkeleton() {
  return (
    <div className="space-y-6" aria-hidden>
      <div className="skeleton h-4 w-40" />
      <div className="skeleton h-8 w-56" />
      <div className="skeleton h-4 w-32" />
      <div className="mt-6 flex gap-4">
        <div className="skeleton h-11 w-24" />
        <div className="skeleton h-11 w-24" />
        <div className="skeleton h-11 w-24" />
      </div>
      <div className="skeleton h-24" />
      <div className="skeleton h-40" />
      <ReadingChain />
    </div>
  );
}

export function FirewallSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="skeleton h-5 w-28" />
      <div className="skeleton h-11 w-40" />
      <div className="skeleton h-16" />
      <div className="skeleton h-16" />
    </div>
  );
}

export function ProofSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <div className="skeleton h-4 w-48" />
      <div className="skeleton h-8 w-64" />
      <div className="skeleton h-5 w-32" />
      <div className="skeleton mt-6 h-48" />
    </div>
  );
}

export function OutcomeSkeleton() {
  return <ProofSkeleton />;
}

export function AgentSkeleton() {
  return <TableSkeleton rows={5} />;
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-10">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-2 max-w-md text-sm text-pretty text-muted">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm" role="alert">
      <p className="text-danger">{children}</p>
      {onRetry ? (
        <button type="button" className="mt-2 h-11 text-sm text-fg hover:underline" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function PageError({
  title = "Something went wrong",
  description = "We could not load this resource.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert">
      <h1 className="type-heading">{title}</h1>
      <p className="mt-3 max-w-md text-sm text-muted">{description}</p>
      {onRetry ? (
        <button type="button" className={buttonClass("secondary", "mt-6")} onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function NotFoundState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div>
      <h1 className="type-heading">{title}</h1>
      <p className="mt-3 max-w-md text-sm text-pretty text-muted">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}

export function PermissionNote({ children }: { children?: ReactNode }) {
  return (
    <div role="alert">
      <h1 className="type-heading">You do not control this agent</h1>
      <p className="mt-3 max-w-md text-sm text-muted">{children ?? "Only the owner can change this agent."}</p>
    </div>
  );
}

export function ChainError({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false);
  const { message, detail } = readableChainError(raw);
  const extra = detail !== message;
  return (
    <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm" role="alert">
      <p className="text-danger">{message}</p>
      {message === "Transaction rejected" ? <p className="mt-2 text-muted">No changes were made.</p> : null}
      {extra ? (
        <button type="button" className="mt-2 h-11 text-sm text-muted hover:text-fg" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
          {open ? "Hide technical details" : "Technical details"}
        </button>
      ) : null}
      {open && extra ? <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap text-muted">{detail}</pre> : null}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-border-subtle bg-surface px-4 py-3 text-sm text-pretty text-muted">{children}</div>;
}

export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="inline-flex h-11 items-center text-sm text-muted underline-offset-4 hover:text-fg hover:underline">
          {children}
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 max-w-xs rounded-md border border-border bg-surface-elevated px-3 py-2 text-sm text-fg">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function CodeBlock({ code, language = "ts" }: { code: string; language?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="mt-8 overflow-hidden rounded-md border border-border">
      <div className="flex h-11 items-center justify-between border-b border-border px-3">
        <span className="type-caption text-faint">{language}</span>
        <button
          type="button"
          className="h-11 px-2 text-xs text-muted hover:text-fg"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setDone(true);
              window.setTimeout(() => setDone(false), 1200);
            });
          }}
        >
          {done ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-xs leading-6 text-fg">{code}</pre>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  pending = false,
  onConfirm,
  onOpenChange,
  children,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(100%-2rem,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg p-5">
          <AlertDialog.Title className="text-lg font-medium tracking-tight">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-3 text-sm text-pretty text-muted">{description}</AlertDialog.Description>
          {children ? <div className="mt-4 text-sm text-muted">{children}</div> : null}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <button type="button" className={buttonClass("secondary")} disabled={pending}>
                {cancelLabel}
              </button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <button
                type="button"
                className={buttonClass(destructive ? "danger" : "primary")}
                disabled={pending}
                onClick={(event) => {
                  event.preventDefault();
                  onConfirm();
                }}
              >
                {pending ? "Working…" : confirmLabel}
              </button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function DataTable({
  columns,
  rows,
  empty,
}: {
  columns: { key: string; label: string; className?: string }[];
  rows: { id: string; href?: string; cells: ReactNode[] }[];
  empty?: ReactNode;
}) {
  if (rows.length === 0) return empty ? <>{empty}</> : null;
  return (
    <div className="mt-6">
      <div
        className="hidden border-b border-border py-3 text-xs tracking-widest text-faint uppercase md:grid"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column) => (
          <span key={column.key} className={column.className}>
            {column.label}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-border border-y border-border md:border-t-0">
        {rows.map((row) => {
          const body = (
            <span className="grid gap-2 py-4 text-sm md:items-center md:gap-3" style={{ gridTemplateColumns: undefined }}>
              <span className="grid gap-2 md:hidden">
                {columns.map((column, index) => (
                  <span key={column.key} className="flex items-baseline justify-between gap-4">
                    <span className="type-caption text-faint">{column.label}</span>
                    <span className="min-w-0 text-right">{row.cells[index]}</span>
                  </span>
                ))}
              </span>
              <span
                className="hidden md:grid md:items-center md:gap-3"
                style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
              >
                {row.cells.map((cell, index) => (
                  <span key={columns[index]?.key ?? index} className="min-w-0">
                    {cell}
                  </span>
                ))}
              </span>
            </span>
          );
          return (
            <li key={row.id}>
              {row.href ? (
                <a href={row.href} className="block hover:bg-surface">
                  {body}
                </a>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
