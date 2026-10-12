import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatNok } from "@/ravarer/lib/constants";
import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";
import { classifyApplyOutcome, readEdgeErrorBody, runPrimaryTasks, type ApplyOutcome, type PrimaryTask } from "@/ravarer/lib/negotiationOps";
import type { NegotiationItemRow, NegotiationRecipientRow, NegotiationResponseRow } from "@/ravarer/hooks/useNegotiations";

type Pick = { winner_recipient_id: string | null; set_as_primary: boolean; apply_to_supplier: boolean };

export interface ConcludeDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  items: NegotiationItemRow[];
  responses: NegotiationResponseRow[];
  recipients: NegotiationRecipientRow[];
  bestByItem: Map<string, string | null>;
  rmName: (id: string) => string;
  rmBaseUnit: (id: string) => string | null;
  supName: (id: string) => string;
  negotiationId: string;
  /** Les forhandling/varer/råvarer på nytt (kalles etter hvert utfall). */
  onRefresh: () => void;
}

/**
 * Avslutt RFQ: utfallsmotoren (`apply-negotiation-outcome`) er ett kall uten
 * per-linje-kvittering. Primærleverandør er et eget steg etter motoren, og bare
 * det steget kan gjentas alene. Ingenting gjentas automatisk.
 */
export function ConcludeDialog({ open, onOpenChange, items, responses, recipients, bestByItem, rmName, rmBaseUnit, supName, negotiationId, onRefresh }: ConcludeDialogProps) {
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [split, setSplit] = useState<ApplyOutcome | null>(null);
  const [remainingPrimary, setRemainingPrimary] = useState<PrimaryTask[] | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    if (!open || items.length === 0) return;
    setPicks((prev) => {
      if (Object.keys(prev).length > 0) return prev;
      const init: Record<string, Pick> = {};
      for (const it of items) init[it.id] = { winner_recipient_id: bestByItem.get(it.id) ?? null, set_as_primary: false, apply_to_supplier: true };
      return init;
    });
  }, [open, items, bestByItem]);

  const apply = useMutation({
    mutationFn: async () => {
      const outcomes = items.map((it) => {
        const p = picks[it.id];
        const winnerResp = responses.find((r) => r.recipient_id === p?.winner_recipient_id && r.negotiation_item_id === it.id);
        return {
          negotiation_item_id: it.id,
          winner_recipient_id: p?.winner_recipient_id ?? null,
          winner_response_id: winnerResp?.id ?? null,
          agreed_price: winnerResp?.offered_price ?? null,
          // Portalen ber om «Pris pr {baseenhet}» — RFQ-tilbud er alltid per grunnenhet.
          agreed_price_unit: rmBaseUnit(it.raw_material_id),
          agreed_package_size: winnerResp?.offered_package_size ?? null,
          agreed_package_unit: winnerResp?.offered_package_unit ?? null,
          set_as_primary: p?.set_as_primary ?? false,
          apply_to_supplier: p?.apply_to_supplier ?? false,
        };
      });
      // Frys primæroppgavene før kallet, så et senere valg i skjemaet ikke endrer dem.
      const tasks: PrimaryTask[] = [];
      for (const it of items) {
        const p = picks[it.id];
        if (!p?.set_as_primary || !p.winner_recipient_id) continue;
        const rec = recipients.find((r) => r.id === p.winner_recipient_id);
        if (rec?.supplier_id) tasks.push({ rawMaterialId: it.raw_material_id, supplierId: rec.supplier_id });
      }
      const { data, error } = await supabase.functions.invoke("apply-negotiation-outcome", {
        body: { negotiation_id: negotiationId, outcomes },
      });
      const outcome = classifyApplyOutcome(data, error, error ? await readEdgeErrorBody(error) : null);
      if (outcome.kind !== "success") return { outcome, failedPrimary: [] as PrimaryTask[] };
      const { failed } = await runPrimaryTasks(tasks, setPrimarySupplier);
      return { outcome, failedPrimary: failed };
    },
    onSuccess: ({ outcome, failedPrimary }) => {
      onRefresh();
      if (!mounted.current) return;
      if (outcome.kind === "rejected") { toast.error(outcome.message); return; }
      if (outcome.kind === "partial" || outcome.kind === "unknown") { setSplit(outcome); return; }
      if (failedPrimary.length > 0) { setRemainingPrimary(failedPrimary); return; }
      toast.success("Forhandling avsluttet");
      onOpenChange(false);
    },
    onError: () => { onRefresh(); if (mounted.current) setSplit({ kind: "unknown" }); },
    onSettled: () => { lock.current = false; },
  });

  const retryPrimary = useMutation({
    mutationFn: async (tasks: PrimaryTask[]) => runPrimaryTasks(tasks, setPrimarySupplier),
    onSuccess: ({ failed }) => {
      onRefresh();
      if (!mounted.current) return;
      if (failed.length > 0) { setRemainingPrimary(failed); toast.error("Primærleverandør kunne fortsatt ikke settes for alle varer."); return; }
      setRemainingPrimary(null);
      toast.success("Primærleverandør satt");
      onOpenChange(false);
    },
  });
  const locked = split !== null || remainingPrimary !== null;

  const start = () => {
    if (lock.current || locked) return;
    lock.current = true;
    apply.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Avslutt forhandling</DialogTitle></DialogHeader>
        <div className="max-h-[60vh] space-y-3 overflow-auto">
          {items.map((it) => {
            const p = picks[it.id] ?? { winner_recipient_id: null, set_as_primary: false, apply_to_supplier: true };
            const offers = responses.filter((r) => r.negotiation_item_id === it.id && r.status === "submitted");
            const name = rmName(it.raw_material_id);
            const set = (next: Partial<Pick>) => setPicks((all) => ({ ...all, [it.id]: { ...p, ...next } }));
            return (
              <div key={it.id} className="rounded-md border border-line-subtle p-3">
                <div className="font-medium">{name}</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-3 sm:items-center">
                  <Select value={p.winner_recipient_id ?? "none"} disabled={locked} onValueChange={(v) => set({ winner_recipient_id: v === "none" ? null : v })}>
                    <SelectTrigger className="min-h-[44px]" aria-label={`Vinner for ${name}`}><SelectValue placeholder="Vinner" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Ingen vinner</SelectItem>
                      {offers.map((o) => {
                        const rec = recipients.find((rr) => rr.id === o.recipient_id);
                        const unit = rmBaseUnit(it.raw_material_id);
                        return (
                          <SelectItem key={o.recipient_id} value={o.recipient_id}>
                            {supName(rec?.supplier_id ?? "")} — {formatNok(o.offered_price)}{unit ? `/${unit}` : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <Checkbox checked={p.apply_to_supplier} disabled={locked} onCheckedChange={(v) => set({ apply_to_supplier: !!v })} />
                    Oppdater leverandørpris
                  </label>
                  <label className="flex min-h-[44px] items-center gap-2 text-sm">
                    <Checkbox checked={p.set_as_primary} disabled={locked} onCheckedChange={(v) => set({ set_as_primary: !!v })} />
                    Sett som primær
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        {split && (
          <div role="alert" className="space-y-1 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="font-medium">Noen endringer kan være lagret.</p>
            {split.kind === "partial" && split.linksOpen && <p>Forhandlingen er avsluttet, men leverandørlenkene er ikke stengt.</p>}
            {split.kind === "partial" && split.failures.length > 0 && (
              <ul className="list-disc pl-5">{split.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
            )}
            {split.kind === "unknown" && <p>Utfallet er ukjent, og det finnes ingen kvittering. Status hentes på nytt i bakgrunnen; kontroller forhandlingen før du gjør noe mer.</p>}
            <p>Ingenting prøves på nytt automatisk.</p>
          </div>
        )}
        {remainingPrimary && (
          <div role="alert" className="space-y-2 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm">
            <p className="font-medium">Utfallet er lagret, men primærleverandør ble ikke satt for:</p>
            <ul className="list-disc pl-5">
              {remainingPrimary.map((t) => <li key={t.rawMaterialId}>{rmName(t.rawMaterialId)} → {supName(t.supplierId)}</li>)}
            </ul>
            <Button size="sm" className="min-h-[44px]" disabled={retryPrimary.isPending} onClick={() => retryPrimary.mutate(remainingPrimary)}>
              {retryPrimary.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Sett gjenstående primærleverandør
            </Button>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="min-h-[44px]" onClick={() => onOpenChange(false)}>{locked ? "Lukk" : "Avbryt"}</Button>
          <Button className="min-h-[44px]" onClick={start} disabled={apply.isPending || locked}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Avslutt og lagre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
