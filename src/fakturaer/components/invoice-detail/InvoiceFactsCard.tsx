import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw, Wrench, Calculator } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { formatDate, formatNok } from "@/fakturaer/lib/constants";
import { parseRepairVat } from "@/fakturaer/lib/parseRpcJson";
import { confidenceLabel, linesSourceLabel, repairVatMessage, sumCheck } from "@/fakturaer/lib/invoiceFacts";
import { invalidateInvoice } from "@/ravarer/lib/invalidate";
import { cn } from "@/lib/utils";

export interface InvoiceFacts {
  id: string;
  legal_entity_id: string;
  status: string;
  total_amount: number | null;
  total_vat: number | null;
  vat_inferred: boolean | null;
  tripletex_voucher_number: string | null;
  tripletex_is_paid: boolean | null;
  paid_at: string | null;
  lines_sum_excl_vat: number | null;
  lines_sum_variance_pct: number | null;
  lines_sum_status: string | null;
  extraction_confidence: number | null;
  line_extraction_attempts: number | null;
  lines_source: string | null;
}

const Row = ({ k, children }: { k: string; children: React.ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3 py-1"><dt className="text-ink-secondary">{k}</dt><dd className="text-right tabular-nums">{children}</dd></div>
);

/** Ren visning av «Tripletex mot faktura». */
export function InvoiceFactsView({ invoice: d, actions }: { invoice: InvoiceFacts; actions?: React.ReactNode }) {
  const net = d.total_amount != null ? d.total_amount - (d.total_vat ?? 0) : null;
  const chk = sumCheck(d.lines_sum_variance_pct);
  const conf = d.extraction_confidence;
  return (
    <Card className="space-y-3 p-5">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-ink-secondary">Tripletex mot faktura</h3>
      <div className="grid gap-5 md:grid-cols-2">
        <section>
          <h4 className="mb-1 text-caption font-semibold">Fra Tripletex</h4>
          <dl className="divide-y divide-line-subtle text-sm">
            <Row k="Beløp inkl. mva">{formatNok(d.total_amount)}</Row>
            <Row k="Mva">{formatNok(d.total_vat)}{d.vat_inferred && <span className="ml-1.5 rounded border border-line-subtle px-1 text-[11px] text-ink-secondary">utledet</span>}</Row>
            <Row k="Netto">{formatNok(net)}</Row>
            <Row k="Bilagsnr">{d.tripletex_voucher_number ?? "—"}</Row>
            <Row k="Betalt">{d.tripletex_is_paid ? (d.paid_at ? `Ja, ${formatDate(d.paid_at)}` : "Ja") : d.tripletex_is_paid === false ? "Nei" : "—"}</Row>
          </dl>
        </section>
        <section>
          <h4 className="mb-1 text-caption font-semibold">Fra fakturalinjene</h4>
          <dl className="divide-y divide-line-subtle text-sm">
            <Row k="Linjesum eks. mva">{formatNok(d.lines_sum_excl_vat)}</Row>
            <Row k="Avvik mot netto">
              {d.lines_sum_variance_pct != null && `${d.lines_sum_variance_pct.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} % `}
              <span className={cn(chk.tone === "success" && "text-success", chk.tone === "danger" && "text-destructive", chk.tone === "muted" && "text-ink-secondary")}>{chk.label}</span>
            </Row>
            <Row k="Lesesikkerhet">{conf == null ? "—" : `${confidenceLabel(conf)} (${Math.round(conf * 100)} %)`}</Row>
            <Row k="Forsøk">{d.line_extraction_attempts ?? 0}</Row>
            <Row k="Linjekilde">{linesSourceLabel(d.lines_source)}</Row>
          </dl>
        </section>
      </div>
      {actions && <div className="flex flex-wrap gap-2 border-t border-line-subtle pt-3">{actions}</div>}
    </Card>
  );
}

export function InvoiceFactsCard({ invoice, canWrite, fetchingLines, onFetchLines }: { invoice: InvoiceFacts; canWrite: boolean; fetchingLines: boolean; onFetchLines: () => void }) {
  const qc = useQueryClient();
  const [repairMsg, setRepairMsg] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const locked = invoice.status === "reconciled" || invoice.status === "flagged";

  const repair = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("rm_repair_invoice_vat", { p_invoice_id: invoice.id });
      if (error) throw error;
      return parseRepairVat(data);
    },
    onSuccess: (r) => { setRepairMsg(repairVatMessage(r)); if (r.ok) invalidateInvoice(qc, invoice.id); },
    onError: (e) => showError("faktura-rett-mva", e, "Kunne ikke rette mva-avviket"),
  });
  const rematch = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("rm_rematch_invoices", { p_legal_entity_id: invoice.legal_entity_id, p_invoice_ids: [invoice.id], p_limit: 1, p_only_open: true });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Fakturaen er lagt i kø — oppdateres om litt");
      [10_000, 30_000].forEach((ms) => timers.current.push(window.setTimeout(() => invalidateInvoice(qc, invoice.id), ms)));
    },
    onError: (e) => showError("faktura-beregn-pa-nytt", e, "Kunne ikke legge fakturaen i kø"),
  });

  const actions = canWrite ? (
    <>
      <Button size="sm" variant="outline" disabled={fetchingLines} onClick={onFetchLines}>
        {fetchingLines ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-1.5 h-4 w-4" aria-hidden />}Hent linjer på nytt
      </Button>
      {invoice.lines_sum_status === "mismatch" && (
        <Button size="sm" variant="outline" disabled={repair.isPending} onClick={() => repair.mutate()}>
          {repair.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Wrench className="mr-1.5 h-4 w-4" aria-hidden />}Rett mva-avvik
        </Button>
      )}
      <Button size="sm" variant="outline" disabled={locked || rematch.isPending} onClick={() => rematch.mutate()}>
        {rematch.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : <Calculator className="mr-1.5 h-4 w-4" aria-hidden />}Beregn på nytt
      </Button>
      {repairMsg && <p role="status" className="w-full text-sm text-ink-secondary">{repairMsg}</p>}
    </>
  ) : null;
  return <InvoiceFactsView invoice={invoice} actions={actions} />;
}
