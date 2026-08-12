import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AlertTriangle, Boxes, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface StockOverviewStats {
  totalItems: number;
  underMin: number;
  nearMin: number;
  expiring: number;
  expired: number;
}

function useStockOverviewStats(legalEntityId: string | undefined) {
  return useQuery({
    queryKey: ["stock-overview-stats", legalEntityId],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<StockOverviewStats> => {
      const { data: items, error } = await supabase
        .from("stock_item_balance")
        .select("id, level_status")
        .eq("legal_entity_id", legalEntityId!)
        .eq("status", "active");
      if (error) throw error;
      const rows = (items ?? []) as Record<string, any>[];
      const stats: StockOverviewStats = {
        totalItems: rows.length,
        underMin: rows.filter((r) => r.level_status === "under_min").length,
        nearMin: rows.filter((r) => r.level_status === "naer_min").length,
        expiring: 0,
        expired: 0,
      };
      if (rows.length > 0) {
        const { data: batches, error: bErr } = await supabase
          .from("stock_batch_balance")
          .select("batch_id, remaining, expiry_status")
          .in("stock_item_id", rows.map((r) => r.id as string));
        if (bErr) throw bErr;
        for (const b of (batches ?? []) as Record<string, any>[]) {
          if (Number(b.remaining ?? 0) <= 0) continue;
          if (b.expiry_status === "utlopt") stats.expired++;
          else if (b.expiry_status === "naer_utlop") stats.expiring++;
        }
      }
      return stats;
    },
  });
}

export function StockStatusCard({ legalEntityId }: { legalEntityId: string | undefined }) {
  const { data } = useStockOverviewStats(legalEntityId);
  if (!data || data.totalItems === 0) return null;

  const hasAlert = data.underMin > 0 || data.expired > 0;

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">Lager</h3>
        <span className="ml-auto text-xs text-muted-foreground">{data.totalItems} lagervarer</span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={`h-4 w-4 ${data.underMin > 0 ? "text-destructive" : "text-muted-foreground"}`}
          />
          <span className={data.underMin > 0 ? "font-medium text-destructive" : "text-muted-foreground"}>
            {data.underMin} under min-nivå
          </span>
          {data.nearMin > 0 && (
            <span className="text-xs text-muted-foreground">({data.nearMin} nær min)</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Clock
            className={`h-4 w-4 ${data.expired > 0 ? "text-destructive" : data.expiring > 0 ? "text-warning" : "text-muted-foreground"}`}
          />
          <span
            className={
              data.expired > 0
                ? "font-medium text-destructive"
                : data.expiring > 0
                  ? "text-warning"
                  : "text-muted-foreground"
            }
          >
            {data.expired + data.expiring} batcher nær eller over utløp
          </span>
        </div>
      </div>

      <Button asChild variant={hasAlert ? "default" : "outline"} size="sm" className="mt-4 w-full">
        <Link to="/produksjon/lager">Åpne lager</Link>
      </Button>
    </Card>
  );
}
