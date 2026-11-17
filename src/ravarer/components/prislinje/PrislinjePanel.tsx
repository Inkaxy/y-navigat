import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCapability } from "@/lib/pendingRpc";
import { useInvoiceRights } from "@/fakturaer/hooks/useInvoiceRights";
import { AuditHistory } from "@/fakturaer/components/decisions/AuditHistory";
import { AllPricesList } from "@/ravarer/components/prices/AllPricesList";
import { useTimelineHistory } from "@/ravarer/hooks/useRmSuppliers";
import { useUserNames } from "@/ravarer/hooks/useUserNames";
import { useCorrectionLog, useHasNutrition, useOpenPurchases, type PriceHistorySettings } from "@/ravarer/hooks/usePrislinje";
import { paths } from "@/ravarer/lib/paths";
import { formatNorwegianNumber } from "@/ravarer/lib/quickFormat";
import { barsFor, readiness, READY_LABEL, type PrislinjeRow } from "@/ravarer/lib/prislinje";
import type { TimelineHistoryRow } from "@/ravarer/lib/priceTimeline";
import { cn } from "@/lib/utils";
import { PriceBars } from "./PriceBars";
import { CorrectPriceDialog } from "./CorrectPriceDialog";
import { ChangePackageDialog } from "./ChangePackageDialog";

const money = (n: number | null, unit: string) => (n == null ? "–" : `${formatNorwegianNumber(n, 2)} kr/${unit}`);
const dateNo = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "–");
const COST_STATUS: Record<string, string> = { verifisert: "verifisert", mangler: "mangler grunnlag", usikker: "usikker" };

function Card({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 rounded-2xl border border-line-subtle bg-card p-4" aria-label={title}>
      <header><h3 className="text-body font-semibold">{title}</h3>{sub && <p className="text-caption text-ink-secondary">{sub}</p>}</header>
      {children}
    </section>
  );
}

