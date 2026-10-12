import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  buildChanges, CORRECTION_FIELDS, CORRECTION_FIELD_LABEL, correctionLockReason, draftFrom, LINE_KIND_OPTIONS, PRICE_BASIS_OPTIONS,
  NUMERIC_FIELDS, type CorrectionDraft, type CorrectionField, type CorrectionResult,
} from "@/fakturaer/lib/lineCorrection";
import { formatMachineNumbersNb } from "@/fakturaer/lib/sumDirection";
import { lineReadIssues, parseNorwegianNumber } from "@/fakturaer/lib/invoiceReadCheck";
import { useCorrectionLine, useCorrectLine } from "./useLineCorrection";
import { ExtractionExamplesList } from "./ExtractionExamplesList";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lineId: string | null;
  /** Fakturaen målet ble frosset for. Avviker den fra `invoice.id`, er dialogen ikke redigerbar. */
  targetInvoiceId: string | null;
  /** Elementet som åpnet dialogen; fokus føres tilbake bare hvis det fortsatt er koblet til siden. */
  returnFocus?: () => HTMLElement | null;
  invoice: { id: string; status: string | null; approved: boolean; supplier_id: string | null; supplier_name: string | null };
  canWrite: boolean;
  /** Originaldokumentet, vist ved siden av skjemaet. */
  document: ReactNode;
  onSaved: (r: CorrectionResult) => void;
};

const show = (v: string | number | null | undefined) => (v == null || v === "" ? "–" : String(v));

