import { StatusPill } from "@/ordre/components/ui/status-pill";
import { RecalcDrilldown } from "@/ravarer/pages/reberegn/reberegnColumns";
import type { Column } from "@/ravarer/ui/DataTable";
import type { RecalcBucket, RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import type { UndoState } from "@/ravarer/lib/recalcLedger";
import { DetailButton } from "@/ravarer/pages/reberegn/SingleRecalcDetail";

export const kr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kr`;

/** Endring = serverens egne før/etter-tall i forslaget; mangler ett av dem, vises ingen endring. */
export function costChange(before: number | null | undefined, after: number | null | undefined): number | null {
  return before == null || after == null || !Number.isFinite(before) || !Number.isFinite(after) ? null : after - before;
}
const signedKr = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${kr(Math.abs(v))}`);

export const BUCKETS: Record<RecalcBucket, { label: string; help: string }> = {
  endres: { label: "Linjer endres", help: "Serveren foreslår å rette mengde/pris på én eller flere fakturalinjer." },
  usikker: { label: "Usikre linjer", help: "Ingen linjer endres, men noen linjer mangler sikker mengde i grunnenhet." },
  uendret: { label: "Ingen linjer endres", help: "Serveren fant ingen linjer å rette. Det sier ikke noe sikkert om kostprisen." },
  feilet: { label: "Kunne ikke vurderes", help: "Serveren kunne ikke vurdere varen." },
};

export const BUCKET_TOKEN: Record<RecalcBucket, string> = {
  endres: "--state-info", usikker: "--state-warning", uendret: "--state-neutral", feilet: "--state-danger",
};

export const UNDO_LABEL: Record<UndoState, { label: string; token: string }> = {
  kan_angres: { label: "Utført", token: "--state-success" },
  angret: { label: "Angret", token: "--state-neutral" },
  angring_feilet: { label: "Angring feilet", token: "--state-danger" },
  uavklart: { label: "Uavklart", token: "--state-warning" },
};

/** Kolonner; `onDetail` åpner serverens enkeltregnestykke for nøyaktig radens rawMaterialId (bare ved klikk). */
export const recalcColumns = (onDetail?: (r: RecalcRow) => void): Column<RecalcRow>[] => [
  { id: "name", header: "Råvare", alwaysVisible: true, sortKey: (r) => r.name, cell: (r) => (
    <div className="min-w-0"><div className="font-medium text-ink-primary">{r.name}</div>{r.sku && <div className="text-caption text-ink-secondary">{r.sku}</div>}</div>
  ) },
  { id: "status", header: "Forslag", cell: (r) => <StatusPill label={BUCKETS[r.bucket].label} tokenVar={BUCKET_TOKEN[r.bucket]} /> },
  { id: "current", header: "Gjeldende kost", align: "right", sortKey: (r) => r.currentPrice, cell: (r) => <span className="tabular-nums">{kr(r.currentPrice)}{r.baseUnit ? ` / ${r.baseUnit}` : ""}</span> },
  { id: "proposal", header: "Foreløpig forslag nå", align: "right", sortKey: (r) => r.proposal?.costAfter ?? null, cell: (r) => (
    <span className="tabular-nums" title="Serverens forslag akkurat nå. Endelig kostpris settes av kostprisregelen ved kjøring og kan avvike.">{r.proposal ? kr(r.proposal.costAfter) : "—"}</span>
  ) },
  { id: "change", header: "Endring i forslaget", align: "right", sortKey: (r) => costChange(r.proposal?.costBefore, r.proposal?.costAfter), cell: (r) => (
    <span className="tabular-nums" title="Forslagets etter minus før, begge fra serverens prøvekjøring.">{signedKr(costChange(r.proposal?.costBefore, r.proposal?.costAfter))}</span>
  ) },
  { id: "lines", header: "Linjer endres / ukjent / utelatt", align: "right", sortKey: (r) => r.proposal?.linesChanged ?? -1, cell: (r) => (
    r.proposal ? <span className="tabular-nums">{r.proposal.linesChanged} / {r.proposal.linesUnknown} / {r.proposal.linesExcluded}</span> : <span className="text-ink-secondary">{r.failure ?? "—"}</span>
  ) },
  { id: "kilde", header: "Kilde og pakning", cell: (r) => (
    <span className="inline-flex flex-wrap gap-x-3">
      {onDetail && <DetailButton name={r.name} onClick={() => onDetail(r)} />}
      <RecalcDrilldown rawMaterialId={r.rawMaterialId} name={r.name} />
    </span>
  ) },
];
export const RECALC_COLUMNS: Column<RecalcRow>[] = recalcColumns();
