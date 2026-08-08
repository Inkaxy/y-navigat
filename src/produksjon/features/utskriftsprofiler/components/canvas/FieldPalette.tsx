import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useLabelFieldCatalog } from "../../hooks/useLabelFieldCatalog";
import { fieldIcon } from "../../lib/fieldIcons";
import type { FieldType } from "../../types";

interface Props {
  activeFieldTypes: Set<FieldType>;
  onDragStartField: (type: FieldType) => void;
  onClickField: (type: FieldType) => void;
}

export function FieldPalette({
  activeFieldTypes,
  onDragStartField,
  onClickField,
}: Props) {
  const catalog = useLabelFieldCatalog();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.groups
      .map((g) => ({
        ...g,
        keys: q
          ? g.keys.filter((k) => catalog.label(k).toLowerCase().includes(q))
          : g.keys,
      }))
      .filter((g) => g.keys.length > 0);
  }, [catalog, query]);

  const hits = groups.reduce((acc, g) => acc + g.keys.length, 0);

  return (
    <div className="flex h-full flex-col border-r border-border bg-muted/20">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk felt …"
            className="h-9 pl-8"
          />
        </div>
        <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
          Dra felt over på etiketten, eller klikk for å legge til.
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {groups.map((g) => (
          <div key={g.group} className="mb-3">
            <h4 className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {g.label}
            </h4>
            <div className="grid grid-cols-2 gap-1">
              {g.keys.map((type) => {
                const active = activeFieldTypes.has(type);
                const Icon = fieldIcon(type, catalog.group(type));
                const label = catalog.label(type);
                return (
                  <button
                    key={type}
                    type="button"
                    draggable={!active}
                    onDragStart={(e) => {
                      if (active) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.setData("text/x-field-type", type);
                      e.dataTransfer.effectAllowed = "copy";
                      onDragStartField(type);
                    }}
                    onClick={() => {
                      if (!active) onClickField(type);
                    }}
                    disabled={active}
                    title={catalog.sourceLabel(type)}
                    className={cn(
                      "group relative flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-xs transition",
                      active
                        ? "cursor-default border-dashed border-border/60 bg-transparent text-muted-foreground/60"
                        : "cursor-grab border-border/60 bg-card hover:border-primary/50 hover:bg-accent active:cursor-grabbing",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        active ? "text-muted-foreground/50" : "text-muted-foreground",
                      )}
                    />
                    <span className="truncate">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        {hits === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            Ingen felt matcher «{query}».
          </p>
        )}
      </div>
    </div>
  );
}
