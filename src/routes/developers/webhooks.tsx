import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createDeveloperWebhook, disableDeveloperWebhook, listDeveloperWebhooks } from "@/lib/developer/functions";
import { DeveloperGate, DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Button, ErrorNote, Field, TextInput } from "@/components/ui";
import { CopyButton } from "@/components/values";
import { formatUtc } from "@/lib/format";

export const Route = createFileRoute("/developers/webhooks")({ component: WebhooksPage });

type HookRow = {
  id: string;
  url: string;
  events: string[];
  createdAt: string | null;
  disabledAt: string | null;
};

function WebhooksPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">Webhooks</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Deliveries are signed with HMAC-SHA256. The signing secret is shown once and is not stored in the browser.
      </p>
      <DeveloperNav current="/developers/webhooks" />
      <DeveloperGate callbackURL="/developers/webhooks">
        <WebhookManager />
      </DeveloperGate>
    </Shell>
  );
}

function WebhookManager() {
  const [hooks, setHooks] = useState<HookRow[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[]>(["execution.executed", "proof.verified", "outcome.verified"]);
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reload() {
    return listDeveloperWebhooks()
      .then((result) => {
        setHooks(result.webhooks);
        setEvents([...result.events]);
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load webhooks."));
  }

  useEffect(() => {
    void reload();
  }, []);

  return (
    <div className="mt-8">
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <form
        className="mt-6 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setError(null);
          setSecret(null);
          createDeveloperWebhook({ data: { url, events: chosen } })
            .then((result) => {
              setSecret(result.secret);
              setUrl("");
              return reload();
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "The webhook was not created."))
            .finally(() => setPending(false));
        }}
      >
        <Field label="URL" hint="https, or http on localhost">
          <TextInput value={url} onChange={(event) => setUrl(event.target.value)} required inputMode="url" />
        </Field>
        <div className="flex flex-col" role="group" aria-label="Events">
          {(events.length ? events : chosen).map((item) => {
            const on = chosen.includes(item);
            return (
              <button
                key={item}
                type="button"
                aria-pressed={on}
                className={`h-11 text-left font-mono text-sm ${on ? "text-fg" : "text-muted"}`}
                onClick={() => setChosen((current) => (current.includes(item) ? current.filter((entry) => entry !== item) : [...current, item]))}
              >
                {item}
              </button>
            );
          })}
        </div>
        <Button type="submit" disabled={pending || chosen.length === 0}>
          {pending ? "Creating…" : "Create webhook"}
        </Button>
      </form>
      {secret ? (
        <div className="mt-6 border border-border p-4">
          <p className="text-sm">This is the only time this signing secret is shown.</p>
          <p className="mt-3 font-mono text-sm break-all">{secret}</p>
          <div className="mt-3">
            <CopyButton value={secret} label="webhook secret" />
          </div>
        </div>
      ) : null}
      <ul className="mt-8 divide-y divide-border border-y border-border">
        {(hooks ?? []).map((hook) => (
          <li key={hook.id} className="grid gap-1 py-3 text-sm">
            <span className="break-all">{hook.url}</span>
            <span className="font-mono text-xs text-muted">{hook.events.join(" · ")}</span>
            <span className="text-muted">Created {formatUtc(hook.createdAt)}</span>
            {hook.disabledAt ? (
              <span className="text-muted">Disabled {formatUtc(hook.disabledAt)}</span>
            ) : (
              <button
                type="button"
                className="h-11 text-left text-sm text-muted hover:text-fg"
                onClick={() => {
                  disableDeveloperWebhook({ data: hook.id })
                    .then(() => reload())
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : "The webhook was not disabled."));
                }}
              >
                Disable
              </button>
            )}
          </li>
        ))}
      </ul>
      {hooks && hooks.length === 0 ? <p className="mt-4 text-sm text-muted">No webhooks yet.</p> : null}
    </div>
  );
}
