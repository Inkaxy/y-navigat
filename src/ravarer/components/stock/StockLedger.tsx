import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Search } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { fetchAllRows } from "@/lib/supabasePaging";
import { QueryState } from "@/components/common/QueryState";
import { MOVEMENT_TYPES, movementLabel } from "@/ravarer/lib/stock";
import { formatNumber } from "@/ravarer/lib/constants";
import { osloDateISOPlusDays, osloTodayISO } from "@/lib/osloDate";

interface LedgerRow {
  id: string;
  raw_material_id: string | null;
  movement_type: string;
  quantity_base: number | null;
  occurred_at: string;
  source_table: string | null;
  note: string | null;
}

const dt = new Intl.DateTimeFormat("nb-NO", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** Reskontro: alle lagerbevegelser i perioden, med filter og CSV. */
export function StockLedger() {
  const { legalEntityId } = useRavarer();
  const [fromDate, setFromDate] = useState(osloDateISOPlusDays(-30));
  const [toDate, setToDate] = useState(osloTodayISO());
  const [type, setType] = useState("all");
  const [q, setQ] = useState("");

  const namesQuery = useQuery({
    queryKey: ["ledger-raw-material-names", legalEntityId],
    enabled: !!legalEntityId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const rows = await fetchAllRows<{ id: string; name: string; base_unit: string }>((from, to) =>
        supabase
          .from("raw_materials")
          .select("id, name, base_unit")
          .eq("legal_entity_id", legalEntityId!)
          .order("id")
          .range(from, to),
      );
      return new Map(rows.map(r => [r.id, r]));
    },
  });

  const movesQuery = useQuery({
    queryKey: ["stock-ledger", legalEntityId, fromDate, toDate, type],
    enabled: !!legalEntityId,
    queryFn: async () => {
      // Reskontroen summeres, så alt må hentes — ikke bare første side.
      return await fetchAllRows<LedgerRow>((from, to) => {
        let query = supabase
          .from("stock_movements")
          .select("id, raw_material_id, movement_type, quantity_base, occurred_at, source_table, note")
          .eq("legal_entity_id", legalEntityId!)
          .gte("occurred_at", `${fromDate}T00:00:00`)
          .lte("occurred_at", `${toDate}T23:59:59`);
        if (type !== "all") query = query.eq("movement_type", type);
        return query.order("occurred_at", { ascending: false }).range(from, to);
      });
    },
  });

  const rows = useMemo(() => {
    const names = namesQuery.data;
    const needle = q.trim().toLowerCase();
    return (movesQuery.data ?? [])
      .map(m => {
        const rm = m.raw_material_id ? names?.get(m.raw_material_id) : undefined;
        return {
          ...m,
          name: rm?.name ?? "—",
          base_unit: rm?.base_unit ?? "",
          qty: Number(m.quantity_base) || 0,
        };
      })
      .filter(r => !needle || `${r.name} ${r.note ?? ""}`.toLowerCase().includes(needle));
  }, [movesQuery.data, namesQuery.data, q]);

  const downloadCsv = () => {
    const esc = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["Tidspunkt", "Vare", "Type", "Mengde", "Enhet", "Kilde", "Notat"];
    const body = rows.map(r =>
      [dt.format(new Date(r.occurred_at)), r.name, movementLabel(r.movement_type), r.qty, r.base_unit, r.source_table, r.note]
        .map(esc)
        .join(";"),
    );
    const blob = new Blob(["\uFEFF" + [head.map(esc).join(";"), ...body].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lagerbevegelser-${fromDate}-${toDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isLoading = movesQuery.isLoading || namesQuery.isLoading;
  const error = movesQuery.error ?? namesQuery.error;

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="text-xs">Fra dato</Label>
            <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Til dato</Label>
            <Input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="w-[160px]" />
          </div>
          <div>
            <Label className="text-xs">Type</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle typer</SelectItem>
                {MOVEMENT_TYPES.map(t => (
                  <SelectItem key={t} value={t}>{movementLabel(t)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="relative min-w-[200px] flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
            <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Søk vare eller årsak…" className="pl-9" />
          </div>
          <Button variant="outline" onClick={downloadCsv} disabled={rows.length === 0}>
            <Download className="mr-1.5 h-4 w-4" /> CSV
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading || error || rows.length === 0 ? (
          <div className="p-6">
            <QueryState
              scope="ravarer:lagerbevegelser"
              isLoading={isLoading}
              isError={!!error}
              error={error}
              isEmpty={rows.length === 0}
              onRetry={() => void movesQuery.refetch()}
              emptyTitle="Ingen bevegelser i perioden."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/30 text-left text-xs uppercase tracking-wider text-ink-secondary">
                <tr>
                  <th className="px-4 py-3">Tidspunkt</th>
                  <th className="px-4 py-3">Vare</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Mengde</th>
                  <th className="px-4 py-3">Årsak</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map(r => (
                  <tr key={r.id} className="border-t border-line-subtle">
                    <td className="px-4 py-2 text-ink-secondary">{dt.format(new Date(r.occurred_at))}</td>
                    <td className="px-4 py-2">{r.name}</td>
                    <td className="px-4 py-2">{movementLabel(r.movement_type)}</td>
                    <td className={`px-4 py-2 text-right tabular-nums ${r.qty < 0 ? "text-destructive" : ""}`}>
                      {r.qty > 0 ? "+" : ""}
                      {formatNumber(r.qty, 2)} {r.base_unit}
                    </td>
                    <td className="px-4 py-2 text-ink-secondary">{r.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 500 && (
              <p className="px-4 py-3 text-xs text-ink-secondary">
                Viser de 500 nyeste av {rows.length} bevegelser. Last ned CSV for hele perioden.
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
