import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useInvoiceExclusion } from "@/fakturaer/hooks/useInvoiceExclusion";
import {
  EXCLUSION_CATEGORY_LABEL, MAX_REASON, MIN_REASON, exclusionErrorText,
  type ExclusionCategory, type ExclusionScope,
} from "@/fakturaer/lib/invoiceExclusion";

export type HoldOutsideTarget = {
  invoice: { id: string; invoice_number: string | null; updated_at: string; is_credit_note: boolean };
  /** Linjen dialogen ble åpnet fra; null = bare dokumentvalget. */
  line: { id: string; line_number: number | null; description: string | null; updated_at: string } | null;
  initialScope: ExclusionScope;
};

type Props = {
  target: HoldOutsideTarget | null;
  onOpenChange: (v: boolean) => void;
  canWrite: boolean;
  onDone?: (scope: ExclusionScope) => void;
};

const newOp = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** «Hold utenfor råvarebehandling»: linje eller hele dokumentet, årsak og obligatorisk begrunnelse. Skriver bare via RPC. */
export function HoldOutsideDialog({ target, onOpenChange, canWrite, onDone }: Props) {
  const ex = useInvoiceExclusion();
  const [scope, setScope] = useState<ExclusionScope>("invoice");
  const [category, setCategory] = useState<ExclusionCategory>("erstatning_produksjonstap");
  const [reason, setReason] = useState("");
  const [opId, setOpId] = useState(newOp);
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const key = target ? `${target.invoice.id}:${target.line?.id ?? ""}:${target.initialScope}` : null;

  useEffect(() => {
    if (!target) return;
    setScope(target.line ? target.initialScope : "invoice");
    setCategory("erstatning_produksjonstap"); setReason(""); setOpId(newOp()); setError(null); setUnknown(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!target) return null;
  const docLabel = target.invoice.is_credit_note ? "kreditnotaen" : "fakturaen";
  const trimmed = reason.trim();
  const valid = trimmed.length >= MIN_REASON && trimmed.length <= MAX_REASON && (scope === "invoice" || !!target.line);
  const locked = unknown; // ukjent utfall: samme forespørsel sendes uendret

  async function submit() {
    if (!target || !valid || !canWrite) return;
    setError(null);
    const r = await ex.exclude({
      invoiceId: target.invoice.id, scope, lineId: scope === "line" ? target.line?.id ?? null : null,
      category, reason: trimmed, opId,
      expectedUpdatedAt: scope === "line" && target.line ? target.line.updated_at : target.invoice.updated_at,
    });
    if (r.kind === "ok") { setUnknown(false); onDone?.(scope); onOpenChange(false); return; }
    if (r.kind === "denied") { setError("Du har ikke skrivetilgang til fakturaer i dette selskapet. Ingenting er endret."); return; }
    if (r.kind === "rejected") { setUnknown(false); setError(exclusionErrorText(r)); return; }
    setUnknown(true);
    setError("Vi vet ikke om dette ble lagret. Trykk «Send på nytt» for å sende nøyaktig samme forespørsel, eller lukk og last inn fakturaen på nytt.");
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!ex.busy) onOpenChange(v); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Hold utenfor råvarebehandling</DialogTitle>
          <DialogDescription>Faktura {target.invoice.invoice_number ?? "uten nummer"}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {target.line && (
            <fieldset className="space-y-2" disabled={locked}>
              <legend className="mb-1 font-medium">Hva gjelder det?</legend>
              <RadioGroup value={scope} onValueChange={(v) => { if (v === "line" || v === "invoice") setScope(v); }} aria-label="Omfang">
                <label className="flex items-start gap-2"><RadioGroupItem value="line" id="hold-scope-line" aria-label="Bare denne linjen" className="mt-0.5" />
                  <span>Bare linje {target.line.line_number ?? ""}{target.line.description ? ` – ${target.line.description}` : ""}</span></label>
                <label className="flex items-start gap-2"><RadioGroupItem value="invoice" id="hold-scope-invoice" aria-label="Hele dokumentet" className="mt-0.5" />
                  <span>Hele {docLabel} med alle linjer</span></label>
              </RadioGroup>
            </fieldset>
          )}
          <div data-testid="hold-consequence" className="rounded-lg border border-border bg-muted/40 p-3 text-ink-secondary">
            {scope === "invoice" ? (
              <p>Hele {docLabel} og alle linjene tas ut av Å gjøre, avklaringer og prisvurdering – også sumavvik og manglende kreditnotakobling.
                Den blir <strong>ikke</strong> avstemt eller godkjent. Linjene brukes ikke som pris, kostpris eller lager. Originalen, beløpene,
                sumvarselet og historikken beholdes, og du kan gjenåpne senere.</p>
            ) : (
              <p>Bare denne linjen tas ut av råvarebehandlingen og brukes ikke som pris, kostpris eller lager. De andre linjene behandles som før.
                Opprinnelig kobling og beløp beholdes i historikken, og du kan gjenåpne senere.</p>
            )}
          </div>
          <fieldset className="space-y-2" disabled={locked}>
            <legend className="mb-1 font-medium">Årsak</legend>
            <RadioGroup value={category} onValueChange={(v) => { if (v === "erstatning_produksjonstap" || v === "annet") setCategory(v); }} aria-label="Årsak">
              {(Object.keys(EXCLUSION_CATEGORY_LABEL) as ExclusionCategory[]).map((c) => (
                <label key={c} className="flex items-center gap-2"><RadioGroupItem value={c} aria-label={EXCLUSION_CATEGORY_LABEL[c]} />{EXCLUSION_CATEGORY_LABEL[c]}</label>
              ))}
            </RadioGroup>
          </fieldset>
          <div>
            <Label htmlFor="hold-reason" className="mb-1.5 block">Begrunnelse (påkrevd)</Label>
            <Textarea id="hold-reason" value={reason} disabled={locked} maxLength={MAX_REASON} onChange={(e) => setReason(e.target.value)}
              placeholder="F.eks. erstatning for ødelagte varer etter produksjonsfeil – ikke ordinær råvarepris" />
            {trimmed.length > 0 && trimmed.length < MIN_REASON && <p className="mt-1 text-caption text-ink-secondary">Minst {MIN_REASON} tegn.</p>}
          </div>
          {!canWrite && <p role="status" className="text-caption text-ink-secondary">Du har bare lesetilgang og kan ikke holde noe utenfor.</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <DialogFooter className="[&>*]:min-h-11">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={ex.busy}>Avbryt</Button>
          <Button onClick={() => void submit()} disabled={!canWrite || !valid || ex.busy}>
            {unknown ? "Send på nytt" : scope === "invoice" ? `Hold hele ${docLabel} utenfor` : "Hold linjen utenfor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
