import { useSearchParams } from "react-router-dom";
import { QueryState } from "@/components/common/QueryState";
import { usePrislinjeRows, usePriceHistorySettings } from "@/ravarer/hooks/usePrislinje";
import { cn } from "@/lib/utils";
import { PrislinjePanel } from "./PrislinjePanel";

/**
 * Prishistorikk per vare og leverandør (flyttet fra Prislinje, opprydding demo D): søyler, alle priser,
 * «Rett pris» for ett kjøp og «Endre godkjent pakning». Valgt leverandør ligger i `?prislinje=`.
 */
export function RawMaterialPriceLines({ rawMaterialId }: { rawMaterialId: string }) {
  const [sp, setSp] = useSearchParams();
  const rows = usePrislinjeRows(rawMaterialId);
  const settings = usePriceHistorySettings();
  const list = [...(rows.data ?? [])].sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.supplierName.localeCompare(b.supplierName, "nb"));
  const wanted = sp.get("prislinje");
  const sel = list.find((r) => r.id === wanted) ?? list[0] ?? null;
  const pick = (id: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set("prislinje", id); return n; }, { replace: true });
  return (
    <section id="prishistorikk" aria-labelledby="prishistorikk-h" className="space-y-3">
      <h2 id="prishistorikk-h" className="font-serif text-title">Prishistorikk per leverandør</h2>
      <QueryState isLoading={rows.isLoading} isError={rows.isError} error={rows.error} scope="ravarer:vare:prishistorikk" onRetry={() => void rows.refetch()}
        isEmpty={list.length === 0} emptyTitle="Varen er ikke koblet til en leverandør ennå">
        {list.length > 1 && (
          <div role="tablist" aria-label="Leverandør" className="flex flex-wrap gap-2">
            {list.map((r) => (
              <button key={r.id} type="button" role="tab" aria-selected={sel?.id === r.id} onClick={() => pick(r.id)}
                className={cn("min-h-[44px] rounded-full border px-3 text-sm", sel?.id === r.id ? "border-primary bg-primary/10 font-medium text-primary" : "border-line-subtle hover:bg-muted/50")}>
                {r.supplierName}{r.isPrimary ? " · hovedleverandør" : ""}
              </button>
            ))}
          </div>
        )}
        {sel && (
          <PrislinjePanel key={sel.id} row={sel} others={list.filter((r) => r.id !== sel.id)}
            settings={settings.cap === true ? settings.data ?? null : null} onPick={pick} />
        )}
        {settings.cap === false && <p className="text-caption text-ink-secondary">«Rett pris», «Endre godkjent pakning» og endringsloggen venter på databaseendringen for Prislinje. Alt annet virker.</p>}
      </QueryState>
    </section>
  );
}
