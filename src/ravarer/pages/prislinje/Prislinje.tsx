import { useEffect, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { QueryState } from "@/components/common/QueryState";
import { ModulePage } from "@/ravarer/ui/ModulePage";
import { RAVARER_EYEBROW } from "@/ravarer/pages/hub/hubTabs";
import { useRavarerAccessLevel } from "@/ravarer/hooks/useRavarerAccessLevel";
import { usePrislinjeRows, usePriceHistorySettings } from "@/ravarer/hooks/usePrislinje";
import { filterPrislinje } from "@/ravarer/lib/prislinje";
import { useIsWide } from "../beslutninger/useIsWide";
import { PrislinjePanel } from "./PrislinjePanel";
import { PriceHistorySettings } from "./PriceHistorySettings";
import { cn } from "@/lib/utils";

const LIST_MAX = 300;

/** Råvarer › Prislinje (variant B, B4): én linje per råvare og leverandør. Fakturaene er bevisene bak hvert punkt. */
export default function Prislinje() {
  const [sp, setSp] = useSearchParams();
  const wide = useIsWide();
  const q = sp.get("q") ?? "";
  const valgt = sp.get("valgt");
  const rows = usePrislinjeRows();
  const settings = usePriceHistorySettings();
  const level = useRavarerAccessLevel().data ?? "none";
  const list = useMemo(() => filterPrislinje(rows.data ?? [], q), [rows.data, q]);
  const sel = (rows.data ?? []).find((r) => r.id === valgt) ?? null;
  const set = (patch: Record<string, string | null>, push = false) => setSp((prev) => {
    const n = new URLSearchParams(prev);
    for (const [k, v] of Object.entries(patch)) { if (v) n.set(k, v); else n.delete(k); }
    return n;
  }, { replace: !push });
  useEffect(() => { if (wide && !valgt && list.length > 0) set({ valgt: list[0].id }); }, [wide, valgt, list.length]); // eslint-disable-line react-hooks/exhaustive-deps -- bare ved nye data
  const others = sel ? (rows.data ?? []).filter((r) => r.rawMaterialId === sel.rawMaterialId && r.id !== sel.id) : [];
  const showList = wide || !valgt;
  const showPanel = wide || !!valgt;

  return (
    <ModulePage eyebrow={RAVARER_EYEBROW} title="Prislinje" compact subtitle="Én linje per råvare og leverandør. Fakturaene er bevisene bak hvert punkt.">
      <div className="space-y-4 px-page pb-8">
        {settings.cap === true && settings.data && (
          <PriceHistorySettings key={`${settings.data.deviationPct ?? ""}|${settings.data.sinceMonths ?? ""}`} value={settings.data} canEdit={level === "admin"} />
        )}
        {settings.cap === false && <p className="text-caption text-ink-secondary">«Rett pris», «Endre godkjent pakning», endringsloggen og egen avviksgrense venter på databaseendringen for Prislinje. Alt annet virker.</p>}
        <QueryState isLoading={rows.isLoading} isError={rows.isError} error={rows.error} scope="ravarer:prislinje" onRetry={() => void rows.refetch()}
          isEmpty={(rows.data ?? []).length === 0} emptyTitle="Ingen råvarer er koblet til leverandører ennå">
          <div className="grid gap-4 xl:grid-cols-[minmax(18rem,22rem)_1fr]">
            {showList && (
              <div className="space-y-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" aria-hidden />
                  <Input aria-label="Søk etter råvare eller leverandør" placeholder="Søk råvare eller leverandør" className="h-11 pl-9" value={q} onChange={(e) => set({ q: e.target.value || null })} />
                </div>
                <p className="text-caption text-ink-secondary">{list.length.toLocaleString("nb-NO")} linjer{list.length > LIST_MAX ? ` – viser de ${LIST_MAX} første, søk for å snevre inn` : ""}</p>
                <ul className="max-h-[70dvh] space-y-1 overflow-auto pr-1" aria-label="Råvare og leverandør">
                  {list.slice(0, LIST_MAX).map((r) => (
                    <li key={r.id}>
                      <button type="button" aria-current={r.id === valgt ? "true" : undefined} onClick={() => set({ valgt: r.id }, true)}
                        className={cn("flex min-h-[44px] w-full flex-col rounded-lg border px-3 py-2 text-left", r.id === valgt ? "border-primary bg-primary/5" : "border-line-subtle bg-card hover:bg-muted/40")}>
                        <span className="text-sm font-medium">{r.rmName}</span>
                        <span className="text-caption text-ink-secondary">{r.supplierName}{r.isPrimary ? " · primær" : ""}{r.currentCost != null ? ` · ${r.currentCost.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/${r.baseUnit}` : ""}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {showPanel && (
              <div className="min-w-0">
                {!wide && <Button variant="ghost" className="mb-2 min-h-[44px] gap-1" onClick={() => set({ valgt: null })}><ChevronLeft className="h-4 w-4" aria-hidden />Alle linjer</Button>}
                {sel ? <PrislinjePanel key={sel.id} row={sel} others={others} settings={settings.cap === true ? settings.data ?? null : null} onPick={(id) => set({ valgt: id }, true)} />
                  : <p className="text-body text-ink-secondary">{valgt ? "Fant ikke linjen. Velg en annen i listen." : "Velg en råvare i listen."}</p>}
              </div>
            )}
          </div>
        </QueryState>
      </div>
    </ModulePage>
  );
}
