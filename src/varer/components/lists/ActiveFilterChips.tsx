import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ActiveFilter = { key: string; label: string; onRemove: () => void };

/**
 * Antall treff + aktive filtre som fjernbare valg. Under første lasting vises
 * «Laster …» i stedet for et tall, slik at listen aldri ser tom ut.
 */
export function ListResultSummary({
  count,
  noun,
  isLoading,
  isError,
  filters,
  onReset,
}: {
  count: number;
  noun: [singular: string, plural: string];
  isLoading: boolean;
  isError: boolean;
  filters: ActiveFilter[];
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <p className="text-body text-muted-foreground">
        {isError
          ? "Kunne ikke hente listen"
          : isLoading
            ? "Laster …"
            : `${count.toLocaleString("nb-NO")} ${count === 1 ? noun[0] : noun[1]}`}
      </p>
      {filters.length > 0 && (
        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Aktive filtre">
          {filters.map((f) => (
            <li key={f.key}>
              <button
                type="button"
                onClick={f.onRemove}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-caption text-foreground transition-colors hover:border-app/50 hover:bg-app/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Fjern filter: ${f.label}`}
              >
                {f.label}
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-caption" onClick={onReset}>
              Nullstill filtre
            </Button>
          </li>
        </ul>
      )}
    </div>
  );
}
