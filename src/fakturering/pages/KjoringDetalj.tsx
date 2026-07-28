import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Receipt, RotateCw, Undo2, ExternalLink, Pin, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  useInvoiceRun, useBasesForRun, useHasFakturaWriteAccess, type BasisRow,
} from "@/fakturering/hooks/useFakturering";
import { formatKr, groupDefFor } from "@/fakturering/lib/groups";
import { BasisStatusChip, tripletexInvoiceUrl, tripletexOrderUrl } from "@/fakturering/components/BasisStatusChip";
import { BasisDetailsDrawer } from "@/fakturering/components/BasisDetailsDrawer";
import { readEdgeError } from "@/fakturering/lib/edgeError";

export default function KjoringDetalj() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [drawerBasis, setDrawerBasis] = useState<BasisRow | null>(null);
  const [busy, setBusy] = useState<"retry" | "cancel" | null>(null);

  const runQ = useInvoiceRun(id);
  const run = runQ.data;
  const basesQ = useBasesForRun(id, run?.status === "running");
  const writeAccess = useHasFakturaWriteAccess();

  const bases = basesQ.data ?? [];

  const stats = useMemo(() => {
    let transferred = 0, invoiced = 0, failed = 0, skipped = 0;
    for (const b of bases) {
      if (b.status === "invoiced") invoiced++;
      else if (b.status === "transferred") transferred++;
      else if (b.status === "error") failed++;
      else if (b.status === "skipped" || b.status === "excluded" || !b.do_transfer) skipped++;
    }
    return { transferred, invoiced, failed, skipped };
  }, [bases]);

  const failedCount = stats.failed;

  async function retryFailed() {
    if (!id) return;
    setBusy("retry");
    try {
      const { error } = await supabase.functions.invoke("fakturering-transfer-run", { body: { run_id: id } });
      if (error) throw error;
      toast({ title: "Prøver igjen", description: "Overføring startet for feilede grunnlag." });
      qc.invalidateQueries({ queryKey: ["fakturering"] });
    } catch (e: any) {
      toast({ title: "Feil", description: await readEdgeError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function cancelRun() {
    if (!id) return;
    setBusy("cancel");
    try {
      const { error } = await (supabase.rpc as any)("cancel_invoice_run", { p_run_id: id });
      if (error) throw error;
      toast({ title: "Kjøring angret", description: "Ikke-overførte grunnlag er slettet og ordrene frigjort." });
      qc.invalidateQueries({ queryKey: ["fakturering"] });
    } catch (e: any) {
      toast({ title: "Kunne ikke angre kjøringen", description: await readEdgeError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  if (!id) return null;

  const isRunning = run?.status === "running";

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Fakturering" title={`Fakturakjøring #${id.slice(0, 8)}`} icon={Receipt}
        subtitle={run ? `${(run.groups ?? []).map((g) => groupDefFor(g).label).join(" + ")} · startet ${run.started_at ? format(new Date(run.started_at), "HH:mm") : "—"}` : ""}
        actions={
          <div className="flex gap-2">
            <Link to="/fakturering/kjoringer" className="text-sm text-muted-foreground hover:underline self-center">← Alle kjøringer</Link>
          </div>
        }
      />

      {isRunning && (
        <div className="flex items-center gap-3 rounded-xl border border-[hsl(var(--app-primary)/0.3)] bg-[hsl(var(--app-primary)/0.08)] px-4 py-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--app-primary))]" />
          Overføring pågår — oppdaterer live.
        </div>
      )}

      {/* Tellerkort */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Grunnlag" value={bases.length} />
        <StatCard label="Overført som utkast" value={stats.transferred} tone="emerald" />
        <StatCard label="Fakturert i Tripletex" value={stats.invoiced} tone="emerald" />
        <StatCard label="Feilet" value={stats.failed} tone={stats.failed > 0 ? "red" : "muted"} />
        <StatCard label="Hoppet over" value={stats.skipped} tone="muted" />
      </div>

      {/* Info-banner */}
      <div className="flex items-start gap-3 rounded-xl border border-[hsl(var(--app-primary)/0.3)] bg-[hsl(var(--app-primary)/0.08)] px-4 py-3 text-sm">
        <Pin className="mt-0.5 h-4 w-4 text-[hsl(var(--app-primary))]" />
        <div>
          Utkastene ligger i Tripletex under <strong>Ordre → Fakturering</strong>. Godkjenn og fakturer der — NBHub henter fakturanummer tilbake automatisk (sjekkes hvert 30. min).
        </div>
      </div>

      {/* Grunnlagstabell */}
      <div className="overflow-hidden rounded-xl border border-line-subtle bg-surface-raised">
        <table className="w-full text-sm">
          <thead className="bg-surface-sunken text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Grunnlag</th>
              <th className="px-3 py-2 text-left font-semibold">Kunde</th>
              <th className="px-3 py-2 text-right font-semibold">Ordrer</th>
              <th className="px-3 py-2 text-right font-semibold">Sum ink. mva</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-3 py-2 text-left font-semibold">Tripletex</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {bases.map((b) => {
              const txUrl = b.tripletex_invoice_id ? tripletexInvoiceUrl(b.tripletex_invoice_id) : tripletexOrderUrl(b.tripletex_order_id);
              return (
                <tr key={b.id} className="cursor-pointer hover:bg-surface-sunken/60" onClick={() => setDrawerBasis(b)}>
                  <td className="px-3 py-2 font-mono font-semibold">{b.basis_number || "—"}</td>
                  <td className="px-3 py-2">{b.customer?.display_name ?? "—"} ({b.customer?.customer_number ?? "?"})</td>
                  <td className="px-3 py-2 text-right tabular-nums">{b._order_count ?? 0}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatKr(Number(b.sum_incl_vat))}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-1">
                      <BasisStatusChip status={b.status} invoiceNumber={b.tripletex_invoice_number} errorMessage={b.transfer_error} doTransfer={b.do_transfer} />
                      {b.status === "error" && b.transfer_error && (
                        <div className="text-xs text-red-700 dark:text-red-400">{b.transfer_error}</div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {txUrl ? (
                      <a href={txUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-sm font-medium text-[hsl(var(--app-primary))] hover:underline">
                        TX-ordre {b.tripletex_order_id ?? b.tripletex_invoice_id} <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : <span className="text-muted-foreground">—</span>}
                  </td>
                </tr>
              );
            })}
            {!basesQ.isLoading && bases.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Ingen grunnlag i denne kjøringen.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Handlinger */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={retryFailed}
          disabled={!writeAccess.data || failedCount === 0 || busy !== null}
          className="bg-orange-600 text-white hover:bg-orange-700"
        >
          <RotateCw className={busy === "retry" ? "mr-2 h-4 w-4 animate-spin" : "mr-2 h-4 w-4"} />
          Prøv igjen — kun feilede ({failedCount})
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" disabled={!writeAccess.data || busy !== null}>
              <Undo2 className="mr-2 h-4 w-4" /> Angre kjøringen (kun ikke-overførte)
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Angre kjøringen?</AlertDialogTitle>
              <AlertDialogDescription>
                Ikke-overførte grunnlag slettes, og de tilhørende ordrene frigjøres slik at de kan fakturers på nytt.
                Overførte grunnlag beholdes urørt.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Avbryt</AlertDialogCancel>
              <AlertDialogAction onClick={cancelRun}>Angre kjøringen</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <span className="ml-auto text-xs text-muted-foreground">
          Ordrene i overførte grunnlag er markert som fakturert i NBHub.
        </span>
      </div>

      <BasisDetailsDrawer basis={drawerBasis} onOpenChange={(o) => !o && setDrawerBasis(null)} />
    </div>
  );
}

function StatCard({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "emerald" | "red" | "muted" }) {
  const color = tone === "emerald" ? "text-emerald-700 dark:text-emerald-400"
    : tone === "red" ? "text-red-700 dark:text-red-400"
    : tone === "muted" ? "text-muted-foreground" : "text-text-primary";
  return (
    <div className="rounded-xl border border-line-subtle bg-surface-raised px-4 py-3">
      <div className={`font-display text-3xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
    </div>
  );
}
