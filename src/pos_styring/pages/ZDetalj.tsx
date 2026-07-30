import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, AlertTriangle, ArrowLeft, Download, Lock, Printer, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

import RapportSummary, {
  CashSummary,
  GrandTotal,
  JournalCounts,
  MvaBreakdownEntry,
  PaymentBreakdownEntry,
  RapportTotals,
} from "@/pos_styring/components/RapportSummary";

interface SessionBreakdownRow {
  session_id: string;
  session_number: number;
  operator_id: string | null;
  opening_float: number;
  closing_float: number;
  counted_cash: number;
  expected_cash: number;
  cash_variance: number;
  opened_at: string;
  closed_at: string | null;
}

interface ZRow {
  id: string;
  terminal_id: string;
  z_number: number;
  closed_at: string;
  period_start: string;
  period_end: string;
  total_sales_incl_mva: number;
  total_sales_excl_mva: number;
  total_mva: number;
  mva_breakdown: MvaBreakdownEntry[];
  payment_breakdown: PaymentBreakdownEntry[];
  transaction_count: number;
  sale_count: number;
  refund_count: number;
  refund_total: number;
  correction_count: number;
  correction_total: number;
  discount_count: number;
  discount_total: number;
  receipt_count: number;
  receipt_copy_count: number;
  proforma_view_count: number;
  drawer_open_outside_sale_count: number;
  first_receipt_number: string | null;
  last_receipt_number: string | null;
  grand_total_gross_after: number | null;
  grand_total_returns_after: number | null;
  grand_total_tx_count_after: number | null;
  opening_float_total: number | null;
  closing_float_total: number | null;
  counted_cash_total: number | null;
  expected_cash_total: number | null;
  cash_variance_total: number | null;
  variance_flagged: boolean;
  variance_threshold: number | null;
  session_breakdown: SessionBreakdownRow[];
  last_journal_id: number;
  report_hash: string;
  terminal_code: string;
  terminal_name: string;
  legal_entity_name: string | null;
  legal_entity_org_number: string | null;
}

function zRowToTotals(z: ZRow): RapportTotals {
  return {
    gross: z.total_sales_incl_mva,
    net: z.total_sales_excl_mva,
    mva: z.total_mva,
    transaction_count: z.transaction_count,
    refund_count: z.refund_count,
    refund_total: z.refund_total,
    sale_count: z.sale_count,
    correction_count: z.correction_count,
    correction_total: z.correction_total,
    discount_count: z.discount_count,
    discount_total: z.discount_total,
    receipt_count: z.receipt_count,
    first_receipt_number: z.first_receipt_number,
    last_receipt_number: z.last_receipt_number,
  };
}

function zRowToJournalCounts(z: ZRow): JournalCounts {
  return {
    receipt_copy: z.receipt_copy_count,
    proforma_view: z.proforma_view_count,
    drawer_open_outside_sale: z.drawer_open_outside_sale_count,
  };
}

function zRowToCashSummary(z: ZRow): CashSummary {
  return {
    opening_float: z.opening_float_total ?? 0,
    closing_float: z.closing_float_total ?? 0,
    counted_cash: z.counted_cash_total ?? 0,
    expected_cash: z.expected_cash_total ?? 0,
    cash_variance: z.cash_variance_total ?? 0,
  };
}

function zRowToGrandTotal(z: ZRow): GrandTotal | undefined {
  if (z.grand_total_gross_after == null) return undefined;
  return {
    gross: z.grand_total_gross_after,
    returns: z.grand_total_returns_after ?? 0,
    tx_count: z.grand_total_tx_count_after ?? 0,
  };
}

