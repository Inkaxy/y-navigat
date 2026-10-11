import { cn } from "@/lib/utils";

export type FilterChip<K extends string> = { id: K; label: string; count?: number | null };

type Props<K extends string> = {
  chips: FilterChip<K>[];
  value: K;
  onChange: (k: K) => void;
  ariaLabel?: string;
};

/** Hurtigfiltre som chips med tall. Verdien ligger i adressen hos kalleren. */
export function FilterChips<K extends string>({ chips, value, onChange, ariaLabel = "Hurtigfilter" }: Props<K>) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={value === c.id}
          onClick={() => onChange(c.id)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm",
            value === c.id ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border text-ink-secondary hover:text-foreground",
          )}
        >
          {c.label}
          {c.count != null && <span className="tabular-nums text-ink-secondary">{c.count}</span>}
        </button>
      ))}
    </div>
  );
}
