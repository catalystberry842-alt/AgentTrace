import { createFileRoute, Link } from "@tanstack/react-router";
import { DeveloperNav } from "@/components/developer-nav";
import { Shell } from "@/components/shell";
import { Mono } from "@/components/ui";

export const Route = createFileRoute("/developers/api")({ component: ApiPage });

const ROUTES = [
  "POST /api/v1/agents",
  "GET /api/v1/agents/:id",
  "PATCH /api/v1/agents/:id",
  "POST /api/v1/firewalls",
  "GET /api/v1/firewalls/:id",
  "POST /api/v1/firewalls/:id/execute",
  "POST /api/v1/firewalls/:id/targets",
  "POST /api/v1/firewalls/:id/functions",
  "GET /api/v1/executions/:id",
  "GET /api/v1/proofs/:executionId",
  "POST /api/v1/proofs/:executionId/verify",
  "GET /api/v1/outcomes/:executionId",
  "POST /api/v1/outcomes/:executionId/verify",
  "GET /api/v1/webhooks",
  "POST /api/v1/webhooks",
  "DELETE /api/v1/webhooks/:id",
] as const;

function ApiPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-medium tracking-tight">API</h1>
      <p className="mt-3 max-w-xl text-sm text-muted">
        REST under <Mono>/api/v1</Mono>. Send the key as a bearer token. Keys are not accepted in the query string. Errors use <Mono>error.code</Mono> and <Mono>error.message</Mono>.
      </p>
      <DeveloperNav current="/developers/api" />
      <ul className="mt-8 divide-y divide-border border-y border-border font-mono text-xs">
        {ROUTES.map((route) => (
          <li key={route} className="py-3">
            {route}
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-xl text-sm text-muted">
        Writes that cannot be confirmed return status failed, null ids, and a null transaction hash. Rate limits answer with 429 and Retry-After.
      </p>
      <div className="mt-4 flex flex-col gap-1 sm:flex-row sm:gap-6">
        <Link to="/developers/api-keys" className="inline-flex h-11 items-center text-sm hover:underline">
          Create API key
        </Link>
        <Link to="/developers/explorer" className="inline-flex h-11 items-center text-sm text-muted hover:text-fg">
          API explorer
        </Link>
      </div>
    </Shell>
  );
}
