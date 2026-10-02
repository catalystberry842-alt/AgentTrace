import { useState } from "react";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Shell } from "@/components/shell";
import { Button } from "@/components/ui";

export const Route = createFileRoute("/login")({ component: Login });

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

function Login() {
  const { user, isPending } = useCurrentUserState();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!isPending && user) return <Navigate to="/agents" />;

  return (
    <Shell>
      <p className="type-caption text-faint">Account</p>
      <h1 className="type-heading mt-2">Sign in</h1>
      <p className="mt-3 max-w-sm text-sm text-pretty text-muted">
        Google identifies your account. It is not a wallet and it does not create an onchain agent.
      </p>
      <div className="mt-8">
        {isPending ? <div className="h-11 w-52 animate-pulse rounded-sm bg-subtle" /> : null}
        {!isPending && authEnabled && google ? (
          <Button
            type="button"
            className="w-full sm:w-auto"
            loading={pending}
            onClick={() => {
              setPending(true);
              setError(null);
              void signIn(google.providerId, { callbackURL: "/agents" }).catch((err: unknown) => {
                setPending(false);
                setError(err instanceof Error ? err.message : "Sign-in failed");
              });
            }}
          >
            {pending ? "Continuing…" : "Continue with Google"}
          </Button>
        ) : null}
        {!isPending && !authEnabled ? <p className="text-sm text-muted">Sign-in is disabled.</p> : null}
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
      </div>
    </Shell>
  );
}