/** Én råvare hos én leverandør (B4): søyler, alle priser, endringslogg, kost, andre leverandører, klar for bruk. */
export function PrislinjePanel({ row, others, settings, onPick }: { row: PrislinjeRow; others: PrislinjeRow[]; settings: PriceHistorySettings | null; onPick: (id: string) => void }) {
  const history = useTimelineHistory(row.rawMaterialId);
  const open = useOpenPurchases(row.rawMaterialId, row.supplierId);
  const bars = useMemo(() => barsFor(history.rows, row.supplierId, row.baseUnit, open.data ?? []), [history.rows, row.supplierId, row.baseUnit, open.data]);
  const nutrition = useHasNutrition(row.rawMaterialId);
  const checks = readiness(row, nutrition);
  const { canApprove } = useInvoiceRights();
  const cap = useCapability("rm_cap_prislinje_v1");
  const log = useCorrectionLog(row.rawMaterialId, row.baseUnit);
  const names = useUserNames((log.data ?? []).map((l) => l.by));
  const [correct, setCorrect] = useState<TimelineHistoryRow | null>(null);
  const [pkgOpen, setPkgOpen] = useState(false);
  const canFix = canApprove && cap === true;
  const lastOther = (o: PrislinjeRow) => history.rows.filter((h) => h.supplier_id === o.supplierId && !h.supersededAt && !h.isLegacy && !h.isCredit).sort((a, b) => b.effective_date.localeCompare(a.effective_date))[0] ?? null;
  const fixNote = cap === false ? "Retting venter på databaseendringen for Prislinje." : !canApprove ? "Bare godkjenner eller administrator kan rette priser og pakning." : null;

  return (
    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-4 rounded-2xl border border-line-subtle bg-card p-4">
        <header>
          <h2 className="font-serif text-title">{row.rmName}</h2>
          <p className="text-caption text-ink-secondary">{row.supplierName} · pris per {row.baseUnit} per kjøp, eldste til venstre</p>
        </header>
        {history.isError ? <p role="alert" className="text-sm text-destructive">Kjøpene kunne ikke hentes.</p>
          : history.isLoading ? <p className="text-sm text-ink-secondary">Henter kjøpene …</p>
          : <PriceBars bars={bars} unit={row.baseUnit} supplierName={row.supplierName} />}
        <AllPricesList key={`${row.id}|${settings?.sinceMonths ?? ""}`} rawMaterialId={row.rawMaterialId} baseUnit={row.baseUnit} category={row.category} supplierId={row.supplierId}
          thresholdPct={settings?.deviationPct ?? null} sinceMonths={settings?.sinceMonths ?? null} onCorrect={canFix ? setCorrect : undefined} />
        {fixNote && <p className="text-caption text-ink-secondary">{fixNote}</p>}
        <section aria-label="Endringslogg" className="space-y-2">
          <h3 className="text-base font-semibold">Endringslogg</h3>
          <p className="text-caption text-ink-secondary">Rettinger og oppsett, nyeste øverst. Ingenting slettes.</p>
          {log.cap === true && (log.isError ? <p className="text-sm text-destructive">Rettingene kunne ikke hentes.</p>
            : (log.data ?? []).length > 0 && (
              <ul className="divide-y divide-line-subtle text-sm">
                {(log.data ?? []).map((l) => (
                  <li key={l.id} className="grid gap-1 py-2 sm:grid-cols-[7rem_1fr_8rem]">
                    <span className="tabular-nums text-ink-secondary">{dateNo(l.at)}</span>
                    <span><span className="font-medium">{l.summary}</span>{l.reverted && <span className="ml-2 text-caption text-ink-secondary">Angret</span>}<span className="block text-caption text-ink-secondary">{l.reason}</span></span>
                    <span className="text-caption text-ink-secondary">{names.data?.get(l.by) ?? "Bruker"}</span>
                  </li>
                ))}
              </ul>
            ))}
          <AuditHistory entityId={row.id} kind="supplier_link" />
        </section>
      </div>

      <aside className="space-y-4">
        <Card title="Gjeldende kost">
          <p className="font-serif text-title tabular-nums">{money(row.currentCost, row.baseUnit)}</p>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
            <dt className="text-ink-secondary">Status</dt><dd>{row.costStatus ? COST_STATUS[row.costStatus] ?? row.costStatus : "ukjent"}</dd>
            <dt className="text-ink-secondary">Leverandør</dt><dd>{row.supplierName}{row.isPrimary ? " (primær)" : ""}</dd>
            <dt className="text-ink-secondary">Pakning</dt><dd>{row.buPerPackage != null ? `${row.buPerPackage.toLocaleString("nb-NO")} ${row.baseUnit}${row.containerUnit ? ` per ${row.containerUnit}` : ""}${row.packageConfirmedAt ? ", bekreftet" : ", ikke bekreftet"}` : "ukjent"}</dd>
            <dt className="text-ink-secondary">Siste kjøp</dt><dd>{dateNo(row.lastInvoiceDate)}</dd>
          </dl>
          <Link className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary underline-offset-2 hover:underline" to={paths.raavare(row.rawMaterialId, { seksjon: "pris" })}>Åpne råvarekortet</Link>
        </Card>
        <Card title="Andre leverandører" sub="Siste pris for samme råvare hos andre.">
          {others.length === 0 ? <p className="text-sm text-ink-secondary">Ingen andre leverandører er koblet.</p> : (
            <ul className="divide-y divide-line-subtle text-sm">
              {others.map((o) => { const h = lastOther(o); return (
                <li key={o.id} className="py-2">
                  <button type="button" className="flex min-h-[44px] w-full items-baseline justify-between gap-2 text-left" onClick={() => onPick(o.id)}>
                    <span className="font-medium">{o.supplierName}</span>
                    <span className="tabular-nums">{h ? money(Number(h.price), row.baseUnit) : "ingen pris"}</span>
                  </button>
                  {h && <span className="text-caption text-ink-secondary">sist kjøpt {dateNo(h.effective_date)}</span>}
                </li>
              ); })}
            </ul>
          )}
        </Card>
        <Card title="Klar for bruk">
          <ul className="flex flex-wrap gap-1.5">
            {checks.map((c) => (
              <li key={c.key} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-caption font-medium",
                c.ok === true ? "border-primary/30 bg-primary/10 text-primary" : c.ok === false ? "border-warning/40 bg-warning/10 text-warning" : "border-line-subtle text-ink-secondary")}>
                {c.ok === true ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Minus className="h-3.5 w-3.5" aria-hidden />}
                {READY_LABEL[c.key]}<span className="sr-only">{c.ok === true ? " er klar" : c.ok === false ? " mangler" : " ukjent"}</span>
              </li>
            ))}
          </ul>
          <p className="text-caption text-ink-secondary">Det som mangler, rettes i varens egne seksjoner (pakning, næring, deklarasjon).</p>
        </Card>
        <Card title="Endre godkjent pakning" sub="Ingenting er låst etter godkjenning. Feil pakning retter du her; feil pris på ett kjøp retter du i prislisten.">
          <Button variant="outline" className="min-h-[44px]" disabled={!canFix} onClick={() => setPkgOpen(true)}>Rett pakning og regn om</Button>
          {fixNote && <p className="text-caption text-ink-secondary">{fixNote}</p>}
        </Card>
      </aside>
      {correct && <CorrectPriceDialog row={correct} rawMaterialId={row.rawMaterialId} unit={row.baseUnit} onClose={() => setCorrect(null)} />}
      {pkgOpen && <ChangePackageDialog row={row} onClose={() => setPkgOpen(false)} />}
    </div>
  );
}
