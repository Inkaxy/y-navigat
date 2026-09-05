import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import { formatDate } from "@/ordre/lib/format";
import { useDeliveryTours } from "@/ordre/hooks/useDeliveryTours";

type CorrectionRun = {
  id: string;
  delivery_date: string;
  tour_filter: string[] | null;
  notes_generated: number;
  orders_processed: number;
  orders_skipped: number;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  triggered_by: string | null;
  details: Record<string, unknown> | null;
};

function useCorrectionRuns(dateFilter?: string) {
  return useQuery({
    queryKey: ["delivery-note-runs", "corrections", dateFilter ?? "all"],
    queryFn: async (): Promise<CorrectionRun[]> => {
      let q = supabase
        .from("delivery_note_runs")
        .select("id, delivery_date, tour_filter, notes_generated, orders_processed, orders_skipped, status, started_at, finished_at, completed_at, triggered_by, details")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("run_type", "correction")
        .order("completed_at", { ascending: false, nullsFirst: false })
        .order("finished_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (dateFilter) q = q.eq("delivery_date", dateFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CorrectionRun[];
    },
    staleTime: 30_000,
  });
}

export default function DeliveryNoteCorrections() {
  const [params] = useSearchParams();
  const dateFilter = params.get("date") ?? undefined;
  const { data: runs = [], isLoading } = useCorrectionRuns(dateFilter);
  const { data: tours = [] } = useDeliveryTours();

  const tourLabel = (filter: string[] | null): string => {
    if (!filter || filter.length === 0) return "Alle turer";
    return filter
      .map((id) => tours.find((t) => t.id === id)?.display_name ?? "Ukjent")
      .join(", ");
  };

  const grouped = useMemo(() => {
    const m = new Map<string, CorrectionRun[]>();
    for (const r of runs) {
      const arr = m.get(r.delivery_date) ?? [];
      arr.push(r);
      m.set(r.delivery_date, arr);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [runs]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link to="/ordre/pakksedler">
              <Button variant="ghost" size="sm" className="gap-1">
                <ArrowLeft className="h-4 w-4" /> Tilbake
              </Button>
            </Link>
          </div>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold">
            <History className="h-6 w-6 text-primary" />
            Korrigeringer
          </h1>
          <p className="text-sm text-muted-foreground">
            Oversikt over korreksjonskjøringer som har annullert og regenerert pakksedler.
            {dateFilter ? ` Filtrert på ${formatDate(dateFilter)}.` : ""}
          </p>
        </div>
      </div>

      {isLoading ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">Laster…</Card>
      ) : grouped.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Ingen korreksjonskjøringer funnet{dateFilter ? ` for ${formatDate(dateFilter)}` : ""}.
        </Card>
      ) : (
        grouped.map(([date, list]) => (
          <Card key={date} className="overflow-hidden">
            <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2">
              <div className="font-semibold">{formatDate(date)}</div>
              <Link
                to={`/ordre/pakksedler/liste?date=${date}&tour=all`}
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Se pakksedler <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tidspunkt</TableHead>
                  <TableHead>Turer</TableHead>
                  <TableHead className="text-right">Annullert</TableHead>
                  <TableHead className="text-right">Nye pakksedler</TableHead>
                  <TableHead className="text-right">Ordrer</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((r) => {
                  const cancelled = (r.details as { notes_cancelled?: number } | null)?.notes_cancelled ?? 0;
                  const ts = r.completed_at ?? r.finished_at ?? r.started_at;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs">
                        {ts ? new Date(ts).toLocaleString("nb-NO") : "—"}
                      </TableCell>
                      <TableCell>{tourLabel(r.tour_filter)}</TableCell>
                      <TableCell className="text-right tabular-nums">{cancelled}</TableCell>
                      <TableCell className="text-right tabular-nums font-semibold">{r.notes_generated}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.orders_processed}</TableCell>
                      <TableCell>
                        <span
                          className={
                            r.status === "completed"
                              ? "text-emerald-700"
                              : r.status === "failed"
                                ? "text-destructive"
                                : "text-muted-foreground"
                          }
                        >
                          {r.status}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        ))
      )}
    </div>
  );
}
