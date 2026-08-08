import { useMemo, useState } from "react";
import { Search, Trash2, ChevronUp, ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLabelFieldCatalog } from "../../hooks/useLabelFieldCatalog";
import { fieldIcon } from "../../lib/fieldIcons";
import { type FieldType, type ProfileField } from "../../types";

interface Props {
  fields: ProfileField[];
  activeFieldTypes: Set<FieldType>;
  selectedFieldType: FieldType | null;
  onClickField: (type: FieldType) => void;
  onSelectField: (type: FieldType | null) => void;
  onUpdateField: (type: FieldType, patch: Partial<ProfileField>) => void;
}

export function LeftPanel(props: Props) {
  const catalog = useLabelFieldCatalog();
  const [tab, setTab] = useState<"felter" | "lag">("felter");
  const placedCount = props.activeFieldTypes.size;

  return (
    <div className="flex h-full flex-col border-r border-border bg-card">
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border px-3 pt-3">
        <TabBtn active={tab === "felter"} onClick={() => setTab("felter")}>
          Felter
          <Badge>{catalog.keys.length}</Badge>
        </TabBtn>
        <TabBtn active={tab === "lag"} onClick={() => setTab("lag")}>
          Lag
          <Badge>{placedCount}</Badge>
        </TabBtn>
      </div>

      {tab === "felter" ? (
        <FieldsTab {...props} />
      ) : (
        <LayersTab {...props} />
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative flex items-center gap-2 px-3 pb-3 text-sm font-medium transition",
        active
          ? "text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-bronze"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
      {children}
    </span>
  );
}

function FieldsTab({
  activeFieldTypes,
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
    <>
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Søk felt, eller dra ut på etiketten…"
            className="h-9 border-border bg-background pl-8 text-xs"
          />
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-border bg-muted px-1 text-[10px] font-medium text-muted-foreground">
            /
          </kbd>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {groups.map((g) => {
          const items = g.keys;
          return (
            <div key={g.group} className="mb-4">
              <h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                {g.label}
              </h4>
              <div className="grid grid-cols-2 gap-1.5">
                {items.map((type) => {
                  const active = activeFieldTypes.has(type);
                  const Icon = fieldIcon(type, catalog.group(type));
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
                      }}
                      onClick={() => {
                        if (!active) onClickField(type);
                      }}
                      disabled={active}
                      title={catalog.sourceLabel(type)}
                      className={cn(
                        "group relative flex h-9 items-center gap-1.5 rounded-[10px] border px-2 text-left text-xs font-medium transition",
                        active
                          ? "cursor-default border-dashed border-border/50 bg-transparent text-muted-foreground/50"
                          : "cursor-grab border-border bg-background text-foreground hover:border-brand-bronze hover:bg-brand-bronze/5 active:cursor-grabbing",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate">{catalog.label(type)}</span>
                      {active && (
                        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-brand-bronze" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {hits === 0 && (
          <p className="px-2 py-4 text-center text-xs text-muted-foreground">
            Ingen felt matcher «{query}».
          </p>
        )}
      </div>
    </>
  );
}

function LayersTab({
  fields,
  selectedFieldType,
  onSelectField,
  onUpdateField,
}: Props) {
  const catalog = useLabelFieldCatalog();
  const placed = useMemo(
    () => fields.filter((f) => f.include).sort((a, b) => b.z_index - a.z_index),
    [fields],
  );

  if (placed.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-xs text-muted-foreground">
          Ingen felt på etiketten ennå.
          <br />
          Bytt til Felter-fanen for å legge til.
        </p>
      </div>
    );
  }

  const moveZ = (type: FieldType, dir: 1 | -1) => {
    const sorted = [...fields.filter((f) => f.include)].sort(
      (a, b) => a.z_index - b.z_index,
    );
    const idx = sorted.findIndex((f) => f.field_type === type);
    if (idx < 0) return;
    const swapWith = sorted[idx + dir];
    if (!swapWith) return;
    const a = sorted[idx];
    const tmp = a.z_index;
    onUpdateField(a.field_type, { z_index: swapWith.z_index });
    onUpdateField(swapWith.field_type, { z_index: tmp });
  };

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <ul className="space-y-1">
        {placed.map((f) => {
          const Icon = fieldIcon(f.field_type, catalog.group(f.field_type));
          const isSel = selectedFieldType === f.field_type;
          return (
            <li
              key={f.field_type}
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs transition",
                isSel
                  ? "border-brand-bronze bg-brand-bronze/5"
                  : "border-transparent hover:bg-muted",
              )}
            >
              <button
                type="button"
                className="flex flex-1 items-center gap-2 text-left"
                onClick={() => onSelectField(f.field_type)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">
                  {catalog.label(f.field_type)}
                </span>
              </button>
              <div className="flex items-center opacity-0 transition group-hover:opacity-100">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => moveZ(f.field_type, 1)}
                  aria-label="Flytt opp"
                  title="Flytt fram"
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => moveZ(f.field_type, -1)}
                  aria-label="Flytt ned"
                  title="Flytt bak"
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive hover:text-destructive"
                  onClick={() => {
                    onUpdateField(f.field_type, { include: false });
                    if (isSel) onSelectField(null);
                  }}
                  aria-label="Fjern"
                  title="Fjern fra etiketten"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
