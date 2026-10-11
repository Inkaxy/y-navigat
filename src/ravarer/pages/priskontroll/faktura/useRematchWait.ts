import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { toast } from "sonner";
import { useRematchStatus } from "@/fakturaer/hooks/useRematchStatus";
import { useRematchInvoices } from "@/ravarer/pages/priskontroll/gjore/useGjoreMutations";

const POLL_MS = 5_000;

/**
 * «Beregn på nytt» for én faktura: legger den i kø, viser køstatus
 * (`rm_rematch_status`) og kaller `onDone` når køen er tom igjen.
 */
export function useRematchWait(legalEntityId: string | null, onDone: () => void) {
  const qc = useQueryClient();
  const rematch = useRematchInvoices();
  const status = useRematchStatus(legalEntityId);
  const [since, setSince] = useState<number | null>(null);
  const pending = status.data ? status.data.queued + status.data.in_flight : 0;

  useEffect(() => {
    if (since == null) return;
    const t = window.setInterval(() => void status.refetch(), POLL_MS);
    return () => window.clearInterval(t);
  }, [since, status]);

  useEffect(() => {
    if (since == null || !status.data || status.dataUpdatedAt <= since) return;
    if (pending > 0) return;
    setSince(null);
    // Ny beregning endrer prisstatus og tellere.
    invalidateRavarerCounts(qc);
    onDone();
    toast.success("Fakturaen er beregnet på nytt");
    // onDone er en ny funksjon hver render; vi reagerer bare på køstatusen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, status.data, status.dataUpdatedAt, pending]);

  const start = (invoiceId: string) => {
    rematch.mutate([invoiceId], {
      onSuccess: (r) => {
        if (r.queued || r.already_queued) {
          setSince(Date.now());
          void status.refetch();
          toast.info(r.queued ? "Fakturaen er lagt i kø for ny beregning" : "Fakturaen ligger allerede i kø");
        } else toast.info("Fakturaen kan ikke beregnes på nytt nå");
      },
      onError: (e: Error) => toast.error(e.message),
    });
  };

  const note = since != null ? (pending > 0 ? `Beregnes på nytt — ${pending} i kø` : "Beregnes på nytt …") : null;
  return { start, busy: rematch.isPending || since != null, note };
}
