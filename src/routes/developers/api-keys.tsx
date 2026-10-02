import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createDeveloperKey, listDeveloperKeys, revokeDeveloperKey } from "@/lib/developer/functions";
import { DeveloperGate, DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Button, ErrorNote, Field, TextInput } from "@/components/ui";
import { CopyButton } from "@/components/values";
import { formatUtc } from "@/lib/format";

export const Route = createFileRoute("/developers/api-keys")({ component: ApiKeysPage });

type KeyEnvironment = "development" | "production";

type KeyRow = {
  id: string;
  name: string;
  environment: KeyEnvironment;
  prefix: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

function ApiKeysPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">API keys</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        The full key is shown once. Only a hash is stored. Revoking a key stops it immediately.
      </p>
      <DeveloperNav current="/developers/api-keys" />
      <DeveloperGate callbackURL="/developers/api-keys">
        <KeyManager />
      </DeveloperGate>
    </Shell>
  );
}

function KeyManager() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<KeyEnvironment>("development");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function reload() {
    return listDeveloperKeys()
      .then((result) => setKeys(result.keys))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load keys."));
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
          setToken(null);
          createDeveloperKey({ data: { name, environment } })
            .then((result) => {
              setToken(result.token);
              setName("");
              return reload();
            })
            .catch((err: unknown) => setError(err instanceof Error ? err.message : "The key was not created."))
            .finally(() => setPending(false));
        }}
      >
        <Field label="Name">
          <TextInput value={name} onChange={(event) => setName(event.target.value)} required maxLength={64} />
        </Field>
        <div className="flex gap-4" role="group" aria-label="Environment">
          {(["development", "production"] as const).map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={environment === item}
              className={`h-11 text-sm ${environment === item ? "text-fg" : "text-muted"}`}
              onClick={() => setEnvironment(item)}
            >
              {item === "development" ? "Development" : "Production"}
            </button>
          ))}
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create API key"}
        </Button>
      </form>
      {token ? (
        <div className="mt-6 border border-border p-4">
          <p className="text-sm">This is the only time this key is shown. It is not saved in the browser.</p>
          <p className="mt-3 font-mono text-sm break-all">{token}</p>
          <div className="mt-3">
            <CopyButton value={token} label="API key" />
          </div>
        </div>
      ) : null}
      <ul className="mt-8 divide-y divide-border border-y border-border">
        {(keys ?? []).map((key) => (
          <li key={key.id} className="grid gap-1 py-3 text-sm">
            <span>{key.name}</span>
            <span className="text-muted">
              {key.environment} · <span className="font-mono">{key.prefix}…</span>
            </span>
            <span className="text-muted">Created {formatUtc(key.createdAt)}</span>
            <span className="text-muted">Last used {formatUtc(key.lastUsedAt)}</span>
            {key.revokedAt ? (
              <span className="text-muted">Revoked {formatUtc(key.revokedAt)}</span>
            ) : (
              <button
                type="button"
                className="h-11 text-left text-sm text-muted hover:text-fg"
                onClick={() => {
                  setError(null);
                  revokeDeveloperKey({ data: key.id })
                    .then(() => reload())
                    .catch((err: unknown) => setError(err instanceof Error ? err.message : "The key was not revoked."));
                }}
              >
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>
      {keys && keys.length === 0 ? (
        <div className="mt-4">
          <p className="text-sm font-medium">No API keys</p>
          <p className="mt-2 text-sm text-muted">Create an API key to integrate AgentTrace.</p>
        </div>
      ) : null}
    </div>
  );
}