async function fetchZ(id: string): Promise<ZRow | null> {
  const { data, error } = await supabase
    .from("pos_z_reports")
    .select(
      `id, terminal_id, z_number, closed_at, period_start, period_end,
       total_sales_incl_mva, total_sales_excl_mva, total_mva,
       mva_breakdown, payment_breakdown,
       transaction_count, sale_count, refund_count, refund_total,
       correction_count, correction_total, discount_count, discount_total,
       receipt_count, receipt_copy_count, proforma_view_count, drawer_open_outside_sale_count,
       first_receipt_number, last_receipt_number,
       grand_total_gross_after, grand_total_returns_after, grand_total_tx_count_after,
       opening_float_total, closing_float_total, counted_cash_total, expected_cash_total,
       cash_variance_total, variance_flagged, variance_threshold, session_breakdown,
       last_journal_id, report_hash,
       terminal:pos_terminals(terminal_code, display_name, legal_entity:legal_entities(display_name, org_number))`
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id,
    terminal_id: r.terminal_id,
    z_number: Number(r.z_number),
    closed_at: r.closed_at,
    period_start: r.period_start,
    period_end: r.period_end,
    total_sales_incl_mva: Number(r.total_sales_incl_mva),
    total_sales_excl_mva: Number(r.total_sales_excl_mva),
    total_mva: Number(r.total_mva),
    mva_breakdown: (r.mva_breakdown ?? []) as MvaBreakdownEntry[],
    payment_breakdown: (r.payment_breakdown ?? []) as PaymentBreakdownEntry[],
    transaction_count: Number(r.transaction_count),
    sale_count: Number(r.sale_count ?? 0),
    refund_count: Number(r.refund_count),
    refund_total: Number(r.refund_total),
    correction_count: Number(r.correction_count ?? 0),
    correction_total: Number(r.correction_total ?? 0),
    discount_count: Number(r.discount_count ?? 0),
    discount_total: Number(r.discount_total ?? 0),
    receipt_count: Number(r.receipt_count ?? 0),
    receipt_copy_count: Number(r.receipt_copy_count ?? 0),
    proforma_view_count: Number(r.proforma_view_count ?? 0),
    drawer_open_outside_sale_count: Number(r.drawer_open_outside_sale_count ?? 0),
    first_receipt_number: r.first_receipt_number ?? null,
    last_receipt_number: r.last_receipt_number ?? null,
    grand_total_gross_after: r.grand_total_gross_after != null ? Number(r.grand_total_gross_after) : null,
    grand_total_returns_after: r.grand_total_returns_after != null ? Number(r.grand_total_returns_after) : null,
    grand_total_tx_count_after: r.grand_total_tx_count_after != null ? Number(r.grand_total_tx_count_after) : null,
    opening_float_total: r.opening_float_total != null ? Number(r.opening_float_total) : null,
    closing_float_total: r.closing_float_total != null ? Number(r.closing_float_total) : null,
    counted_cash_total: r.counted_cash_total != null ? Number(r.counted_cash_total) : null,
    expected_cash_total: r.expected_cash_total != null ? Number(r.expected_cash_total) : null,
    cash_variance_total: r.cash_variance_total != null ? Number(r.cash_variance_total) : null,
    variance_flagged: Boolean(r.variance_flagged),
    variance_threshold: r.variance_threshold != null ? Number(r.variance_threshold) : null,
    session_breakdown: (r.session_breakdown ?? []) as SessionBreakdownRow[],
    last_journal_id: Number(r.last_journal_id),
    report_hash: r.report_hash,
    terminal_code: r.terminal?.terminal_code ?? "?",
    terminal_name: r.terminal?.display_name ?? "?",
    legal_entity_name: r.terminal?.legal_entity?.name ?? null,
    legal_entity_org_number: r.terminal?.legal_entity?.org_number ?? null,
  };
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fmtMoney(n: number | null | undefined) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(Number(n ?? 0));
}

