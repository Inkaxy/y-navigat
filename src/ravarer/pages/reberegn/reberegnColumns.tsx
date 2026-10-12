import { StatusPill } from "@/ordre/components/ui/status-pill";
import type { Column } from "@/ravarer/ui/DataTable";
import type { RecalcBucket, RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import type { UndoState } from "@/ravarer/lib/recalcLedger";

export const kr = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} kr`;

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

export const RECALC_COLUMNS: Column<RecalcRow>[] = [
  { id: "name", header: "Råvare", alwaysVisible: true, sortKey: (r) => r.name, cell: (r) => (
    <div className="min-w-0"><div className="font-medium text-ink-primary">{r.name}</div>{r.sku && <div className="text-caption text-ink-secondary">{r.sku}</div>}</div>
  ) },
  { id: "status", header: "Forslag", cell: (r) => <StatusPill label={BUCKETS[r.bucket].label} tokenVar={BUCKET_TOKEN[r.bucket]} /> },
  { id: "current", header: "Gjeldende kost", align: "right", sortKey: (r) => r.currentPrice, cell: (r) => <span className="tabular-nums">{kr(r.currentPrice)}{r.baseUnit ? ` / ${r.baseUnit}` : ""}</span> },
  { id: "proposal", header: "Foreløpig forslag nå", align: "right", sortKey: (r) => r.proposal?.costAfter ?? null, cell: (r) => (
    <span className="tabular-nums" title="Serverens forslag akkurat nå. Endelig kostpris settes av kostprisregelen ved kjøring og kan avvike.">{r.proposal ? kr(r.proposal.costAfter) : "—"}</span>
  ) },
  { id: "lines", header: "Linjer endres / ukjent / utelatt", align: "right", sortKey: (r) => r.proposal?.linesChanged ?? -1, cell: (r) => (
    r.proposal ? <span className="tabular-nums">{r.proposal.linesChanged} / {r.proposal.linesUnknown} / {r.proposal.linesExcluded}</span> : <span className="text-ink-secondary">{r.failure ?? "—"}</span>
  ) },
];
