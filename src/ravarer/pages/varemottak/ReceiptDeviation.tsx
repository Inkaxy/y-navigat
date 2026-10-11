import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
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
  isCurrent,
}: {
  line: ReceiptLine | null;
  invoiceNumber: string;
  onClose: () => void;
  /** Gjeldende kontekst (montert, samme selskap/faktura, skrivetilgang) — sjekkes rett før bevegelsen skrives. */
  isCurrent: () => boolean;
}) {
  const move = useReceiptMovement();
  const { data: units = [] } = useRawMaterialUnits(line?.raw_material_id ?? undefined);
  const [kind, setKind] = useState<DeviationKind>("less");
  const [rows, setRows] = useState<UnitAmountRow[]>([emptyRow()]);
  const [note, setNote] = useState("");

  const base = rowsToBase(rows, units);
  /** Synkron lås: manuell bevegelse er ikke idempotent — to klikk skal aldri gi to bevegelser. */
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  /** Uklart svar: bevegelsen kan være skrevet. Aldri automatisk nytt forsøk fra denne dialogen. */
  const [unknown, setUnknown] = useState(false);

  const submit = async () => {
    if (busy.current || unknown || !line?.raw_material_id || base == null || base === 0) return;
    if (!isCurrent()) { toast.error("Konteksten er endret eller tilgangen mangler. Avviket ble ikke registrert."); onClose(); return; }
    busy.current = true;
    const amount = Math.abs(base);
    // Mengde, type og notat fryses ved innsending.
    const frozen = {
      raw_material_id: line.raw_material_id,
      quantity_base: kind === "less" ? -amount : amount,
      kind: kind === "waste" ? ("waste" as const) : ("adjustment" as const),
      note:
        (kind === "waste" ? "Svinn ved mottak" : "Mottaksavvik") +
        ` faktura ${invoiceNumber}` +
        (note.trim() ? ` — ${note.trim()}` : ""),
    };
    try {
      await move.mutateAsync(frozen);
      if (mounted.current) onClose();
    } catch (e) {
      console.warn("[varemottak] avvik: uklart utfall", e);
      if (mounted.current) setUnknown(true);
    } finally {
      busy.current = false;
    }
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
        {unknown && (
          <p role="alert" className="text-sm text-destructive">
            Utfallet er ukjent — avviket kan være registrert. Kontroller lagerbevegelsene for varen før du registrerer på nytt.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-[44px]" onClick={onClose}>{unknown ? "Lukk" : "Avbryt"}</Button>
          <Button className="min-h-[44px]" onClick={() => void submit()} disabled={unknown || move.isPending || base == null || base === 0}>Registrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
