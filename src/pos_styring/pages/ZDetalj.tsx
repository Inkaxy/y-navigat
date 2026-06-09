import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { AlertCircle, ArrowLeft, Download, Printer, ShieldCheck } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";

import RapportSummary, {
  MvaBreakdownEntry,
  PaymentBreakdownEntry,
} from "@/pos_styring/components/RapportSummary";

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
  refund_count: number;
  refund_total: number;
  last_journal_id: number;
  report_hash: string;
  terminal_code: string;
  terminal_name: string;
}

async function fetchZ(id: string): Promise<ZRow | null> {
  const { data, error } = await supabase
    .from("pos_z_reports")
    .select(
      "id, terminal_id, z_number, closed_at, period_start, period_end, total_sales_incl_mva, total_sales_excl_mva, total_mva, mva_breakdown, payment_breakdown, transaction_count, refund_count, refund_total, last_journal_id, report_hash, terminal:pos_terminals(terminal_code, display_name)",
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
    refund_count: Number(r.refund_count),
    refund_total: Number(r.refund_total),
    last_journal_id: Number(r.last_journal_id),
    report_hash: r.report_hash,
    terminal_code: r.terminal?.terminal_code ?? "?",
    terminal_name: r.terminal?.display_name ?? "?",
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
    <div className="p-4 md:p-6 space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/rapporter?tab=z")}>
        <ArrowLeft className="h-4 w-4" /> Tilbake til rapporter
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
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
          </div>
          <p className="text-sm text-muted-foreground">
            <span className="font-mono">{z.terminal_code}</span> · {z.terminal_name}
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
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button variant="outline" disabled>
                  <Printer className="h-4 w-4" /> Skriv ut
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Bygges som F5.1</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <RapportSummary
        totals={{
          sales_incl: z.total_sales_incl_mva,
          sales_excl: z.total_sales_excl_mva,
          mva: z.total_mva,
          tx_count: z.transaction_count,
          refund_count: z.refund_count,
          refund_total: z.refund_total,
        }}
        mva_breakdown={z.mva_breakdown}
        payment_breakdown={z.payment_breakdown}
      />

      <Card className="p-4">
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
