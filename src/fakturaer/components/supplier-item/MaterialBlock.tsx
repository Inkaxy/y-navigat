import { Loader2, Plus, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectTrigger, SelectValue, SelectItem } from "@/components/ui/select";
import { CategorySelectItems } from "@/ravarer/components/CategorySelectItems";
import { ITEM_TYPES, defaultCategoryFor, type ItemType } from "@/ravarer/lib/itemTypes";
import { CANONICAL_BASE_UNITS } from "@/fakturaer/lib/units";
import type { MaterialChoice } from "@/fakturaer/hooks/useMaterialChoices";
import { cn } from "@/lib/utils";

export interface NewMaterialDraft {
  name: string;
  itemType: ItemType;
  category: string;
  baseUnit: string;
  declarationName: string;
}

interface Props {
  idPrefix: string;
  mode: "existing" | "new";
  onModeChange: (m: "existing" | "new") => void;
  selected: MaterialChoice | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  suggestions: MaterialChoice[];
  results: MaterialChoice[];
  searching: boolean;
  search: string;
  onSearch: (v: string) => void;
  draft: NewMaterialDraft;
  onDraft: (d: NewMaterialDraft) => void;
}

/** Blokk 1: «Hvilken råvare er dette?» */
export function MaterialBlock(p: Props) {
  if (p.mode === "new") {
    const d = p.draft;
    return (
      <div className="space-y-3 rounded-md border border-line-subtle p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Ny råvare</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => p.onModeChange("existing")}>Velg eksisterende i stedet</Button>
        </div>
        <div>
          <Label htmlFor={`${p.idPrefix}-name`} className="text-caption">Navn</Label>
          <Input id={`${p.idPrefix}-name`} value={d.name} onChange={(e) => p.onDraft({ ...d, name: e.target.value })} />
        </div>
        <div>
          <p className="text-caption">Varetype</p>
          <div className="mt-1 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {ITEM_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                aria-pressed={d.itemType === t.value}
                onClick={() => p.onDraft({ ...d, itemType: t.value, category: defaultCategoryFor(t.value) ?? d.category })}
                className={cn("rounded-md border px-2 py-1.5 text-left text-sm", d.itemType === t.value ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40")}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-caption">Kategori</Label>
            <Select value={d.category || undefined} onValueChange={(v) => p.onDraft({ ...d, category: v })}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Velg kategori" /></SelectTrigger>
              <SelectContent><CategorySelectItems /></SelectContent>
            </Select>
            {!d.category && <p className="mt-1 text-caption text-ink-secondary">Kategori kan settes senere, men gjør råvaren lettere å finne.</p>}
          </div>
          <div>
            <Label className="text-caption">Grunnenhet</Label>
            <Select value={d.baseUnit} onValueChange={(v) => p.onDraft({ ...d, baseUnit: v })}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CANONICAL_BASE_UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor={`${p.idPrefix}-decl`} className="text-caption">Deklarasjonsnavn (valgfritt)</Label>
          <Input id={`${p.idPrefix}-decl`} value={d.declarationName} onChange={(e) => p.onDraft({ ...d, declarationName: e.target.value })} />
        </div>
      </div>
    );
  }

  const shown = [...p.suggestions, ...p.results.filter((r) => !p.suggestions.some((s) => s.id === r.id))];
  if (p.selected && !shown.some((s) => s.id === p.selected?.id)) shown.unshift(p.selected);

  return (
    <div className="space-y-2">
      {p.suggestions.length > 0 && <p className="text-caption text-ink-secondary">Forslag fra matchemotoren — ikke bekreftet før du velger.</p>}
      {shown.length > 0 && (
        <ul className="max-h-60 space-y-1.5 overflow-y-auto">
          {shown.map((o) => {
            const active = p.selectedId === o.id;
            return (
              <li key={o.id}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => p.onSelect(o.id)}
                  className={cn("w-full rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40")}
                >
                  <span className="font-medium">{o.name}</span>
                  {o.base_unit && <span className="text-ink-secondary"> · per {o.base_unit}</span>}
                  {(o.sku || o.category) && <span className="block text-caption text-ink-secondary">{[o.sku, o.category].filter(Boolean).join(" · ")}</span>}
                  {o.why && <span className="block text-caption text-ink-secondary">Hvorfor: {o.why}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Label htmlFor={`${p.idPrefix}-search`} className="text-caption">Søk i råvareregisteret</Label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
          <Input id={`${p.idPrefix}-search`} value={p.search} onChange={(e) => p.onSearch(e.target.value)} placeholder="Navn eller varenummer" className="pl-9" />
        </div>
        {p.searching && <Loader2 className="mx-auto my-2 h-4 w-4 animate-spin text-ink-secondary" aria-label="Søker" />}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => p.onModeChange("new")}>
        <Plus className="mr-1 h-4 w-4" aria-hidden /> Opprett ny råvare
      </Button>
    </div>
  );
}
