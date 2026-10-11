import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { paths } from "@/ravarer/lib/paths";
import type { DataQualityCounts, SupplierItemCounts } from "@/ravarer/lib/workRpcTypes";

export type DataQualityViewProps = {
  dq: DataQualityCounts | null;
  supplier: SupplierItemCounts | null;
  stockBelowMin: number;
  loading?: boolean;
};

type Row = { label: string; ok: number; total: number; to: string };

function pct(ok: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round(Math.max(0, Math.min(100, (ok / total) * 100)));
}

function Bar({ ok, total }: { ok: number; total: number }) {
  const p = pct(ok, total);
  const tone = p >= 95 ? "bg-success" : p >= 75 ? "bg-primary" : "bg-destructive";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div className={`h-full ${tone}`} style={{ width: `${p}%` }} />
    </div>
  );
}

export function DataQualityView({ dq, stockBelowMin, loading }: DataQualityViewProps) {
  if (loading || !dq) {
    return (
      <Card id="datakvalitet" className="space-y-3 p-5">
        <h2 className="font-display text-xl">Datakvalitet</h2>
        <div className="h-20 animate-pulse rounded-md bg-muted/50" />
      </Card>
    );
  }
  const active = Math.max(1, dq.active_items);
  const rows: Row[] = [
    { label: "Pakning bekreftet", ok: active - dq.missing_package - dq.unconfirmed_package, total: active, to: paths.pakninger() },
    { label: "Deklarasjonsnavn", ok: active - dq.missing_declaration, total: active, to: paths.deklarasjonsnavn() },
    { label: "Næringsdata", ok: active - dq.missing_nutrition, total: active, to: paths.naering() },
    { label: "Stabil pris", ok: active - dq.unstable_price, total: active, to: paths.pakninger({ filter: "ustabil_pris" }) },
    { label: "Datablad bekreftet", ok: active - dq.datasheet_changes, total: active, to: paths.databladEndringer() },
    { label: "Over minimumslager", ok: Math.max(0, active - stockBelowMin), total: active, to: paths.lager() },
  ];

  return (
    <Card id="datakvalitet" className="space-y-4 p-5">
      <div>
        <h2 className="font-display text-xl">Datakvalitet</h2>
        <p className="text-caption text-ink-secondary">Hvor godt stelt er varedataene?</p>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.label} className="space-y-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <Link to={r.to} className="font-medium hover:underline">{r.label}</Link>
              <span className="tabular-nums text-caption text-ink-secondary">{r.ok} av {r.total} · {pct(r.ok, r.total)} %</span>
            </div>
            <Bar ok={r.ok} total={r.total} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
