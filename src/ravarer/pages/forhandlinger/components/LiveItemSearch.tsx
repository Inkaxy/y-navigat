import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, Search } from "lucide-react";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

interface Props {
  rawMaterials: RawMaterialRow[];
  excludeIds: Set<string>;
  onAdd: (rmId: string) => void;
  disabled?: boolean;
}

export function LiveItemSearch({ rawMaterials, excludeIds, onAdd, disabled }: Props) {
  const [q, setQ] = useState("");

  const matches = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return [];
    return rawMaterials
      .filter((r) => r.is_active && !excludeIds.has(r.id))
      .filter((r) =>
        r.name.toLowerCase().includes(term) ||
        (r.sku ?? "").toLowerCase().includes(term)
      )
      .slice(0, 8);
  }, [q, rawMaterials, excludeIds]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Søk og legg til råvare…"
          className="pl-9"
          disabled={disabled}
        />
      </div>
      {matches.length > 0 && (
        <div className="overflow-hidden rounded-md border border-line-subtle bg-surface">
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onAdd(m.id);
                setQ("");
              }}
              className="flex w-full items-center justify-between gap-3 border-b border-line-subtle px-3 py-2 text-left text-sm last:border-0 hover:bg-surface-muted/50"
            >
              <div>
                <p className="font-medium">{m.name}</p>
                <p className="text-xs text-ink-muted">{m.sku}</p>
              </div>
              <Plus className="h-4 w-4 text-primary" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
