import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QueryState } from "@/components/common/QueryState";
import { supabase } from "@/integrations/supabase/client";
import { formatDate, formatNok, PRICE_SOURCES } from "@/ravarer/lib/constants";
import { usePriceHistory } from "@/ravarer/hooks/useRmSuppliers";
import type { RawMaterialRow } from "@/ravarer/hooks/useRawMaterials";

type EventKind = "endring" | "omregning" | "pris";

interface TimelineEvent {
  id: string;
  kind: EventKind;
  at: string;
  title: string;
  detail: string;
  invoiceId: string | null;
}

const KIND_LABEL: Record<EventKind, string> = {
  endring: "Datablad-endring",
  omregning: "Omregning av kostpris",
  pris: "Prisobservasjon",
};

function sourceLabel(value: string): string {
  return PRICE_SOURCES.find((s) => s.value === value)?.label ?? value;
}

function jsonText(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

interface Props {
  rm: RawMaterialRow;
}

export function HistoryTab({ rm }: Props) {
  const [filter, setFilter] = useState<EventKind | "alle">("alle");

  const changelog = useQuery({
    queryKey: ["raw-material-changelog", rm.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_changelog")
        .select("id, created_at, change_type, field, old_value, new_value, severity")
        .eq("raw_material_id", rm.id)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const recalcs = useQuery({
    queryKey: ["raw_material_cost_recalcs", rm.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("raw_material_cost_recalcs")
        .select("id, performed_at, cost_before, cost_after, factor_used, reason, lines_changed, undone_at")
        .eq("raw_material_id", rm.id)
        .order("performed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });

  const prices = usePriceHistory(rm.id);

  const events = useMemo<TimelineEvent[]>(() => {
    const list: TimelineEvent[] = [];
    for (const c of changelog.data ?? []) {
      list.push({
        id: `c-${c.id}`,
        kind: "endring",
        at: c.created_at,
        title: c.field ? `${c.change_type} · ${c.field}` : c.change_type,
        detail: `${jsonText(c.old_value)} → ${jsonText(c.new_value)}`,
        invoiceId: null,
      });
    }
    for (const r of recalcs.data ?? []) {
      list.push({
        id: `r-${r.id}`,
        kind: "omregning",
        at: r.performed_at,
        title: r.undone_at ? "Omregning (angret)" : "Omregning av kostpris",
        detail: `${formatNok(r.cost_before)} → ${formatNok(r.cost_after)}${
          r.factor_used != null ? ` (faktor ${r.factor_used})` : ""
        }${r.reason ? ` · ${r.reason}` : ""}`,
        invoiceId: null,
      });
    }
    for (const p of prices.data ?? []) {
      list.push({
        id: `p-${p.id}`,
        kind: "pris",
        at: p.effective_date,
        title: `${formatNok(p.price)} per ${rm.base_unit}`,
        detail: `${sourceLabel(p.source)}${p.notes ? ` · ${p.notes}` : ""}`,
        invoiceId: p.invoice_id,
      });
    }
    return list
      .filter((e) => filter === "alle" || e.kind === filter)
      .sort((a, b) => b.at.localeCompare(a.at));
  }, [changelog.data, recalcs.data, prices.data, filter, rm.base_unit]);

  const isLoading = changelog.isLoading || recalcs.isLoading || prices.isLoading;
  const isError = changelog.isError || recalcs.isError || prices.isError;
  const error = changelog.error ?? recalcs.error ?? prices.error;

  return (
    <Card className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">Historikk</h3>
        <Select value={filter} onValueChange={(v) => setFilter(v as EventKind | "alle")}>
          <SelectTrigger className="h-9 w-[220px]" aria-label="Filtrer historikk">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="alle">Alle hendelser</SelectItem>
            <SelectItem value="pris">Prisobservasjoner</SelectItem>
            <SelectItem value="omregning">Omregninger</SelectItem>
            <SelectItem value="endring">Datablad-endringer</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <QueryState
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => {
          void changelog.refetch();
          void recalcs.refetch();
          void prices.refetch();
        }}
        scope="historikken"
        isEmpty={events.length === 0}
        emptyTitle="Ingen hendelser"
        emptyDescription="Det er ikke registrert endringer på denne råvaren ennå."
      >
        <ol className="space-y-3">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3 border-l-2 border-line-subtle pl-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{KIND_LABEL[e.kind]}</Badge>
                  <span className="text-sm font-medium">{e.title}</span>
                  <span className="text-xs text-ink-secondary">{formatDate(e.at)}</span>
                </div>
                <p className="mt-0.5 break-words text-sm text-ink-secondary">
                  {e.detail}
                  {e.invoiceId && (
                    <>
                      {" · "}
                      <Link
                        to={`/ravarer/fakturaer/${e.invoiceId}`}
                        className="text-app underline-offset-2 hover:underline"
                      >
                        Åpne faktura
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </QueryState>
    </Card>
  );
}
