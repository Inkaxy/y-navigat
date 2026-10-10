import { Button } from "@/components/ui/button";
import { useDebouncedValue } from "@/kunder/hooks/useDebouncedValue";
import { useRavarerEntitySearch } from "@/hooks/useRavarerEntitySearch";

/** «Finnes allerede?» — samme søk som ⌘K, inntil tre treff. */
export function DuplicateSuggestions({ name, onUse, useLabel = "Bruk denne" }: { name: string; onUse: (id: string, title: string) => void; useLabel?: string }) {
  const term = useDebouncedValue(name, 250);
  const { hits } = useRavarerEntitySearch(term);
  const matches = hits.filter((h) => h.kind === "raw_material").slice(0, 3);
  if (matches.length === 0) return null;
  return (
    <div className="rounded-lg border border-[hsl(var(--alert-warning))]/40 bg-[hsl(var(--alert-warning))]/5 p-3" role="status">
      <p className="text-sm font-medium">Finnes allerede?</p>
      <ul className="mt-2 space-y-1.5">
        {matches.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate">
              {m.title}
              {m.subtitle && <span className="text-muted-foreground"> · {m.subtitle}</span>}
            </span>
            <Button type="button" size="sm" variant="outline" onClick={() => onUse(m.id, m.title)}>{useLabel}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
