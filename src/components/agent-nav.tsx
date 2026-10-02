import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { Status } from "@/components/ui";
import { formatAgentLabel } from "@/lib/format";

const TABS = [
  { id: "overview", label: "Overview", to: "/agents/$agentId" },
  { id: "firewall", label: "Firewall", to: "/agents/$agentId/firewall" },
  { id: "activity", label: "Activity", to: "/agents/$agentId/activity" },
  { id: "proofs", label: "Proofs", to: "/agents/$agentId/proofs" },
  { id: "outcomes", label: "Outcomes", to: "/agents/$agentId/outcomes" },
] as const;

export type AgentSection = (typeof TABS)[number]["id"];

export function AgentFrame({
  agentId,
  name,
  section,
  status,
  description,
  title,
  children,
}: {
  agentId: string;
  name: string;
  section: AgentSection;
  status?: "Active" | "Inactive";
  description?: string;
  title?: string;
  children: ReactNode;
}) {
  const sectionLabel = TABS.find((tab) => tab.id === section)?.label ?? "Overview";
  const displayName = name || formatAgentLabel(agentId);
  return (
    <Shell wide>
      <nav className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted" aria-label="Breadcrumb">
        <Link to="/agents" className="hover:text-fg">
          Agents
        </Link>
        <span aria-hidden>/</span>
        {section === "overview" ? (
          <span className="text-fg">{displayName}</span>
        ) : (
          <>
            <Link to="/agents/$agentId" params={{ agentId }} className="hover:text-fg">
              {displayName}
            </Link>
            <span aria-hidden>/</span>
            <span className="text-fg">{sectionLabel}</span>
          </>
        )}
      </nav>
      <header className="mt-6 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="type-caption text-faint">Agent</p>
          <h1 className="type-heading mt-2 text-balance md:text-3xl">{displayName}</h1>
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
            <span className="font-mono">{formatAgentLabel(agentId)}</span>
            {status ? <Status status={status === "Active" ? "active" : "inactive"} /> : null}
          </p>
          {section === "overview" && description ? <p className="mt-4 max-w-xl text-sm text-pretty text-muted">{description}</p> : null}
          {title && title !== displayName ? <p className="mt-4 text-sm text-muted">{title}</p> : null}
        </div>
      </header>
      <div className="mt-8 md:grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10">
        <nav className="-mx-5 overflow-x-auto px-5 md:mx-0 md:px-0" aria-label="Agent">
          <div className="flex w-max min-w-full gap-1 border-b border-border md:w-auto md:flex-col md:border-b-0">
            {TABS.map((tab) => {
              const active = tab.id === section;
              return (
                <Link
                  key={tab.id}
                  to={tab.to}
                  params={{ agentId }}
                  aria-current={active ? "page" : undefined}
                  className={`inline-flex h-11 shrink-0 items-center border-b px-3 text-sm md:border-b-0 md:border-l md:px-3 ${active ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"}`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
        <div className="mt-8 min-w-0 md:mt-0">{children}</div>
      </div>
    </Shell>
  );
}
