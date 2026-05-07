import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Check, Pause, X, TrendingUp, Loader2 } from "lucide-react";
import { useRawMaterialPurchaseStats } from "@/ravarer/hooks/usePurchaseStats";
import { useRawMaterialSuppliers } from "@/ravarer/hooks/useRmSuppliers";
import { formatNok, formatNumber } from "@/ravarer/lib/constants";
import type { NegotiationItemRow } from "@/ravarer/hooks/useNegotiations";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

interface Props {
  item: NegotiationItemRow;
  rawMaterial: RawMaterialRow | undefined;
  supplierId: string;
  facilitatorId: string | null;
  onSave: (patch: Record<string, any>, eventType: string, eventData?: any, note?: string | null) => Promise<void>;
  saving?: boolean;
}

export function LiveItemCard({ item, rawMaterial, supplierId, facilitatorId, onSave, saving }: Props) {
  const { data: stats } = useRawMaterialPurchaseStats(item.raw_material_id);
  const { data: rmSuppliers = [] } = useRawMaterialSuppliers(item.raw_material_id);

  const baseUnit = rawMaterial?.base_unit ?? "kg";
  const currentSupplier = rmSuppliers.find((s) => s.supplier_id === supplierId);
  const existingAgreedPrice = currentSupplier?.agreed_price_per_base_unit ?? null;
  const avgPrice = stats?.avg_price_per_base_unit_12m ?? null;
  const suggested = avgPrice != null ? Number((avgPrice * 0.95).toFixed(2)) : null;
  const yearlyVol = stats?.quantity_12m ?? null;
  const yearlySaving =
    suggested != null && avgPrice != null && yearlyVol
      ? (avgPrice - suggested) * yearlyVol
      : null;

  // Form state seeded from item
  const [price, setPrice] = useState<string>(item.live_agreed_price?.toString() ?? "");
  const [priceUnit, setPriceUnit] = useState<string>(item.live_agreed_price_unit ?? `kr/${baseUnit}`);
  const [pkgSize, setPkgSize] = useState<string>(item.live_agreed_package_size?.toString() ?? "");
  const [pkgUnit, setPkgUnit] = useState<string>(item.live_agreed_package_unit ?? baseUnit);
  const [months, setMonths] = useState<string>(item.live_agreed_contract_months?.toString() ?? "");
  const [minVol, setMinVol] = useState<string>(item.live_agreed_min_volume?.toString() ?? "");
  const [pay, setPay] = useState<string>(item.live_agreed_payment_terms_days?.toString() ?? "");
  const [note, setNote] = useState<string>(item.live_notes ?? "");

  useEffect(() => {
    // re-seed when item id changes (different active item)
    setPrice(item.live_agreed_price?.toString() ?? "");
    setPriceUnit(item.live_agreed_price_unit ?? `kr/${baseUnit}`);
    setPkgSize(item.live_agreed_package_size?.toString() ?? "");
    setPkgUnit(item.live_agreed_package_unit ?? baseUnit);
    setMonths(item.live_agreed_contract_months?.toString() ?? "");
    setMinVol(item.live_agreed_min_volume?.toString() ?? "");
    setPay(item.live_agreed_payment_terms_days?.toString() ?? "");
    setNote(item.live_notes ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  function buildPatch() {
    const numOrNull = (s: string) => (s.trim() === "" ? null : Number(s));
    const priceNum = numOrNull(price);
    const pkgSizeNum = numOrNull(pkgSize);
    // simple per-base-unit calc: assume priceUnit matches base
    let perBase: number | null = null;
    if (priceNum != null) {
      // If pkgSize given and pkgUnit equals baseUnit but priceUnit kr/<pkgUnit-of-package>, divide
      if (pkgSizeNum && priceUnit.endsWith(`/pakke`)) perBase = priceNum / pkgSizeNum;
      else perBase = priceNum;
    }
    return {
      live_agreed_price: priceNum,
      live_agreed_price_unit: priceUnit || null,
      live_agreed_package_size: pkgSizeNum,
      live_agreed_package_unit: pkgUnit || null,
      live_agreed_price_per_base_unit: perBase,
      live_agreed_contract_months: numOrNull(months),
      live_agreed_min_volume: numOrNull(minVol),
      live_agreed_min_volume_unit: minVol ? baseUnit : null,
      live_agreed_payment_terms_days: numOrNull(pay),
      live_notes: note || null,
    };
  }

  async function setStatus(status: "tentatively_agreed" | "parked" | "declined") {
    const patch: Record<string, any> = {
      ...buildPatch(),
      live_status: status,
    };
    if (status === "tentatively_agreed") {
      patch.live_agreed_at = new Date().toISOString();
      patch.live_agreed_by = facilitatorId;
    }
    const eventType =
      status === "tentatively_agreed" ? "price_agreed" : status === "parked" ? "item_parked" : "item_declined";
    await onSave(patch, eventType, { price: patch.live_agreed_price, status }, note || null);
  }

  return (
    <Card className="space-y-5 p-5">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
          I diskusjon
        </Badge>
        {existingAgreedPrice != null && (
          <span className="text-xs text-ink-muted">
            Nåværende avtale: {formatNok(existingAgreedPrice)}/{baseUnit}
          </span>
        )}
      </div>

      <h2 className="text-2xl font-semibold tracking-tight">{rawMaterial?.name ?? "—"}</h2>

      {/* Faktagrunnlag */}
      <div className="grid gap-3 rounded-lg bg-surface-muted/40 p-4 text-sm sm:grid-cols-2">
        <Stat label="Volum 12 mnd" value={stats ? `${formatNumber(stats.quantity_12m)} ${baseUnit}` : "—"} />
        <Stat label="Total kostnad 12 mnd" value={stats ? formatNok(stats.cost_12m) : "—"} />
        <Stat label="Snittpris 12 mnd" value={avgPrice != null ? `${formatNok(avgPrice)}/${baseUnit}` : "—"} />
        <Stat label="Avtalt pris i dag" value={existingAgreedPrice != null ? `${formatNok(existingAgreedPrice)}/${baseUnit}` : "—"} />
      </div>

      {suggested != null && yearlySaving != null && (
        <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2 text-sm text-success">
          <TrendingUp className="h-4 w-4" />
          Forslag: {formatNok(suggested)}/{baseUnit} = {formatNok(yearlySaving)}/år besparelse
        </div>
      )}

      {/* Avtalt pris-felt */}
      <div className="space-y-3 border-t border-line-subtle pt-4">
        <p className="text-xs uppercase tracking-wide text-ink-secondary">Avtalt pris</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Pris">
            <div className="flex gap-2">
              <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" inputMode="decimal" />
              <Input value={priceUnit} onChange={(e) => setPriceUnit(e.target.value)} className="w-28" />
            </div>
          </Field>
          <Field label="Pakning">
            <div className="flex gap-2">
              <Input value={pkgSize} onChange={(e) => setPkgSize(e.target.value)} placeholder="0" inputMode="decimal" />
              <Input value={pkgUnit} onChange={(e) => setPkgUnit(e.target.value)} className="w-28" />
            </div>
          </Field>
          <Field label="Avtale-lengde (mnd)">
            <Input value={months} onChange={(e) => setMonths(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={`Min ordre (${baseUnit})`}>
            <Input value={minVol} onChange={(e) => setMinVol(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label="Betaling (dager)">
            <Input value={pay} onChange={(e) => setPay(e.target.value)} inputMode="numeric" />
          </Field>
        </div>

        <div>
          <Label className="text-xs">Notat fra møtet</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Notater…" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button onClick={() => setStatus("tentatively_agreed")} disabled={saving} className="flex-1">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
          Avtalt
        </Button>
        <Button variant="outline" onClick={() => setStatus("parked")} disabled={saving}>
          <Pause className="mr-2 h-4 w-4" /> Park
        </Button>
        <Button variant="outline" onClick={() => setStatus("declined")} disabled={saving}>
          <X className="mr-2 h-4 w-4" /> Avslå
        </Button>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-secondary">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums">{value}</p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
