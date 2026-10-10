import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";
import { useRawMaterialSuppliers } from "@/ravarer/hooks/useRmSuppliers";
import { useSuppliers } from "@/ravarer/hooks/useSuppliers";
import { useMoveLegacyAgreedPrice } from "@/ravarer/hooks/useSupplierLinkRpcs";
import { formatDate, formatNok, PRICE_SOURCES } from "@/ravarer/lib/constants";
import { CostPriceEditor } from "./CostPriceEditor";
import { PrimarySupplierControl } from "./PrimarySupplierControl";

interface Props {
  rm: RawMaterialRow;
  canWrite: boolean;
  /** Åpner leverandørkoblingen (prisfanen) for redigering av avtalepris. */
  onEditLink?: () => void;
}

const sourceLabel = (s: string | null) => PRICE_SOURCES.find((p) => p.value === s)?.label ?? s ?? "ukjent kilde";

/** «Pris og leverandør» på råvarekortet — kun lesing + felles redigerere. */
export function PriceSupplierCard({ rm, canWrite, onEditLink }: Props) {
  const { data: links = [] } = useRawMaterialSuppliers(rm.id);
  const { data: all = [] } = useSuppliers();
  const move = useMoveLegacyAgreedPrice();
  const [costOpen, setCostOpen] = useState(false);
  const names = useMemo(() => new Map(all.map((s) => [s.id, s.name])), [all]);
  const linked = useMemo(
    () => links.map((l) => ({ id: l.supplier_id, name: names.get(l.supplier_id) ?? "Ukjent" })),
    [links, names],
  );
  const primaryLink = links.find((l) => l.is_primary) ?? links.find((l) => l.supplier_id === rm.primary_supplier_id) ?? null;
  const [moveTo, setMoveTo] = useState<string>("");
  const moveTarget = moveTo || rm.primary_supplier_id || links[0]?.supplier_id || "";

  return (
    <Card className="space-y-4 p-5">
      <h3 className="text-base font-semibold">Pris og leverandør</h3>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>Gjeldende kostpris</Label>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {rm.current_cost_price != null ? `${formatNok(rm.current_cost_price)}/${rm.base_unit}` : "Mangler"}
          </p>
          <p className="text-caption text-muted-foreground">
            {sourceLabel(rm.price_source)} · {formatDate(rm.price_updated_at)}
          </p>
          {canWrite && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setCostOpen(true)}>Endre</Button>
          )}
        </div>
        <div>
          <Label>Avtalt pris</Label>
          {rm.agreed_price != null ? (
            <div className="mt-1 space-y-2 rounded-lg border border-[hsl(var(--alert-warning))]/40 p-3">
              <p className="text-sm">
                Eldre avtalepris: {formatNok(rm.agreed_price)}/{rm.base_unit} — brukes ikke i priskontrollen
              </p>
              {canWrite && (
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={moveTarget} onValueChange={setMoveTo}>
                    <SelectTrigger className="h-8 w-48" aria-label="Flytt til leverandør"><SelectValue placeholder="Velg leverandør" /></SelectTrigger>
                    <SelectContent>
                      {(linked.length ? linked : all).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button size="sm" disabled={!moveTarget || move.isPending}
                    onClick={() => move.mutate({ rawMaterialId: rm.id, supplierId: moveTarget })}>
                    Flytt til leverandør
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {primaryLink?.agreed_price_per_base_unit != null ? `${formatNok(primaryLink.agreed_price_per_base_unit)}/${rm.base_unit}` : "Ingen avtalepris"}
              </p>
              <p className="text-caption text-muted-foreground">
                {primaryLink ? `Primærkobling · ${names.get(primaryLink.supplier_id) ?? "Ukjent"}` : "Ingen primærleverandør"}
              </p>
              {canWrite && onEditLink && (
                <Button variant="outline" size="sm" className="mt-2" onClick={onEditLink}>Endre i leverandørkoblingen</Button>
              )}
            </>
          )}
        </div>
      </div>
      <div>
        <Label>Primær leverandør</Label>
        <PrimarySupplierControl
          rawMaterialId={rm.id}
          currentSupplierId={rm.primary_supplier_id}
          linkedSuppliers={linked}
          allSuppliers={all}
          disabled={!canWrite}
        />
      </div>
      <CostPriceEditor
        open={costOpen}
        onOpenChange={setCostOpen}
        rawMaterialId={rm.id}
        rawMaterialName={rm.name}
        baseUnit={rm.base_unit}
        suppliers={linked}
        initialSupplierId={rm.primary_supplier_id}
      />
    </Card>
  );
}
