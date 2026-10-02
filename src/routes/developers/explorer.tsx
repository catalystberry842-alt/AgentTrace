import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Button, Field, TextInput } from "@/components/ui";

export const Route = createFileRoute("/developers/explorer")({ component: ExplorerPage });

const CALLS = [
  { id: "agent", label: "GET /api/v1/agents/:id", path: (id: string) => `/api/v1/agents/${encodeURIComponent(id)}` },
  { id: "firewall", label: "GET /api/v1/firewalls/:id", path: (id: string) => `/api/v1/firewalls/${encodeURIComponent(id)}` },
  { id: "execution", label: "GET /api/v1/executions/:id", path: (id: string) => `/api/v1/executions/${encodeURIComponent(id)}` },
  { id: "proof", label: "GET /api/v1/proofs/:executionId", path: (id: string) => `/api/v1/proofs/${encodeURIComponent(id)}` },
  { id: "outcome", label: "GET /api/v1/outcomes/:executionId", path: (id: string) => `/api/v1/outcomes/${encodeURIComponent(id)}` },
] as const;

function ExplorerPage() {
  const [call, setCall] = useState<(typeof CALLS)[number]["id"]>("agent");
  const [id, setId] = useState("");
  const [status, setStatus] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [pending, setPending] = useState(false);
  const selected = CALLS.find((item) => item.id === call) ?? CALLS[0];

  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">API explorer</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        Read-only. This page does not ask for an API key and will not put one in the request.
      </p>
      <DeveloperNav current="/developers/explorer" />
      <form
        className="mt-8 grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setPending(true);
          setStatus(null);
          setBody("");
          const path = selected.path(id.trim());
          void fetch(path, { headers: { accept: "application/json" } })
            .then(async (response) => {
              setStatus(response.status);
              const text = await response.text();
              try {
                setBody(JSON.stringify(JSON.parse(text), null, 2));
              } catch {
                setBody(text.slice(0, 2000));
              }
            })
            .catch((err: unknown) => setBody(err instanceof Error ? err.message : "The request failed."))
            .finally(() => setPending(false));
        }}
      >
        <div className="flex flex-col" role="group" aria-label="Request">
          {CALLS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={call === item.id}
              className={`h-11 text-left font-mono text-sm ${call === item.id ? "text-fg" : "text-muted"}`}
              onClick={() => setCall(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <Field label="Id">
          <TextInput value={id} onChange={(event) => setId(event.target.value)} required spellCheck={false} autoCapitalize="off" />
        </Field>
        <p className="font-mono text-xs break-all text-muted">GET {selected.path(id.trim() || ":id")}</p>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Send"}
        </Button>
      </form>
      {status != null ? (
        <section className="mt-8">
          <h2 className="text-sm font-medium">Response {status}</h2>
          <pre className="mt-3 overflow-x-auto border border-border p-4 font-mono text-xs">{body}</pre>
        </section>
      ) : null}
    </Shell>
  );
}
