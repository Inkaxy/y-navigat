import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Column } from "@/ravarer/ui/DataTable";
import type { RecalcBucket, RecalcRow } from "@/fakturaer/hooks/useCostRecalc";
import { fmtNum } from "@/fakturaer/lib/units";
import { paths } from "@/ravarer/lib/paths";

export const BUCKETS: { key: RecalcBucket; title: string; hint: string }[] = [
  { key: "rettes", title: "Rettes", hint: "Høy tillit — regnestykket går opp mot beløpet på fakturaen." },
  { key: "bekreft", title: "Må bekreftes", hint: "Middels tillit eller uvanlig stort avvik. Se gjennom regnestykket før du krysser av." },
  { key: "uendret", title: "Uendret", hint: "Registrert kostpris stemmer allerede med fakturaen." },
  { key: "umulig", title: "Kan ikke beregnes", hint: "Pakningsstørrelsen mangler. Fyll den inn, så løser resten seg av seg selv." },
];

export function kr(n: number | null | undefined, digits = 4) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmtNum(n, digits)} kr`;
}

function ChangeBadge({ row }: { row: RecalcRow }) {
  if (row.changePct == null) return <Badge variant="outline" className="border-app/40 bg-app/10 text-app">ny pris</Badge>;
  const up = row.changePct > 0;
  const big = Math.abs(row.changePct) >= 25;
  const cls = !big ? "border-line-subtle bg-surface-sunken text-ink-secondary" : up ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning";
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      <Badge variant="outline" className={cls}>{up ? "+" : ""}{fmtNum(row.changePct, 1)} %</Badge>
      {row.packageFactor && <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">≈ {row.packageFactor}× pakning</Badge>}
    </div>
  );
}

const CONF = { high: ["høy", "border-success/40 text-success"], medium: ["middels", "border-warning/40 text-warning"], low: ["lav", "border-destructive/40 text-destructive"] } as const;

export const RECALC_COLUMNS: Column<RecalcRow>[] = [
  {
    id: "vare", header: "Vare", sortKey: (r) => r.name,
    cell: (r) => <div><div className="font-medium text-ink-primary">{r.name}</div><div className="text-xs text-ink-secondary">{r.sku ? `${r.sku} · ` : ""}basisenhet {r.baseUnit} · {r.lineCount} fakturalinjer</div></div>,
  },
  { id: "dagens", header: "Dagens", align: "right", sortKey: (r) => r.currentPrice ?? 0, cell: (r) => <span className="text-ink-secondary">{kr(r.currentPrice)}</span> },
  { id: "foreslatt", header: "Foreslått", align: "right", sortKey: (r) => r.proposedPrice ?? 0, cell: (r) => <span className="font-semibold">{r.proposedPrice != null ? `${kr(r.proposedPrice)}/${r.baseUnit}` : "—"}</span> },
  {
    id: "endring", header: "Endring", align: "right", sortKey: (r) => r.changePct ?? 0,
    cell: (r) => r.bucket === "umulig"
      ? <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive"><AlertTriangle className="mr-1 h-3 w-3" aria-hidden />{r.needsInput === "package_size" ? "mangler pakning" : "mangler beløp"}</Badge>
      : <ChangeBadge row={r} />,
  },
  {
    id: "kilde", header: "Kilde",
    cell: (r) => <span className="text-xs text-ink-secondary">{r.invoiceId ? <Link className="text-app hover:underline" to={paths.faktura(r.invoiceId)} onClick={(e) => e.stopPropagation()}>{r.invoiceNumber ?? "faktura"}</Link> : "—"}<span className="block">{r.invoiceDate ?? ""}</span></span>,
  },
  {
    id: "regnestykke", header: "Regnestykke", hideable: true,
    cell: (r) => {
      const [label, cls] = CONF[r.confidenceLevel === "high" ? "high" : r.confidenceLevel === "medium" ? "medium" : "low"];
      return (
        <div className="max-w-md text-xs text-ink-secondary">
          <div>{r.explanation}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {r.basis && <Badge variant="outline" className="border-line-subtle">{r.basis}</Badge>}
            <Badge variant="outline" className={cls}>tillit: {label}</Badge>
          </div>
          {r.reason && <div className="mt-1 italic">{r.reason}</div>}
        </div>
      );
    },
  },
];