/** «Rett fakturalinje»: før/etter, begrunnelse og valgfri læring. Lagres i én server-RPC. */
export function CorrectLineDialog({ open, onOpenChange, lineId, targetInvoiceId, returnFocus, invoice, canWrite, document, onSaved }: Props) {
  const q = useCorrectionLine(open ? lineId : null);
  // Grunnlaget utkastet ble laget fra (frosset ved første vellykkede lesing for denne linjen).
  const [base, setBase] = useState<{ lineId: string; updatedAt: string } | null>(null);
  const submitting = useRef(false);
  const save = useCorrectLine();
  const [draft, setDraft] = useState<CorrectionDraft | null>(null);
  const [reason, setReason] = useState("");
  const [learn, setLearn] = useState(false);
  const [acceptIssues, setAcceptIssues] = useState(false);
  const [showDoc, setShowDoc] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Eksakt identitet: frosset faktura = gjeldende faktura, og fersk rad = frosset linje på den fakturaen.
  const identityOk = !!q.data && !!lineId && q.data.id === lineId && q.data.invoice_id === invoice.id && targetInvoiceId === invoice.id;
  // Utkastet lages én gang per linje; ny lesing (også «Prøv igjen») beholder brukerens utkast.
  useEffect(() => {
    if (!open || !q.data || !identityOk || base?.lineId === q.data.id) return;
    setDraft(draftFrom(q.data.values)); setBase({ lineId: q.data.id, updatedAt: q.data.updated_at });
    setReason(""); setLearn(false); setAcceptIssues(false); setErr(null);
  }, [open, q.data, identityOk, base]);
  // Raden er endret siden utkastet ble laget: utkastet beholdes, men kan ikke lagres mot ny versjon.
  const versionChanged = !!base && !!q.data && q.data.updated_at !== base.updatedAt;
  // Bare et vellykket, ferdig og gjeldende svar (rad + kostprisføring) kan ligge til grunn for lagring.
  const settled = q.isSuccess && !q.isFetching && !q.isError;

  const result = useMemo(() => (q.data && draft ? buildChanges(q.data.values, draft) : null), [q.data, draft]);
  const preview = useMemo(() => {
    if (!draft) return [];
    const n = (f: CorrectionField) => (draft[f].trim() === "" ? null : parseNorwegianNumber(draft[f]));
    return lineReadIssues({
      quantity: n("quantity"), unit: draft.unit || null, unit_price: n("unit_price"), total_amount: n("total_amount"),
      package_size: n("package_size"), package_unit: draft.package_unit || null, count_per_package: n("count_per_package"),
      unit_price_basis: draft.unit_price_basis || null, discount_amount: n("discount_amount"), line_kind: draft.line_kind || null,
    });
  }, [draft]);

  const lock = q.data ? correctionLockReason({ status: invoice.status, approved: invoice.approved, costPosted: q.data.costPosted }) : null;
  const changedKeys = result ? (Object.keys(result.changes) as CorrectionField[]) : [];
  const hasErrors = !!result && Object.keys(result.errors).length > 0;
  const ready = identityOk && settled && !versionChanged && !!base;
  const canSave = ready && canWrite && !lock && !hasErrors && reason.trim().length >= 3 && (changedKeys.length > 0 || acceptIssues) && !save.isPending;

  async function submit() {
    // Synkron kontroll ved innsending, ikke bare via deaktivert knapp.
    if (submitting.current || !canSave || !q.data || !result || !lineId) return;
    if (q.data.id !== lineId || q.data.invoice_id !== invoice.id || targetInvoiceId !== invoice.id) return;
    submitting.current = true;
    setErr(null);
    try {
      const r = await save.mutateAsync({
        lineId: q.data.id, invoiceId: invoice.id, expectedUpdatedAt: q.data.updated_at, changes: result.changes,
        reason: reason.trim(), learn: learn && changedKeys.length > 0, acceptIssues,
      });
      onSaved(r);
      onOpenChange(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Rettelsen ble ikke lagret. Prøv igjen.");
      void q.refetch();
    } finally {
      submitting.current = false;
    }
  }
  const reloadFresh = () => { setBase(null); void q.refetch(); };

  const field = (f: CorrectionField) => {
    if (!draft) return null;
    const id = `rett-${f}`;
    if (f === "line_kind") {
      const hint = LINE_KIND_OPTIONS.find((o) => o.value === draft.line_kind)?.hint;
      return (
        <div key={f} className="sm:col-span-2">
          <Label htmlFor={id} className="mb-1 block">{CORRECTION_FIELD_LABEL[f]}</Label>
          <Select value={draft.line_kind || "vare"} onValueChange={(v) => setDraft({ ...draft, line_kind: v })} disabled={!!lock}>
            <SelectTrigger id={id} className="min-h-[44px]"><SelectValue /></SelectTrigger>
            <SelectContent>{LINE_KIND_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
          {hint && <p className="mt-1 text-caption text-ink-secondary">{hint}</p>}
        </div>
      );
    }
    if (f === "unit_price_basis") {
      return (
        <div key={f}>
          <Label htmlFor={id} className="mb-1 block">{CORRECTION_FIELD_LABEL[f]}</Label>
          <Select value={draft.unit_price_basis || "ukjent"} onValueChange={(v) => setDraft({ ...draft, unit_price_basis: v === "ukjent" ? "" : v })} disabled={!!lock}>
            <SelectTrigger id={id} className="min-h-[44px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PRICE_BASIS_OPTIONS.map((o) => <SelectItem key={o.value || "ukjent"} value={o.value || "ukjent"}>{o.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      );
    }
    const e = result?.errors[f];
    return (
      <div key={f} className={f === "description" ? "sm:col-span-2" : undefined}>
        <Label htmlFor={id} className="mb-1 block">{CORRECTION_FIELD_LABEL[f]}</Label>
        <Input id={id} className="min-h-[44px]" value={draft[f]} inputMode={NUMERIC_FIELDS.includes(f) ? "decimal" : undefined} disabled={!!lock}
          aria-invalid={!!e} onChange={(ev) => setDraft({ ...draft, [f]: ev.target.value })} />
        {e && <p className="mt-1 text-caption text-destructive">{e}</p>}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-6xl overflow-y-auto" closeClassName="flex min-h-[44px] min-w-[44px] items-center justify-center right-2 top-2"
        onCloseAutoFocus={(e) => { const el = returnFocus?.(); if (el && el.isConnected) { e.preventDefault(); el.focus(); } }}>
        <DialogHeader>
          <DialogTitle>Rett fakturalinje{q.data?.line_number != null ? ` ${q.data.line_number}` : ""}</DialogTitle>
          <DialogDescription>Les av originalen og rett det som er lest feil. Rettelsen lagres med før/etter, begrunnelse, hvem og når. Kobling og prisvurdering beregnes på nytt.</DialogDescription>
        </DialogHeader>
        {q.isLoading && <p className="text-sm text-ink-secondary">Henter linjen …</p>}
        {q.isError && (
          <p role="alert" className="text-sm text-destructive">Kunne ikke hente linjen{draft ? ". Utkastet ditt er beholdt, men kan ikke lagres før linjen er hentet på nytt" : ""}.{" "}
            <button type="button" className="min-h-[44px] underline" onClick={() => void q.refetch()}>Prøv igjen</button></p>
        )}
        {q.data && !identityOk && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">Linjen hører ikke til fakturaen som vises. Lukk og åpne rettingen på nytt fra riktig faktura.</p>
        )}
        {versionChanged && (
          <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">Linjen er endret siden du åpnet den. Utkastet kan ikke lagres mot den nye versjonen.{" "}
            <button type="button" className="min-h-[44px] underline" onClick={reloadFresh}>Last inn ferske verdier</button></p>
        )}
        {q.data && identityOk && draft && (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className={showDoc ? "block" : "hidden lg:block"}>
              <div className="h-[60vh] overflow-hidden rounded-lg border border-border">{document}</div>
            </div>
            <div className="space-y-4">
              <Button type="button" variant="outline" size="sm" className="min-h-[44px] lg:hidden" onClick={() => setShowDoc(!showDoc)}>{showDoc ? "Skjul original" : "Vis original"}</Button>
              {lock && <p role="note" className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">{lock}</p>}
              {q.data.issues.length > 0 && (
                <div className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
                  <p className="font-medium">Lesevarsler på linjen</p>
                  <ul className="list-disc pl-5">{q.data.issues.map((i) => <li key={i.code + i.message}>{formatMachineNumbersNb(i.message)}</li>)}</ul>
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-2">{CORRECTION_FIELDS.map(field)}</div>
              {changedKeys.length > 0 && (
                <table className="w-full text-sm" aria-label="Før og etter">
                  <thead className="text-caption text-ink-secondary"><tr><th className="text-left font-medium">Felt</th><th className="text-left font-medium">Før</th><th className="text-left font-medium">Etter</th></tr></thead>
                  <tbody>{changedKeys.map((f) => (
                    <tr key={f} className="border-t border-border"><td className="py-1">{CORRECTION_FIELD_LABEL[f]}</td><td className="py-1 text-ink-secondary line-through">{show(q.data?.values[f])}</td><td className="py-1 font-medium">{show(result?.changes[f])}</td></tr>
                  ))}</tbody>
                </table>
              )}
              {preview.length > 0 ? (
                <div className="space-y-2 rounded-md border border-border px-3 py-2 text-sm">
                  <p>Etter rettelsen: {preview.map((p) => formatMachineNumbersNb(p.message)).join(" ")}</p>
                  <label className="flex min-h-[44px] items-start gap-2 py-2"><Checkbox checked={acceptIssues} onCheckedChange={(v) => setAcceptIssues(v === true)} disabled={!!lock} />
                    <span>Tallene er kontrollert mot originalen og stemmer likevel. Registrer heller rabatt og prisgrunnlag over når det er mulig.</span></label>
                  {acceptIssues && learn && <p className="text-caption text-ink-secondary">Rettelser med godtatte avvik blir aldri brukt ved senere lesing. Rett tallene og prisgrunnlaget i stedet hvis du vil lære av linjen.</p>}
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-caption text-ink-secondary">Regnestykket går opp med disse tallene.</p>
                  {q.data.issues.length > 0 && (
                    <label className="flex min-h-[44px] items-start gap-2 rounded-md border border-border px-3 py-2 text-sm"><Checkbox checked={acceptIssues} onCheckedChange={(v) => setAcceptIssues(v === true)} disabled={!!lock} />
                      <span>Jeg har kontrollert lesevarslene over mot originalen, og linjen stemmer. Varslene lukkes med begrunnelsen og blir aldri brukt til læring.</span></label>
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="rett-begrunnelse" className="mb-1 block">Begrunnelse</Label>
                <Textarea id="rett-begrunnelse" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="F.eks. «Linjesum lest som 30, står 300 på originalen»" disabled={!!lock} />
              </div>
              <label className="flex min-h-[44px] items-start gap-2 py-2 text-sm">
                <Checkbox checked={learn} onCheckedChange={(v) => setLearn(v === true)} disabled={!!lock || !invoice.supplier_id || changedKeys.length === 0} />
                <span>
                  <span className="font-medium">Bruk rettelsen ved senere lesing</span>
                  <span className="block text-caption text-ink-secondary">
                    Lagrer rettelsen som et bekreftet eksempel for {invoice.supplier_name ?? "denne leverandøren"} i dette selskapet. Eksempelet gis som kontekst
                    når fakturaer fra samme leverandør leses. Det er gjenbruk av bekreftede eksempler, ikke retrening av modellen, og nye beløp overskrives aldri.
                  </span>
                </span>
              </label>
              <ExtractionExamplesList supplierId={invoice.supplier_id} canWrite={canWrite} />
              {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)} disabled={save.isPending}>Avbryt</Button>
          <Button className="min-h-[44px]" onClick={() => void submit()} disabled={!canSave}>{save.isPending ? "Lagrer …" : "Lagre rettelsen"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
