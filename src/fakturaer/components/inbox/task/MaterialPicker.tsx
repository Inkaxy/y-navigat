import { useState } from "react";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LineMatchForm } from "@/fakturaer/hooks/useLineMatchForm";
import { cn } from "@/lib/utils";

interface Option {
  id: string;
  name: string;
  baseUnit: string | null;
  why: string | null;
  detail: string | null;
}

/** Kort råvarevalg: de mest relevante forslagene + søk. Tekniske detaljer er sekundære. */
export function MaterialPicker({ form, lineId }: { form: LineMatchForm; lineId: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const suggested: Option[] = form.suggestions.slice(0, 3).map((s) => ({
    id: s.raw_material_id,
    name: s.raw_material?.name ?? "Ukjent råvare",
    baseUnit: s.raw_material?.base_unit ?? null,
    why: s.match_reason,
    detail: `${s.raw_material?.sku ?? "uten varenr."} · ${Math.round((s.confidence ?? 0) * 100)} % treff`,
  }));
  const found: Option[] = form.rmResults
    .filter((r) => !suggested.some((s) => s.id === r.id))
    .map((r) => ({ id: r.id, name: r.name, baseUnit: r.base_unit, why: null, detail: r.sku ?? r.category ?? null }));

  const renderOption = (o: Option) => {
    const active = form.selectedRmId === o.id;
    return (
      <li key={o.id}>
        <button
          type="button"
          aria-pressed={active}
          onClick={() => form.setSelectedRmId(o.id)}
          className={cn(
            "w-full rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "border-primary bg-primary/5" : "border-line-subtle hover:bg-muted/40",
          )}
        >
          <span className="font-medium">{o.name}</span>
          {o.baseUnit && <span className="text-ink-secondary"> · per {o.baseUnit}</span>}
          {o.why && <span className="block text-caption text-ink-secondary">Hvorfor: {o.why}</span>}
          {showDetails && o.detail && <span className="block text-caption text-ink-secondary">{o.detail}</span>}
        </button>
      </li>
    );
  };

  return (
    <div className="space-y-2">
      {suggested.length > 0 && (
        <>
          <p className="text-caption text-ink-secondary">Forslag fra matchemotoren — ikke bekreftet før du velger.</p>
          <ul className="space-y-1.5">{suggested.map(renderOption)}</ul>
        </>
      )}
      <div>
        <Label htmlFor={`rm-search-${lineId}`} className="text-caption">
          Søk i råvareregisteret
        </Label>
        <div className="relative mt-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
          <Input
            id={`rm-search-${lineId}`}
            value={form.search}
            onChange={(e) => form.setSearch(e.target.value)}
            placeholder="Navn eller varenummer"
            className="pl-9"
          />
        </div>
        {form.searching && form.search.length > 1 && <Loader2 className="mx-auto my-2 h-4 w-4 animate-spin text-ink-secondary" />}
        {found.length > 0 && <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">{found.map(renderOption)}</ul>}
      </div>
      <button type="button" className="text-caption text-ink-secondary underline underline-offset-2" onClick={() => setShowDetails((v) => !v)}>
        {showDetails ? "Skjul varenummer og treffprosent" : "Vis varenummer og treffprosent"}
      </button>
    </div>
  );
}
