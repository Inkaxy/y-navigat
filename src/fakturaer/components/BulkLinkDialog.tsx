import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { BulkLinkPanel, type BulkLinkCandidate } from "@/fakturaer/components/BulkLinkPanel";

/** Gjenbruk av teksten for hvorfor en linje ikke kan kobles. */
export { EXCLUSION_LABELS, exclusionText } from "@/fakturaer/components/BulkLinkPanel";

type Candidate = BulkLinkCandidate;

interface ApplyResult {
  applied_count?: number;
  skipped?: { line_id: string; reason: string }[];
  invoice_ids?: string[];
}

/** Query-nøklene køen faktisk bruker (useReviewLines / useReviewCount). */
export const REVIEW_QUERY_KEYS = ["fakturaer-review-lines", "fakturaer-review-count"] as const;

async function recalculateInvoices(invoiceIds: readonly string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const invoiceId of invoiceIds) {
    const { error } = await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: invoiceId } });
    if (error) failed.push(invoiceId);
  }
  return failed;
}

/**
 * Tilbyr den nettopp bekreftede koblingen på andre linjer med samme vare fra
 * samme leverandør. Ingenting brukes automatisk: brukeren ser hver linje, og
 * linjer databasen ikke godtar vises med grunnen sin i stedet for å skjules.
 *
 * Databasen nullstiller IKKE varslene: linjene står som «må beregnes på nytt»
 * til match-invoice-lines faktisk har regnet dem om. Feiler omregningen, sier
 * vi det rett ut og tilbyr et nytt forsøk — vi melder aldri falsk suksess.
 */
export function BulkLinkDialog({
  open,
  onOpenChange,
  rmsId,
  rawMaterialName,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Leverandørkoblingen brukeren nettopp bekreftet. */
  rmsId: string | null;
  rawMaterialName: string;
  onApplied?: () => void;
}) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [pendingInvoices, setPendingInvoices] = useState<string[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);

  const invalidateQueue = async () => {
    for (const key of REVIEW_QUERY_KEYS) await qc.invalidateQueries({ queryKey: [key] });
  };

  const query = useQuery({
    queryKey: ["rm-supplier-link-candidates", rmsId],
    enabled: open && !!rmsId,
    queryFn: async () => {
      const [{ data, error }, snap] = await Promise.all([
        supabase.rpc("rm_supplier_link_candidates", { p_rms_id: rmsId! }),
        supabase.rpc("rm_supplier_link_snapshot", { p_rms_id: rmsId! }),
      ]);
      if (error) throw error;
      if (snap.error) throw snap.error;
      const rows = ((data ?? []) as Candidate[]).filter((c) => c.line_id);
      setSelected(Object.fromEntries(rows.filter((r) => r.eligible).map((r) => [r.line_id, true])));
      return { rows, snapshot: (snap.data as string | null) ?? null };
    },
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const eligible = rows.filter((r) => r.eligible);
  const chosen = eligible.filter((r) => selected[r.line_id]);

  const finish = async (applied: number, skipped: number) => {
    await invalidateQueue();
    toast.success(
      `${applied} linjer koblet til ${rawMaterialName} og regnet om` +
        (skipped > 0 ? ` — ${skipped} ble hoppet over og står fortsatt til gjennomgang.` : ""),
    );
    setPendingInvoices([]);
    onApplied?.();
    onOpenChange(false);
  };

  const apply = useMutation({
    mutationFn: async (): Promise<{ res: ApplyResult; failed: string[] }> => {
      const snapshot = query.data?.snapshot;
      if (!snapshot) throw new Error("Fant ikke grunnlaget for forhåndsvisningen — hent den på nytt.");
      const { data, error } = await supabase.rpc("rm_apply_supplier_link_lines", {
        p_rms_id: rmsId!,
        p_line_ids: [...new Set(chosen.map((r) => r.line_id))],
        // Kontrollverdien dekker kobling, aliaser og linjer: er noe endret, avbryter databasen.
        p_expected_snapshot: snapshot,
      });
      if (error) throw error;
      const res = (data ?? {}) as ApplyResult;
      const invoiceIds = res.invoice_ids ?? [...new Set(chosen.map((r) => r.invoice_id))];
      return { res, failed: await recalculateInvoices(invoiceIds) };
    },
    onSuccess: async ({ res, failed }) => {
      const applied = res.applied_count ?? 0;
      const skipped = res.skipped?.length ?? 0;
      setAppliedCount(applied);
      await invalidateQueue();
      if (failed.length > 0) {
        setPendingInvoices(failed);
        toast.error(
          `${applied} linjer ble koblet, men prisen er ikke regnet om for ${failed.length} faktura(er). ` +
            "Linjene står til gjennomgang til beregningen er kjørt.",
        );
        return;
      }
      await finish(applied, skipped);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Kunne ikke koble linjene");
    },
  });

  const retry = useMutation({
    mutationFn: async () => await recalculateInvoices(pendingInvoices),
    onSuccess: async (failed) => {
      await invalidateQueue();
      if (failed.length > 0) {
        setPendingInvoices(failed);
        toast.error(`Beregningen feilet fortsatt for ${failed.length} faktura(er).`);
        return;
      }
      await finish(appliedCount, 0);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Beregningen feilet"),
  });

  const busy = apply.isPending || retry.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => (busy ? undefined : onOpenChange(v))}>
      <DialogContent className="max-w-3xl">
        <BulkLinkPanel
          rawMaterialName={rawMaterialName}
          rows={rows}
          selected={selected}
          onToggle={(id, v) => setSelected((prev) => ({ ...prev, [id]: v }))}
          busy={busy}
          chosenCount={chosen.length}
          onApply={() => apply.mutate()}
          onClose={() => onOpenChange(false)}
          applyPending={apply.isPending}
          pendingInvoices={pendingInvoices}
          appliedCount={appliedCount}
          onRetry={() => retry.mutate()}
          retryPending={retry.isPending}
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetryLoad={() => void query.refetch()}
        />
      </DialogContent>
    </Dialog>
  );
}
