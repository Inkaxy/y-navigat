import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import { parseRematchQueued } from "@/fakturaer/lib/parseRpcJson";
import { supabase } from "@/integrations/supabase/client";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";

type Props = { open: boolean; onOpenChange: (v: boolean) => void; legalEntityId: string | null; canWrite: boolean };

/**
 * «Beregn alle åpne på nytt»: forklaring, køstatus (oppdateres hvert 10. s mens
 * noe er i kø) og `rm_rematch_invoices`. Én implementasjon — brukes fra
 * Priskontroll › Verktøy og Innstillinger › Priskontroll.
 */
export function RematchAllDialog({ open, onOpenChange, legalEntityId, canWrite }: Props) {
  const qc = useQueryClient();
  const status = useRematchStatus(open ? legalEntityId : null);
  const busy = !!status.data && status.data.queued + status.data.in_flight > 0;
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rm_rematch_invoices", { p_legal_entity_id: legalEntityId as string, p_limit: 500, p_only_open: true });
      if (error) throw new Error("Kunne ikke starte ny beregning. Prøv igjen.");
      return parseRematchQueued(data).queued;
    },
    onSuccess: () => { invalidateRavarerCounts(qc); void qc.invalidateQueries({ queryKey: ["rematch-status"] }); },
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) run.reset(); onOpenChange(v); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Beregn alle åpne fakturaer på nytt</DialogTitle>
          <DialogDescription>
            Alle åpne fakturaer legges i kø og kjøres gjennom matchemotoren med dagens innstillinger, koblinger og priser. Avstemte fakturaer røres ikke. Køen arbeider i bakgrunnen — du kan lukke vinduet.
          </DialogDescription>
        </DialogHeader>
        <div role="status" className="rounded-md bg-muted/40 p-3 text-sm tabular-nums">
          {status.isLoading ? "Henter køstatus …" : status.isError ? "Kunne ikke hente køstatus." : status.data
            ? `${status.data.queued} i kø · ${status.data.in_flight} under arbeid · ${status.data.done_last_hour} ferdige siste time · ${status.data.failed_last_day} feilet siste døgn`
            : "—"}
        </div>
        {run.isSuccess && <p role="status" className="text-sm text-success">{run.data > 0 ? `${run.data} fakturaer er lagt i kø — oppdateres om litt` : "Ingen åpne fakturaer måtte beregnes på nytt"}</p>}
        {run.isError && <p role="alert" className="text-sm text-destructive">{run.error.message}</p>}
        {!canWrite && <p className="text-sm text-ink-secondary">Krever skrivetilgang til fakturaer.</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Lukk</Button>
          <Button disabled={!canWrite || !legalEntityId || busy || run.isPending} onClick={() => run.mutate()}>
            {(run.isPending || busy) && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Omberegning pågår …" : "Legg alle åpne i kø"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
