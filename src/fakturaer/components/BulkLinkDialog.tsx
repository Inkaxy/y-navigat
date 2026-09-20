import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  package_size: number | null;
  package_unit: string | null;
  count_per_package: number | null;
  raw_material_id: string | null;
  match_confidence: string | null;
  eligible: boolean;
  exclusion_reason: string | null;
}

interface ApplyResult {
  applied_count?: number;
  skipped?: { line_id: string; reason: string }[];
  invoice_ids?: string[];
}

/** Query-nøklene køen faktisk bruker (useReviewLines / useReviewCount). */
export const REVIEW_QUERY_KEYS = ["fakturaer-review-lines", "fakturaer-review-count"] as const;

/** Menneskelig forklaring på hvorfor en linje ikke kan kobles herfra. */
const EXCLUSION_LABELS: Record<string, string> = {
  faktura_last: "fakturaen er låst (avstemt, flagget eller kansellert)",
  faktura_flagget: "fakturaen er flagget for oppfølging",
  kreditnota: "linjen står på en kreditnota",
  annen_valuta: "fakturaen er i en annen valuta enn kroner",
  merket_ikke_aktuell: "linjen er merket som ikke aktuell",
  koblet_til_annen_vare: "linjen er allerede koblet manuelt til en annen vare",
  tvetydig_alias: "samme varenummer eller navn peker på flere varer",
  annen_pakning: "pakningen er en annen (størrelse, enhet eller antall per kartong)",
  ukjent_pakning: "pakningen er ikke bekreftet, så kiloprisen kan ikke regnes",
  ikke_lenger_aktuell: "linjen var ikke lenger aktuell da koblingen ble brukt",
};

function exclusionText(reason: string | null): string {
  if (!reason) return "ukjent grunn";
  return EXCLUSION_LABELS[reason] ?? reason;
}

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
        <DialogHeader>
          <DialogTitle>Bruk koblingen på flere linjer</DialogTitle>
          <DialogDescription>
            Andre linjer fra samme leverandør som ser ut til å være <strong>{rawMaterialName}</strong>. Velg selv hvilke
            som skal kobles — ingenting blir koblet automatisk, og prisen regnes om etterpå.
          </DialogDescription>
        </DialogHeader>

        {pendingInvoices.length > 0 ? (
          <div className="space-y-3 rounded-md border border-warning/40 bg-warning/5 p-4">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <span>
                {appliedCount} linjer er koblet, men prisen er <strong>ikke</strong> regnet om for{" "}
                {pendingInvoices.length} faktura(er). Linjene står merket «må beregnes på nytt» og kan ikke avstemmes før
                beregningen er kjørt.
              </span>
            </p>
            <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
              {retry.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Prøv beregningen på nytt
            </Button>
          </div>
        ) : (
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
                    disabled={!r.eligible || busy}
                    onCheckedChange={(v) => setSelected((s) => ({ ...s, [r.line_id]: v === true }))}
                    aria-label={`Velg linje ${r.description ?? r.line_id}`}
                  />
                  <span className="flex-1">
                    <span className="block font-medium">{r.description ?? "Uten beskrivelse"}</span>
                    <span className="block text-caption text-ink-secondary">
                      {r.invoice_number ?? "—"} · {formatDate(r.invoice_date)} · {r.quantity ?? "—"} {r.unit ?? ""}
                      {r.supplier_sku ? ` · varenr. ${r.supplier_sku}` : ""}
                      {r.package_size != null ? ` · pakning ${r.package_size} ${r.package_unit ?? ""}` : ""}
                      {r.count_per_package != null ? ` · ${r.count_per_package} per kartong` : ""}
                    </span>
                    {!r.eligible && (
                      <span className="block text-caption text-warning">
                        Kan ikke kobles herfra: {exclusionText(r.exclusion_reason)}
                      </span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </QueryState>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy || pendingInvoices.length > 0}>
            Lukk
          </Button>
          {pendingInvoices.length === 0 && (
            <Button onClick={() => apply.mutate()} disabled={busy || chosen.length === 0}>
              {apply.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Koble {chosen.length} linjer
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
