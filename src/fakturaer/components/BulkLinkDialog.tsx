import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { formatDate } from "@/fakturaer/lib/constants";

interface Candidate {
  line_id: string;
  invoice_id: string;
  invoice_number: string | null;
  invoice_date: string | null;
  description: string | null;
  supplier_sku: string | null;
  quantity: number | null;
  unit: string | null;
  total_amount: number | null;
  eligible: boolean;
  exclusion_reason: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Leverandørkoblingen brukeren nettopp bekreftet. */
  rmsId: string | null;
  rawMaterialName: string;
  onApplied?: () => void;
}

/**
 * Tilbyr den nettopp bekreftede koblingen på andre linjer med samme vare fra
 * samme leverandør. Ingenting brukes automatisk: brukeren ser hver linje, og
 * linjer databasen ikke godtar vises med grunnen sin i stedet for å skjules.
 */
export function BulkLinkDialog({ open, onOpenChange, rmsId, rawMaterialName, onApplied }: Props) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const query = useQuery({
    queryKey: ["rm-supplier-link-candidates", rmsId],
    enabled: open && !!rmsId,
    queryFn: async () => {
      const [{ data, error }, link] = await Promise.all([
        supabase.rpc("rm_supplier_link_candidates", { p_rms_id: rmsId! }),
        supabase.from("raw_material_suppliers").select("updated_at").eq("id", rmsId!).maybeSingle(),
      ]);
      if (error) throw error;
      if (link.error) throw link.error;
      const rows = ((data ?? []) as Candidate[]).filter((c) => c.line_id);
      setSelected(Object.fromEntries(rows.filter((r) => r.eligible).map((r) => [r.line_id, true])));
      return { rows, updatedAt: (link.data?.updated_at as string | null) ?? null };
    },
  });

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const eligible = rows.filter((r) => r.eligible);
  const chosen = eligible.filter((r) => selected[r.line_id]);

  const apply = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rm_apply_supplier_link_lines", {
        p_rms_id: rmsId!,
        p_line_ids: chosen.map((r) => r.line_id),
        // Optimistisk lås: er koblingen endret siden forhåndsvisningen, avbryter databasen.
        p_expected_updated_at: query.data?.updatedAt ?? undefined,
      });
      if (error) throw error;
      return (data ?? {}) as { applied_count?: number; skipped?: { line_id: string; reason: string }[] };
    },
    onSuccess: async (res) => {
      const skipped = res.skipped?.length ?? 0;
      toast.success(
        `${res.applied_count ?? 0} linjer koblet til ${rawMaterialName}` +
          (skipped > 0 ? ` — ${skipped} ble hoppet over og står fortsatt til gjennomgang.` : ""),
      );
      // Prisavviket må regnes om for de fakturaene linjene tilhører.
      const invoiceIds = [...new Set(chosen.map((r) => r.invoice_id))];
      for (const invoiceId of invoiceIds) {
        const { error } = await supabase.functions.invoke("match-invoice-lines", { body: { invoice_id: invoiceId } });
        if (error) console.warn(`Reberegning feilet for faktura ${invoiceId}: ${error.message}`);
      }
      await qc.invalidateQueries({ queryKey: ["review-lines"] });
      await qc.invalidateQueries({ queryKey: ["review-line-counts"] });
      onApplied?.();
      onOpenChange(false);
    },
    onError: (e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Kunne ikke koble linjene");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Bruk koblingen på flere linjer</DialogTitle>
          <DialogDescription>
            Andre linjer fra samme leverandør som ser ut til å være <strong>{rawMaterialName}</strong>. Velg selv hvilke
            som skal kobles — ingenting blir koblet automatisk.
          </DialogDescription>
        </DialogHeader>

        <QueryState
          scope="fakturaer:massekobling"
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          isEmpty={rows.length === 0}
          emptyTitle="Ingen andre linjer peker på denne varen"
          onRetry={() => void query.refetch()}
        >
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {rows.map((r) => (
              <label
                key={r.line_id}
                className="flex items-start gap-3 rounded-md border border-line-subtle px-3 py-2 text-sm"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={!!selected[r.line_id]}
                  disabled={!r.eligible}
                  onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.line_id]: v === true }))}
                  aria-label={`Velg linje ${r.description ?? r.line_id}`}
                />
                <span className="flex-1">
                  <span className="block font-medium">{r.description ?? "Uten beskrivelse"}</span>
                  <span className="block text-caption text-ink-secondary">
                    {r.invoice_number ?? "—"} · {formatDate(r.invoice_date)} · {r.quantity ?? "—"} {r.unit ?? ""}
                    {r.supplier_sku ? ` · varenr. ${r.supplier_sku}` : ""}
                  </span>
                  {!r.eligible && (
                    <span className="block text-caption text-warning">
                      Kan ikke kobles herfra: {r.exclusion_reason ?? "ukjent grunn"}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
        </QueryState>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={apply.isPending}>
            Lukk
          </Button>
          <Button onClick={() => apply.mutate()} disabled={apply.isPending || chosen.length === 0}>
            {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Koble {chosen.length} linjer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