export default function ZDetalj() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const q = useQuery({
    queryKey: ["pos_z_report", id],
    queryFn: () => fetchZ(id!),
    enabled: !!id,
  });

  if (q.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (q.error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{(q.error as Error).message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const z = q.data;
  if (!z) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/rapporter?tab=z")}>
          <ArrowLeft className="h-4 w-4" /> Tilbake
        </Button>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Z-rapporten finnes ikke eller du har ikke tilgang.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 print:p-0">
      <div className="print:hidden">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/rapporter?tab=z")}>
          <ArrowLeft className="h-4 w-4" /> Tilbake til rapporter
        </Button>
      </div>

      {/* Utskriftshode */}
      <div className="hidden print:block border-b pb-4 mb-4">
        <div className="text-lg font-semibold">{z.legal_entity_name ?? "—"}</div>
        {z.legal_entity_org_number && (
          <div className="text-sm">Org.nr {z.legal_entity_org_number}</div>
        )}
        <div className="text-sm mt-2">
          Z-RAPPORT #{z.z_number} · Kasse {z.terminal_code} ({z.terminal_name})
        </div>
        <div className="text-xs">
          Periode: {format(new Date(z.period_start), "yyyy-MM-dd HH:mm")} →{" "}
          {format(new Date(z.period_end), "yyyy-MM-dd HH:mm")}
        </div>
        <div className="text-xs">
          Generert: {format(new Date(z.closed_at), "yyyy-MM-dd HH:mm:ss")}
        </div>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4 print:hidden">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight">Z-rapport #{z.z_number}</h1>
            {z.report_hash && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="border-success/30 bg-success/10 text-success gap-1">
                    <ShieldCheck className="h-3 w-3" /> Hash verifisert
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <span className="font-mono text-xs">{z.report_hash}</span>
                </TooltipContent>
              </Tooltip>
            )}
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" /> Sesjoner låst
            </Badge>
            {z.variance_flagged && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive gap-1">
                <AlertTriangle className="h-3 w-3" /> Kontantavvik flagget
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{z.terminal_code}</span> · {z.terminal_name}
            {z.legal_entity_name ? ` · ${z.legal_entity_name}` : ""}
            {z.legal_entity_org_number ? ` (org.nr ${z.legal_entity_org_number})` : ""}
          </p>
          <p className="text-sm text-muted-foreground">
            Periode: {format(new Date(z.period_start), "yyyy-MM-dd HH:mm")} →{" "}
            {format(new Date(z.period_end), "yyyy-MM-dd HH:mm")}
          </p>
          <p className="text-sm text-muted-foreground">
            Generert: {format(new Date(z.closed_at), "yyyy-MM-dd HH:mm:ss")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => downloadJson(`z-rapport-${z.z_number}.json`, z)}>
            <Download className="h-4 w-4" /> Eksporter JSON
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> Skriv ut / PDF
          </Button>
        </div>
      </div>

      {z.variance_flagged && (
        <Alert variant="destructive" className="print:hidden">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Kontantavvik på {fmtMoney(z.cash_variance_total ?? 0)} overstiger grensen på{" "}
            {fmtMoney(z.variance_threshold ?? 0)}.
          </AlertDescription>
        </Alert>
      )}

      <RapportSummary
        totals={zRowToTotals(z)}
        mva_breakdown={z.mva_breakdown}
        payment_breakdown={z.payment_breakdown}
        journal_counts={zRowToJournalCounts(z)}
        cash_summary={zRowToCashSummary(z)}
        grand_total={zRowToGrandTotal(z)}
      />

      {/* Sesjonsfordeling */}
      {z.session_breakdown.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Sesjoner i perioden (låst)
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sesjon</TableHead>
                <TableHead>Åpnet</TableHead>
                <TableHead>Lukket</TableHead>
                <TableHead className="text-right">Vekslekasse inn</TableHead>
                <TableHead className="text-right">Vekslekasse ut</TableHead>
                <TableHead className="text-right">Forventet</TableHead>
                <TableHead className="text-right">Opptalt</TableHead>
                <TableHead className="text-right">Avvik</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {z.session_breakdown.map((s) => (
                <TableRow key={s.session_id}>
                  <TableCell className="font-mono">#{s.session_number}</TableCell>
                  <TableCell className="text-xs">
                    {format(new Date(s.opened_at), "yyyy-MM-dd HH:mm")}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.closed_at ? format(new Date(s.closed_at), "yyyy-MM-dd HH:mm") : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(s.opening_float)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(s.closing_float)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(s.expected_cash)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmtMoney(s.counted_cash)}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right tabular-nums font-medium " +
                      (Math.abs(s.cash_variance ?? 0) > 0 ? "text-destructive" : "")
                    }
                  >
                    {fmtMoney(s.cash_variance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      <Card className="p-4 print:hidden">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
          Diagnostisk
        </div>
        <div className="grid gap-2 sm:grid-cols-2 text-xs font-mono">
          <div>
            <span className="text-muted-foreground">last_journal_id:</span> {z.last_journal_id}
          </div>
          <div className="truncate">
            <span className="text-muted-foreground">report_hash:</span> {z.report_hash}
          </div>
        </div>
      </Card>
    </div>
  );
}
