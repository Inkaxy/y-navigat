import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCorrectLine, useCorrectionLine } from "@/ravarer/pages/priskontroll/faktura/useLineCorrection";
import { unitCorrectionOptions, unitCorrectionState } from "@/fakturaer/lib/unitCorrection";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Frosset ved åpning: dialogen retter bare denne linjen. */
  lineId: string;
  invoiceNumber?: string | null;
  /** Etter bekreftet lagring (fersk lesing er startet). */
  onSaved?: (newUnit: string) => void;
}

/**
 * «Rett fakturert enhet»: bare enheten (f.eks. sekk → pose) med begrunnelse, via rm_correct_invoice_line med
 * linjens eksakte versjon. Mengde, pris, rabatt og sum endres aldri her. Ukjent utfall sperrer nytt forsøk
 * til linjen er lest inn på nytt.
 */
export function InvoiceUnitCorrectionDialog({ open, onOpenChange, lineId, invoiceNumber, onSaved }: Props) {
  const frozenId = useRef(lineId).current;
  const fresh = useCorrectionLine(open ? frozenId : null);
  const correct = useCorrectLine();
  const qc = useQueryClient();
  const [unit, setUnit] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const lock = useRef(false);
  const before = fresh.data ? String(fresh.data.values.unit ?? "") : null;
  const st = unitCorrectionState({ before, after: unit, reason, costPosted: fresh.data?.costPosted ?? false, loading: fresh.isLoading || fresh.isFetching, loadError: fresh.isError, unknown });

  const save = async () => {
    if (lock.current || !fresh.data || st.kind !== "ready") return;
    lock.current = true; setError(null);
    const l = fresh.data;
    try {
      await correct.mutateAsync({ lineId: frozenId, invoiceId: l.invoice_id, expectedUpdatedAt: l.updated_at, changes: { unit: st.after }, reason: reason.trim(), learn: false, acceptIssues: false });
      void qc.invalidateQueries({ queryKey: ["supplier-item-lines"] });
      void qc.invalidateQueries({ queryKey: ["supplier-items"] });
      void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
      void qc.invalidateQueries({ queryKey: ["ravarer", "work-item-plans"] });
      onSaved?.(st.after);
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      // Kjent avvisning = ingenting lagret. Alt annet er ukjent utfall.
      if (msg && msg !== "Rettelsen ble ikke lagret. Prøv igjen.") setError(msg);
      else { setUnknown(true); setError("Utfallet er ukjent. Les inn linjen på nytt før du prøver igjen."); }
    } finally { lock.current = false; }
  };

  const reload = async () => { setError(null); const r = await fresh.refetch(); if (!r.isError) setUnknown(false); };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!correct.isPending) onOpenChange(v); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Rett fakturert enhet</DialogTitle>
          <DialogDescription>
            Bare enheten på linjen{invoiceNumber ? ` på faktura ${invoiceNumber}` : ""} endres. Mengde, pris, rabatt og sum står som før.
          </DialogDescription>
        </DialogHeader>
        {fresh.isLoading ? (
          <p className="flex items-center gap-2 text-sm text-ink-secondary"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Henter linjen …</p>
        ) : fresh.isError ? (
          <div role="alert" className="space-y-2 text-sm text-destructive">
            <p>Linjen kunne ikke hentes.</p>
            <Button variant="outline" className="min-h-[44px]" onClick={() => void fresh.refetch()}>Prøv igjen</Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label htmlFor={`unitfix-${frozenId}`} className="text-caption">Riktig enhet</Label>
              <Select value={unit} onValueChange={setUnit} disabled={unknown}>
                <SelectTrigger id={`unitfix-${frozenId}`} className="mt-1 min-h-[44px]"><SelectValue placeholder="Velg enhet" /></SelectTrigger>
                <SelectContent>{unitCorrectionOptions(before).map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`unitfix-reason-${frozenId}`} className="text-caption">Begrunnelse</Label>
              <Textarea id={`unitfix-reason-${frozenId}`} className="mt-1" value={reason} onChange={(e) => setReason(e.target.value)} disabled={unknown}
                placeholder="F.eks. originalen viser poser à 100 g, ikke sekk" />
            </div>
            <p className="rounded-md bg-muted/60 px-3 py-2 text-sm" aria-live="polite" data-testid="unit-before-after">
              Før: <strong>{before || "ingen enhet"}</strong> → Etter: <strong>{st.kind === "ready" ? st.after : unit || "–"}</strong>
            </p>
            {st.kind === "blocked" && <p className="text-caption text-warning">{st.reason}</p>}
            {error && (
              <div role="alert" className="space-y-2 text-sm text-destructive">
                <p>{error}</p>
                {unknown && <Button variant="outline" className="min-h-[44px]" onClick={() => void reload()}>Les inn linjen på nytt</Button>}
              </div>
            )}
          </div>
        )}
        <DialogFooter className="gap-2">
          <Button variant="ghost" className="min-h-[44px]" disabled={correct.isPending} onClick={() => onOpenChange(false)}>Avbryt</Button>
          <Button className="min-h-[44px]" disabled={st.kind !== "ready" || correct.isPending} onClick={() => void save()}>
            {correct.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}Lagre enhet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
