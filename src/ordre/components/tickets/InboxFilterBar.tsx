import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TICKET_PRIORITIES, TICKET_PRIORITY_LABEL } from "@/ordre/lib/ticketFormat";
import type { TicketPriority } from "@/ordre/hooks/useTickets";

/** Gyldig prioritet fra URL; alt annet er «alle». */
export function parsePriorityParam(raw: string | null): TicketPriority | "all" {
  return TICKET_PRIORITIES.find((p) => p === raw) ?? "all";
}

/**
 * Søk alltid synlig; prioritet ligger bak «Flere filtre» på smal skjerm.
 * Aktive valg vises som fjernbare brikker utenfor folden.
 */
export default function InboxFilterBar({
  search,
  priority,
  onSearch,
  onPriority,
  onReset,
}: {
  search: string;
  priority: TicketPriority | "all";
  onSearch: (v: string) => void;
  onPriority: (v: TicketPriority | "all") => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const activeCount = (search.trim() ? 1 : 0) + (priority !== "all" ? 1 : 0);
  const prioritySelect = (
    <div className="flex flex-col gap-1">
      <label htmlFor="inbox-priority" className="text-caption font-medium text-muted-foreground lg:sr-only">
        Prioritet
      </label>
      <select
        id="inbox-priority"
        value={priority}
        onChange={(e) => onPriority(parsePriorityParam(e.target.value))}
        className="h-9 rounded-[10px] border border-border bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="all">Alle prioriteter</option>
        {TICKET_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {TICKET_PRIORITY_LABEL[p]}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-2 border-b border-border p-2">
      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="inbox-search" className="sr-only">
            Søk i henvendelser
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              id="inbox-search"
              type="search"
              value={search}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Søk i kunde, emne eller ordrenummer …"
              className="h-9 bg-background pl-8"
            />
          </div>
        </div>
        <div className="hidden lg:block">{prioritySelect}</div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 gap-1.5 lg:hidden"
          aria-expanded={open}
          aria-controls="inbox-more-filters"
          onClick={() => setOpen((v) => !v)}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Flere filtre{priority !== "all" ? " (1)" : ""}
        </Button>
      </div>

      {open && (
        <div id="inbox-more-filters" className="lg:hidden">
          {prioritySelect}
        </div>
      )}

      {activeCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Aktive filtre">
          {search.trim() && (
            <Chip label={`Søk: «${search.trim().slice(0, 40)}»`} onRemove={() => onSearch("")} />
          )}
          {priority !== "all" && (
            <Chip
              label={`Prioritet: ${TICKET_PRIORITY_LABEL[priority]}`}
              onRemove={() => onPriority("all")}
            />
          )}
          <Button variant="ghost" size="sm" className="h-7 px-2 text-caption" onClick={onReset}>
            Nullstill filtre
          </Button>
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 py-0.5 pl-2.5 pr-1 text-caption text-foreground">
      {label}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Fjern filter ${label}`}
        className="rounded-full p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-3 w-3" aria-hidden="true" />
      </button>
    </span>
  );
}
