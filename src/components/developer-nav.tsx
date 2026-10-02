import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { buttonClass } from "@/components/ui";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

const LINKS = [
  { to: "/developers", label: "Overview" },
  { to: "/developers/docs", label: "Docs" },
  { to: "/developers/sdk", label: "SDK" },
  { to: "/developers/api", label: "API" },
  { to: "/developers/webhooks", label: "Webhooks" },
] as const;

export function DeveloperNav({ current }: { current: string }) {
  return (
    <nav className="mt-8 -mx-5 overflow-x-auto px-5 md:mx-0 md:px-0" aria-label="Developer">
      <div className="flex w-max min-w-full gap-1 border-b border-border">
        {LINKS.map((item) => {
          const active = item.to === current;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`inline-flex h-11 shrink-0 items-center border-b px-3 text-sm ${active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
              aria-current={active ? "page" : undefined}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

const google = GROK_PROVIDERS.find((provider) => provider.idp === "google");

export function DeveloperGate({ callbackURL, children }: { callbackURL: string; children: ReactNode }) {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <div className="mt-8 h-11 w-44 animate-pulse rounded-sm bg-subtle" />;
  if (!user && authEnabled && google) {
    return (
      <button
        type="button"
        className={buttonClass("primary", "mt-8")}
        onClick={() => void signIn(google.providerId, { callbackURL })}
      >
        Sign in
      </button>
    );
  }
  if (!user) return <p className="mt-8 text-sm text-muted">Sign in is not available.</p>;
  return children;
}
