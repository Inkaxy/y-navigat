import { Card } from "@/components/ui/card";
import { AlertTriangle, BarChart3, Loader2 } from "lucide-react";
import { useRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { formatNok, formatNumber, formatDate } from "@/ravarer/lib/constants";

interface Props {
  rawMaterialId: string;
  baseUnit: string;
}

export function PurchaseStatsCard({ rawMaterialId, baseUnit }: Props) {
  const { data, isLoading } = useRawMaterialPurchaseStats(rawMaterialId);

  if (isLoading) {
    return (
      <Card className="p-5 flex items-center gap-2 text-sm text-ink-secondary">
        <Loader2 className="h-4 w-4 animate-spin" /> Laster innkjøpsstatistikk…
      </Card>
    );
  }

  if (!data || (data.invoice_count_12m === 0 && data.invoice_count_30d === 0 && data.invoice_count_90d === 0)) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold mb-1">
          <BarChart3 className="h-4 w-4 text-ink-secondary" />
          Innkjøpsstatistikk
        </div>
        <p className="text-sm text-ink-secondary">Ingen kjøpsdata ennå. Statistikk vises etter første godkjente faktura.</p>
      </Card>
    );
  }

  const cells: { label: string; qty: number; cost: number; count: number }[] = [
    { label: "Siste 12 mnd", qty: data.quantity_12m, cost: data.cost_12m, count: data.invoice_count_12m },
    { label: "Siste 90 dager", qty: data.quantity_90d, cost: data.cost_90d, count: data.invoice_count_90d },
    { label: "Siste 30 dager", qty: data.quantity_30d, cost: data.cost_30d, count: data.invoice_count_30d },
  ];

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-ink-secondary" />
          <h3 className="text-base font-semibold">Innkjøp basert på godkjente fakturaer</h3>
        </div>
        {data.has_package_size_warning && (
          <div className="flex items-center gap-1.5 text-xs text-warning" title="Pakningsstørrelse mangler på én eller flere leverandører — mengde kan være feil">
            <AlertTriangle className="h-3.5 w-3.5" /> Pakn.størrelse usikker
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        {cells.map((c) => (
          <div key={c.label} className="rounded-xl border border-line-subtle bg-surface-base p-3">
            <div className="text-xs text-ink-secondary">{c.label}</div>
            <div className="mt-1 text-lg font-semibold tracking-tight" style={{ letterSpacing: "-0.02em" }}>
              {formatNumber(c.qty, 0)} <span className="text-xs font-normal text-ink-secondary">{baseUnit}</span>
            </div>
            <div className="text-sm text-ink-primary">{formatNok(c.cost)}</div>
            <div className="mt-1 text-xs text-ink-secondary">{c.count} faktura{c.count === 1 ? "" : "er"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-secondary">Snitt månedsvolum</span>
          <span className="font-medium">{data.avg_monthly_volume != null ? `${formatNumber(data.avg_monthly_volume, 0)} ${baseUnit}` : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-secondary">Snittpris (vektet 12 mnd)</span>
          <span className="font-medium">{data.avg_price_per_base_unit_12m != null ? `${formatNok(data.avg_price_per_base_unit_12m)}/${baseUnit}` : "—"}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-secondary">Sist fakturert</span>
          <span className="font-medium">{formatDate(data.last_invoice_date)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-ink-secondary">Leverandører siste 12 mnd</span>
          <span className="font-medium">{data.supplier_count_12m}</span>
        </div>
      </div>
    </Card>
  );
}
