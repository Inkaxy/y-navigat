import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatNok } from "@/ravarer/lib/constants";
import type { MergeFacts } from "@/ravarer/lib/merge/facts";
import { conversionFor, costInKeepUnit, type Conversion } from "@/ravarer/lib/merge/units";

/** Omregning per vare som slås sammen. Ulik grunnenhet krever «1 stk = x g» før sammenslåing; uten gyldig omregning er knappen sperret. */
export function MergeConversion({ keep, dups, grams, onGrams, disabled }: {
  keep: MergeFacts; dups: MergeFacts[]; grams: Record<string, string>; onGrams: (id: string, v: string) => void; disabled: boolean;
}) {
  const rows = dups.map((d) => ({ d, c: conversionFor(keep.base_unit, d.base_unit, grams[d.id] ?? "") }));
  if (rows.every((r) => r.c.kind === "same")) return null;
  return (
    <div className="space-y-3 rounded-xl border border-line-subtle bg-muted/30 p-3">
      <p className="text-body font-semibold">Ulik grunnenhet</p>
      {rows.map(({ d, c }) => <Row key={d.id} keep={keep} dup={d} c={c} value={grams[d.id] ?? ""} onChange={(v) => onGrams(d.id, v)} disabled={disabled} />)}
    </div>
  );
}

function Row({ keep, dup, c, value, onChange, disabled }: { keep: MergeFacts; dup: MergeFacts; c: Conversion; value: string; onChange: (v: string) => void; disabled: boolean }) {
  if (c.kind === "same") return null;
  if (c.kind === "impossible") {
    return <p role="alert" className="text-caption text-destructive">«{dup.name}» er i {dup.base_unit} og «{keep.name}» i {keep.base_unit}. Det kan ikke regnes om, så varene kan ikke slås sammen.</p>;
  }
  const factor = c.factor;
  const after = costInKeepUnit(dup.cost, factor);
  const id = `merge-gpp-${dup.id}`;
  return (
    <div className="space-y-1">
      <p className="text-caption">«{dup.name}» ({dup.base_unit}) regnes om til {keep.base_unit}.</p>
      {c.kind === "weight" && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id} className="text-body">1 stk =</Label>
          <Input id={id} inputMode="decimal" className="min-h-[44px] w-28" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
            aria-invalid={!!c.error} aria-describedby={`${id}-help`} />
          <span className="text-body">g</span>
        </div>
      )}
      <p id={`${id}-help`} className={c.kind === "weight" && (c.error || c.factor == null) ? "text-caption text-destructive" : "text-caption text-ink-secondary"}>
        {c.kind === "weight" && c.error ? c.error
          : factor == null ? "Skriv hvor mye 1 stk veier. Uten det kan varene ikke slås sammen."
          : `Kostpris før: ${dup.cost == null ? "mangler" : `${formatNok(dup.cost)}/${dup.base_unit}`} · etter: ${after == null ? "mangler" : `${formatNok(after)}/${keep.base_unit}`}. Mengder og priser på fakturalinjer, oppskrifter og lager regnes om likt.`}
      </p>
    </div>
  );
}
