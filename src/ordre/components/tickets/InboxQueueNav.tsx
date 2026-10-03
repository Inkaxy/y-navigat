import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { REQUEST_TYPE_LABEL, type RequestType } from "@/ordre/lib/aiSuggestion";
import { TEAMS, TEAM_LABEL } from "@/ordre/lib/teams";
import { PRIMARY_QUEUES, type QueueKey } from "@/ordre/lib/ticketQueues";

export const INTENT_QUEUES: { key: RequestType; label: string }[] = [
  { key: "new_order", label: REQUEST_TYPE_LABEL.new_order },
  { key: "change", label: REQUEST_TYPE_LABEL.change },
  { key: "cancellation", label: REQUEST_TYPE_LABEL.cancellation },
  { key: "complaint", label: REQUEST_TYPE_LABEL.complaint },
  { key: "question", label: REQUEST_TYPE_LABEL.question },
];

type Group = { label: string; items: { key: QueueKey; label: string; description?: string }[] };

export const QUEUE_GROUPS: Group[] = [
  { label: "Arbeidskøer", items: PRIMARY_QUEUES },
  {
    label: "Alle saker",
    items: [
      { key: "new", label: "Nye" },
      { key: "all_open", label: "Alle åpne" },
      { key: "resolved", label: "Løste" },
      { key: "closed", label: "Lukket" },
      { key: "spam", label: "Søppel" },
    ],
  },
  {
    label: "Type henvendelse",
    items: INTENT_QUEUES.map((q) => ({ key: `intent:${q.key}` as QueueKey, label: q.label })),
  },
  {
    label: "Team",
    items: TEAMS.map((t) => ({ key: `team:${t}` as QueueKey, label: TEAM_LABEL[t] })),
  },
];

export const ALL_QUEUE_KEYS: QueueKey[] = QUEUE_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export function queueLabel(queue: QueueKey): string {
  for (const g of QUEUE_GROUPS) {
    const hit = g.items.find((i) => i.key === queue);
    if (hit) return hit.label;
  }
  return "Mine";
}

function formatCount(count: number | undefined, loading: boolean): string {
  if (loading || count === undefined) return "–";
  return String(count);
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 mt-4 px-3 text-caption font-semibold uppercase tracking-widest text-muted-foreground first:mt-1">
      {children}
    </div>
  );
}

/** Venstrepanel på stor skjerm. */
export function InboxQueueNav({
  queue,
  counts,
  loading,
  onSelect,
}: {
  queue: QueueKey;
  counts: Record<string, number>;
  loading: boolean;
  onSelect: (q: QueueKey) => void;
}) {
  return (
    <nav
      aria-label="Arbeidskøer"
      className="hidden min-h-0 overflow-y-auto rounded-[10px] border border-border bg-card p-2 lg:block"
    >
      {QUEUE_GROUPS.map((g) => (
        <div key={g.label}>
          <SectionLabel>{g.label}</SectionLabel>
          {g.items.map((q) => {
            const active = queue === q.key;
            return (
              <button
                key={q.key}
                type="button"
                onClick={() => onSelect(q.key)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-[10px] px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-primary/10 font-semibold text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm">{q.label}</span>
                  {q.description && (
                    <span className="block truncate text-caption text-muted-foreground">
                      {q.description}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-caption font-semibold tabular-nums",
                    active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                  )}
                >
                  {formatCount(counts[q.key], loading)}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** Kompakt køvelger for mobil og nettbrett. */
export function InboxQueueSelect({
  queue,
  counts,
  loading,
  onSelect,
}: {
  queue: QueueKey;
  counts: Record<string, number>;
  loading: boolean;
  onSelect: (q: QueueKey) => void;
}) {
  return (
    <div className="lg:hidden">
      <label htmlFor="inbox-queue" className="mb-1 block text-caption font-medium text-muted-foreground">
        Kø
      </label>
      <select
        id="inbox-queue"
        value={queue}
        onChange={(e) => {
          const next = ALL_QUEUE_KEYS.find((k) => k === e.target.value);
          if (next) onSelect(next);
        }}
        className="h-10 w-full rounded-[10px] border border-border bg-background px-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {QUEUE_GROUPS.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.items.map((q) => (
              <option key={q.key} value={q.key}>
                {q.label} ({formatCount(counts[q.key], loading)})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
