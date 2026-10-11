import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { PackageWorklistRow } from "@/ravarer/hooks/usePackageSizes";
import { useRawMaterialUnits } from "@/ravarer/hooks/useRawMaterialUnits";
import { useReceiptMovement, type ReceiptLine } from "@/ravarer/hooks/useGoodsReceipt";
import { UnitAmountRows, emptyRow, rowsToBase, type UnitAmountRow } from "@/ravarer/components/stock/UnitAmountRows";
import { formatNumber } from "@/ravarer/lib/constants";

/** Pakningsdialogen forventer en arbeidslisterad; her har vi bare fakturalinja. */
export function receiptLineAsWorklistRow(line: ReceiptLine): PackageWorklistRow {
  return {
    id: line.raw_material_id!,
    legal_entity_id: null,
    name: line.raw_material_name ?? line.description ?? "",
    base_unit: line.base_unit,
    category: null,
    current_cost_price: null,
    pakningsfaktor: null,
    faktor_kilde: null,
    bekreftet_dato: null,
    antall_fakturalinjer: null,
    antall_leverandorer: null,
    enheter_i_bruk: line.unit,
    linjer_uten_pris: null,
    kjopt_kr_totalt: null,
    siste_faktura: null,
    pris_spredning: null,
    implisert_mengde: null,
    referansepris: null,
    referansekilde: null,
    referansedato: null,
    referanse_faktor: null,
    foreslatt_fra_navn: null,
    foreslatt_fra_referanse: null,
    status: "mangler_pakning",
  };
}

type DeviationKind = "less" | "more" | "waste";

export function DeviationDialog({
  line,
  invoiceNumber,
  onClose,
}: {
  line: ReceiptLine | null;
  invoiceNumber: string;
  onClose: () => void;
}) {
  const move = useReceiptMovement();
  const { data: units = [] } = useRawMaterialUnits(line?.raw_material_id ?? undefined);
  const [kind, setKind] = useState<DeviationKind>("less");
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  const [note, setNote] = useState("");

  const base = rowsToBase(rows, units);

  const submit = async () => {
    if (!line?.raw_material_id || base == null || base === 0) return;
    const amount = Math.abs(base);
    await move.mutateAsync({
      raw_material_id: line.raw_material_id,
      quantity_base: kind === "less" ? -amount : amount,
      kind: kind === "waste" ? "waste" : "adjustment",
      note:
        (kind === "waste" ? "Svinn ved mottak" : "Mottaksavvik") +
        ` faktura ${invoiceNumber}` +
        (note.trim() ? ` — ${note.trim()}` : ""),
    });
    setRows([emptyRow()]);
    setNote("");
    onClose();
  };

  return (
    <Dialog open={!!line} onOpenChange={v => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrer avvik — {line?.raw_material_name ?? ""}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={kind} onValueChange={v => setKind(v as DeviationKind)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="less">Mottok mindre enn fakturert</SelectItem>
                <SelectItem value="more">Mottok mer enn fakturert</SelectItem>
                <SelectItem value="waste">Knust / ødelagt ved mottak</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Differanse</Label>
            <UnitAmountRows rows={rows} onChange={setRows} units={units} baseUnit={line?.base_unit ?? ""} />
            {base != null && (
              <p className="mt-1 text-xs text-ink-secondary">
                Bokføres som {kind === "less" ? "−" : kind === "waste" ? "−" : "+"}
                {formatNumber(Math.abs(base), 2)} {line?.base_unit}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Notat</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Valgfritt" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Avbryt</Button>
          <Button onClick={submit} disabled={move.isPending || base == null || base === 0}>Registrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
