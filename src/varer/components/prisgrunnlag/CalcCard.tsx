import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { nKr, nNum, parseNum } from "@/varer/lib/calcFormat";
import { documentationText, marginFigures, type FactorChange } from "@/varer/lib/prisgrunnlag";
import type { ProductView } from "@/varer/lib/prisgrunnlagView";
import { RecipePackagingSection } from "@/varer/components/recipes/detail/RecipePackagingSection";

interface Props {
  view: ProductView;
  changes: ReadonlyMap<string, FactorChange>;
  periodLabel: string;
  onLevel: (priceListId: string) => void;
  legalEntityId: string | null;
  canWrite: boolean;
}

const pct = (n: number | null | undefined) => (n == null ? "–" : `${nNum(n, 1)} %`);

/** Kalkylekort: råvarer, emballasje, arbeid og drift, selvkost, Brutto og DG2, «hva om»-pris og dokumentasjon. */
export function CalcCard({ view: v, changes, periodLabel, onLevel, legalEntityId, canWrite }: Props) {
  const price = v.level?.price ?? null;
  const [whatIf, setWhatIf] = useState("");
  useEffect(() => { setWhatIf(v.needed != null && price != null && v.needed > price ? nNum(v.needed, 2) : ""); }, [v.productId, v.level?.price_list_id, v.needed, price]);
  const newPrice = parseNum(whatIf);
  const next = v.parts && newPrice != null && newPrice > 0 ? marginFigures(newPrice, v.parts, v.packIn) : null;
  const text = useMemo(() => v.now ? documentationText({
    productName: v.name, listName: v.level?.name ?? "prisliste", periodLabel, drivers: v.drivers, changes,
    priceNow: price, newPrice: next ? newPrice : null, now: v.now, next,
  }) : "", [v, changes, periodLabel, price, newPrice, next]);

  if (!v.parts || !v.now) {
    return <section className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">Kalkyle for {v.name}: mangler kostgrunnlag.</section>;
  }
  const p = v.parts;
  return (
    <section aria-labelledby="kalkyle-tittel" className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-2">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="kalkyle-tittel" className="mr-auto text-sm font-semibold">Kalkyle for {v.name}</h2>
          {v.levels.filter((l) => l.price != null).map((l) => (
            <Button key={l.price_list_id} size="sm" variant={l.price_list_id === v.level?.price_list_id ? "default" : "outline"} className="h-8"
              aria-pressed={l.price_list_id === v.level?.price_list_id} onClick={() => onLevel(l.price_list_id)}>{l.name ?? l.code}</Button>
          ))}
        </div>
        <dl className="space-y-1 text-sm">
          <Row k="Råvarer" v={nKr(p.raw)} />
          <Row k={`Emballasje${v.packIn ? "" : " (utenfor marginene)"}`} v={nKr(p.pack)} />
          <Row k="Varekost" v={nKr(v.now.varekost)} strong />
          <Row k="Arbeid og drift" v={nKr(p.labor + p.energy)} />
          <Row k="Selvkost" v={nKr(v.now.selvkost)} strong />
          <Row k={`Brutto ved ${price != null ? nKr(price) : "ingen pris"}`} v={pct(v.now.bruttoPct)} />
          <Row k="DG2" v={pct(v.now.dg2Pct)} />
          {v.level?.target_brutto_pct != null && <Row k="Mål Brutto / DG2" v={`${pct(v.level.target_brutto_pct)} / ${pct(v.level.target_dg2_pct)}`} />}
        </dl>
        {!v.packInFromServer && p.pack > 0 && (
          <p className="text-xs text-muted-foreground">
            Her teller emballasjen i Brutto og DG2. Lønnsomhet-siden holder den fortsatt utenfor til databaseendringen «Prisgrunnlag» er kjørt.
          </p>
        )}
        {v.recipeId && (
          <RecipePackagingSection recipeId={v.recipeId} legalEntityId={legalEntityId} unitsPerBatch={v.unitsPerBatch} canWrite={canWrite} />
        )}
      </div>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Dokumentasjon som følger prisrunden</h3>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Hva om prisen blir</span>
          <Input value={whatIf} onChange={(e) => setWhatIf(e.target.value)} inputMode="decimal" className="h-9 w-28" aria-label="Ny pris eks. mva" />
          <span className="text-muted-foreground">kr</span>
        </label>
        {next && (
          <dl className="grid grid-cols-3 gap-2 text-sm">
            <Tile k="Brutto" v={pct(next.bruttoPct)} />
            <Tile k="DG2" v={pct(next.dg2Pct)} />
            <Tile k="Prisendring" v={price ? `${newPrice! >= price ? "+" : ""}${nNum((newPrice! / price - 1) * 100, 1)} %` : "–"} />
          </dl>
        )}
        <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm">{text}</p>
        <Button size="sm" variant="outline" onClick={() => { void navigator.clipboard.writeText(text).then(() => toast.success("Teksten er kopiert"), () => toast.error("Kunne ikke kopiere")); }}>
          <Copy className="mr-1.5 h-4 w-4" />Kopier tekst
        </Button>
      </div>
    </section>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{v}</dd></div>;
}
function Tile({ k, v }: { k: string; v: string }) {
  return <div className="rounded-md border border-border p-2"><dt className="text-xs text-muted-foreground">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>;
}
