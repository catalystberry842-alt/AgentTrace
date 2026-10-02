import type { ErrorComponentProps } from "@tanstack/react-router";

const FALLBACK_MESSAGE = "An unexpected error occurred. Try reloading the page.";

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return FALLBACK_MESSAGE;
}

export function AppErrorComponent({ error }: ErrorComponentProps) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg px-6 text-center text-fg">
      <h1 className="text-lg font-medium">Something went wrong</h1>
      <p className="max-w-md text-sm text-muted">We could not load this page.</p>
      <p className="max-w-md text-sm break-words text-muted">{errorMessage(error)}</p>
      <button type="button" className="mt-2 h-11 text-sm text-fg hover:underline" onClick={() => window.location.reload()}>
        Retry
      </button>
    </main>
  );
}
