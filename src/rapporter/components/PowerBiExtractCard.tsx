import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Database, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { DateField } from "@/rapporter/components/ReportFilterBar";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import { logAudit } from "@/rapporter/lib/audit";
import { rangeForPreset } from "@/rapporter/lib/periods";
import { downloadCsv, nok, toCsv } from "@/rapporter/lib/reportFormat";

type ExtractRow = {
  maned: string;
  kundenr: string | null;
  kundenavn: string | null;
  kundeprofil: string | null;
  varenr: string | null;
  varenavn: string | null;
  gtin: string | null;
  statistikkgrupper: string | null;
  belop: number;
  antall: number;
  ordrer: number;
};

const HEADERS = [
  "Måned",
  "Kundenr",
  "Kunde",
  "Kundeprofil",
  "Varenr",
  "Vare",
  "GTIN",
  "Statistikkgrupper",
  "Beløp",
  "Antall",
  "Ordrer",
];

/** «Salgs data for Power BI» — fast uttrekk som lastes ned og arkiveres. */
export function PowerBiExtractCard() {
  const ytd = rangeForPreset("ytd");
  const [start, setStart] = useState(ytd.start);
  const [end, setEnd] = useState(ytd.end);
  const qc = useQueryClient();

  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("powerbi_sales_extract", {
        p_legal_entity_id: NBE_LEGAL_ENTITY_ID,
        p_period_start: start,
        p_period_end: end,
      });
      if (error) throw error;
      const rows = (data ?? []) as ExtractRow[];
      if (rows.length === 0) throw new Error("Ingen salgslinjer i valgt periode.");

      const csv = toCsv(
        HEADERS,
        rows.map((r) => [
          r.maned,
          r.kundenr ?? "",
          r.kundenavn ?? "",
          r.kundeprofil ?? "",
          r.varenr ?? "",
          r.varenavn ?? "",
          r.gtin ?? "",
          r.statistikkgrupper ?? "",
          Number(r.belop),
          Number(r.antall),
          Number(r.ordrer),
        ]),
      );

      const fileName = `powerbi_salg_${start}_${end}.csv`;
      downloadCsv(fileName, csv);

      const total = rows.reduce((s, r) => s + Number(r.belop ?? 0), 0);
      const customers = new Set(rows.map((r) => r.kundenr ?? "")).size;
      const products = new Set(rows.map((r) => r.varenr ?? "")).size;

      const path = `${NBE_LEGAL_ENTITY_ID}/powerbi/${Date.now()}_${fileName}`;
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const { error: upErr } = await supabase.storage
        .from("ng-eksport")
        .upload(path, blob, { contentType: "text/csv;charset=utf-8", upsert: false });
      if (upErr) throw upErr;

      const { data: userData } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("report_runs").insert({
        legal_entity_id: NBE_LEGAL_ENTITY_ID,
        report_type: "powerbi_salg",
        period_start: start,
        period_end: end,
        row_count: rows.length,
        customer_count: customers,
        product_count: products,
        total_amount: total,
        file_name: fileName,
        file_path: path,
        generated_by: userData.user?.id ?? null,
      });
      if (insErr) throw insErr;

      await logAudit({
        action: "create",
        entity_type: "report_run",
        entity_display_reference: fileName,
        changes: { report_type: "powerbi_salg", rows: rows.length, total },
      });

      return { rows: rows.length, total };
    },
    onSuccess: (r) => {
      toast.success(`Uttrekket er generert og arkivert — ${r.rows} rader, ${nok(r.total)} kr`);
      qc.invalidateQueries({ queryKey: ["rapporter", "report-runs"] });
    },
    onError: (e) => showError("powerbi-extract", e, "Kunne ikke generere Power BI-uttrekket"),
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Database className="h-4 w-4 text-[hsl(var(--app-primary))]" />
          Faste uttrekk
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-sm font-medium">Salgs data for Power BI</p>
          <p className="text-xs text-muted-foreground">
            Salg per måned × kunde × vare med kundeprofil, GTIN og statistikkgrupper. Semikolonseparert CSV.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <DateField value={start} onChange={setStart} label="Fra" />
          <DateField value={end} onChange={setEnd} label="Til" />
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Generer og arkiver
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
