import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { NotFoundState } from "@/components/ui";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Toaster } from "sonner";
import appCss from "../styles.css?url";

const APP_NAME = "AgentTrace";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content: "Identity and provenance infrastructure for AI agents on Monad.",
      },
      { name: "theme-color", content: "#0b0b0d" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Instrument+Sans:wght@400;500;600&display=swap",
      },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootComponent() {
  return (
    <html lang="en" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <PreviewHostBridge />
        <Tooltip.Provider delayDuration={400}>
          <AuthProvider>
            <Outlet />
          </AuthProvider>
          <Toaster
            theme="dark"
            position="bottom-right"
            visibleToasts={1}
            toastOptions={{
              style: {
                background: "var(--color-surface)",
                color: "var(--color-fg)",
                border: "1px solid var(--color-border)",
                borderRadius: "8px",
              },
            }}
          />
        </Tooltip.Provider>
        <Scripts />
      </body>
    </html>
  );
}

function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center bg-bg px-6 text-fg">
      <NotFoundState
        title="Page not found"
        description="This page is not part of AgentTrace."
        action={
          <a href="/" className="text-sm text-fg underline-offset-4 hover:underline">
            Back to AgentTrace
          </a>
        }
      />
    </main>
  );
}
