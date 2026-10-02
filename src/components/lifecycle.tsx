const STAGES = ["Identity", "Control", "Execution", "Proof", "Outcome"] as const;

export type StageState = "complete" | "current" | "later";

export function Lifecycle({ stages }: { stages: Record<(typeof STAGES)[number], { state: StageState; detail: string }> }) {
  return (
    <ol className="grid gap-6 sm:grid-cols-5" aria-label="Agent lifecycle">
      {STAGES.map((name) => {
        const stage = stages[name];
        const mark = stage.state === "complete" ? "✓" : stage.state === "current" ? "→" : "○";
        return (
          <li key={name} className={stage.state === "later" ? "text-faint" : "text-fg"} aria-current={stage.state === "current" ? "step" : undefined}>
            <p className="type-caption">
              <span aria-hidden>{mark} </span>
              {name}
            </p>
            <p className="mt-2 text-sm">{stage.detail}</p>
          </li>
        );
      })}
    </ol>
  );
}
