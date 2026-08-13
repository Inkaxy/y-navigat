import { useState } from "react";
import { Download, History, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { useReportRuns, type ReportRun } from "@/rapporter/hooks/useNgExport";

const REPORT_LABELS: Record<string, string> = {
  ng_direktelevert: "NG DirekteLevert",
};

const nok = (v: number) =>
  new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v ?? 0));

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("nb-NO", { dateStyle: "short", timeStyle: "short" });
}

export default function Historikk() {
  const { data, isLoading } = useReportRuns();
  const [busy, setBusy] = useState<string | null>(null);

  async function download(run: ReportRun) {
    if (!run.file_path) {
      toast.error("Fila er ikke arkivert for denne kjøringen.");
      return;
    }
    setBusy(run.id);
    try {
      const { data: file, error } = await supabase.storage.from("ng-eksport").download(run.file_path);
      if (error) throw error;
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = run.file_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showError("report-run-download", e, "Kunne ikke laste ned filen");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Rapporter"
        title="Historikk"
        subtitle="Arkiv over genererte rapporter"
        icon={History}
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Henter arkivet …
            </div>
          ) : (data ?? []).length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              Ingen rapporter er generert ennå.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-raised">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Tidspunkt</th>
                    <th className="px-4 py-3 font-medium">Rapport</th>
                    <th className="px-4 py-3 font-medium">Periode</th>
                    <th className="px-4 py-3 text-right font-medium">Rader</th>
                    <th className="px-4 py-3 text-right font-medium">Totalbeløp</th>
                    <th className="px-4 py-3 font-medium">Fil</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {(data ?? []).map((run) => (
                    <tr key={run.id} className="border-t border-line-subtle">
                      <td className="whitespace-nowrap px-4 py-3">{formatDateTime(run.created_at)}</td>
                      <td className="px-4 py-3">{REPORT_LABELS[run.report_type] ?? run.report_type}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {run.period_start} – {run.period_end}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{run.row_count}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{nok(run.total_amount)} kr</td>
                      <td className="max-w-[22rem] truncate px-4 py-3 text-xs text-muted-foreground">
                        {run.file_name}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => download(run)}
                          disabled={busy === run.id || !run.file_path}
                        >
                          {busy === run.id ? (
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Download className="mr-2 h-3.5 w-3.5" />
                          )}
                          Last ned
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
