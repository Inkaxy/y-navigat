import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router-dom";
import { paths } from "@/ravarer/lib/paths";
import {
  acknowledgeAdjustment, beginAdjustment, isKnownRejection, markAdjustmentUnknown, pendingAdjustmentFor, settleAdjustment,
  subscribePendingAdjustments, type PendingAdjustment,
} from "@/ravarer/lib/adjustmentRecovery";
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
  entityId,
  invoiceId,
  invoiceNumber,
  onClose,
  isCurrent,
}: {
  line: ReceiptLine | null;
  /** Frosset opphav for gjenopprettingsmarkøren (selskap + faktura + linje + vare). */
  entityId: string | null;
  invoiceId: string;
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
  /** Uavklart/pågående bevegelse for samme selskap/faktura/linje/vare — lever utenfor dialogen. */
  const marker = useSyncExternalStore(subscribePendingAdjustments, () =>
    line ? pendingAdjustmentFor(entityId, invoiceId, line.id, line.raw_material_id) : null);
  const unknown = marker?.state === "unknown";
  const [checked, setChecked] = useState(false);

  const submit = async () => {
    if (busy.current || marker || !entityId || !line?.raw_material_id || base == null || base === 0) return;
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
    // Markøren settes før kallet: et svar som kommer etter lukking forsvinner ikke.
    const rec: PendingAdjustment | null = beginAdjustment({ entityId, invoiceId, lineId: line.id, payload: frozen });
    if (!rec) { busy.current = false; return; }
    try {
      await move.mutateAsync(frozen);
      settleAdjustment(rec);
      if (mounted.current) onClose();
    } catch (e) {
      if (isKnownRejection(e)) settleAdjustment(rec);
      else {
        console.warn("[varemottak] avvik: uklart utfall", e instanceof Error ? e.name : "ukjent");
        markAdjustmentUnknown(rec);
      }
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
        {marker?.state === "pending" && (
          <p role="status" className="text-sm text-ink-secondary">Et avvik for denne linja sendes nå. Vent på svaret.</p>
        )}
        {unknown && marker && (
          <div role="alert" data-testid="adjustment-unknown" className="space-y-2 rounded-md border border-destructive/40 p-3 text-sm">
            <p className="text-destructive">
              Utfallet er ukjent — avviket kan være registrert: {marker.payload.quantity_base > 0 ? "+" : "−"}
              {formatNumber(Math.abs(marker.payload.quantity_base), 2)} {line?.base_unit} ({marker.payload.kind === "waste" ? "svinn" : "justering"}), «{marker.payload.note}».
            </p>
            <p>Kontroller lagerbevegelsene for varen før du registrerer på nytt. Ingenting sendes automatisk.</p>
            <Link className="inline-flex min-h-[44px] items-center text-primary underline-offset-2 hover:underline"
              to={paths.raavare(marker.payload.raw_material_id, { seksjon: "lager" })}>
              Åpne lagerbevegelsene for varen
            </Link>
            <label className="flex min-h-[44px] items-center gap-2">
              <input type="checkbox" className="h-5 w-5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              Jeg har kontrollert lagerbevegelsene
            </label>
            <Button variant="outline" className="min-h-[44px]" disabled={!checked}
              onClick={() => { acknowledgeAdjustment(marker); setChecked(false); }}>
              Bekreft kontroll og lås opp
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-[44px]" onClick={onClose}>{unknown ? "Lukk" : "Avbryt"}</Button>
          <Button className="min-h-[44px]" onClick={() => void submit()} disabled={!!marker || move.isPending || base == null || base === 0}>Registrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
