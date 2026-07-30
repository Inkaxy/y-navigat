import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { nb } from "date-fns/locale";
import { AlertCircle, ChevronDown, Download, Search, X } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { osloDayStartIso, osloDayEndIso } from "@/pos_styring/lib/osloTime";

type SessionStatus = "open" | "closed";

interface SessionRow {
  id: string;
  session_number: number;
  status: SessionStatus;
  opened_at: string;
  closed_at: string | null;
  opening_float: number | null;
  closing_float: number | null;
  counted_cash: number | null;
  expected_cash: number | null;
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
  operator_id: string;
  operator_name: string;
  tx_count: number;
  tx_total: number;
}

interface TerminalOption {
  id: string;
  terminal_code: string;
  display_name: string;
}
interface OperatorOption {
  id: string;
  display_name: string;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}

function fmtDisplayId(row: { terminal_code: string; session_number: number }) {
  return `T-${row.terminal_code}-${row.session_number}`;
}

function getSupabaseErrorMessage(error: unknown) {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message?: string }).message)
    : "Ukjent feil";
}

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === "open") {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success hover:bg-success/10">
        Åpen
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-muted bg-muted text-muted-foreground hover:bg-muted">
      Lukket
    </Badge>
  );
}

// ─── Data fetching ────────────────────────────────────────────────────────

async function fetchTerminalsForEntity(entityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name")
    .eq("legal_entity_id", entityId)
    .order("terminal_code");
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}

async function fetchOperatorsForEntity(entityId: string): Promise<OperatorOption[]> {
  const { data, error } = await supabase
    .from("pos_operators")
    .select("id, display_name")
    .eq("legal_entity_id", entityId)
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as OperatorOption[];
}

interface SessionFilters {
  from: string; // YYYY-MM-DD
  to: string;
  status: "all" | SessionStatus;
  terminalIds: string[];
  operatorIds: string[];
}

async function fetchSessions(entityId: string, f: SessionFilters): Promise<SessionRow[]> {
  // Inner-join på pos_terminals for å filtrere på legal_entity_id (pos_sessions
  // har ikke kolonnen selv per recon).
  let query = supabase
    .from("pos_sessions")
    .select(
      "id, session_number, status, opened_at, closed_at, opening_float, closing_float, counted_cash, expected_cash, terminal_id, operator_id, terminal:pos_terminals!inner(legal_entity_id, terminal_code, display_name), operator:pos_operators(display_name)",
    )
    .eq("terminal.legal_entity_id", entityId)
    .gte("opened_at", osloDayStartIso(f.from))
    .lte("opened_at", osloDayEndIso(f.to))
    .order("opened_at", { ascending: false })
    .limit(500);

  if (f.status !== "all") query = query.eq("status", f.status);
  if (f.terminalIds.length > 0) query = query.in("terminal_id", f.terminalIds);
  if (f.operatorIds.length > 0) query = query.in("operator_id", f.operatorIds);

  const { data, error } = await query;
  if (error) throw error;

  const sessions = (data ?? []) as any[];
  if (sessions.length === 0) return [];

  // Batch-aggregat per side (read-only) — F3.2.5(b)
  const sessionIds = sessions.map((s) => s.id as string);
  const { data: txData, error: txErr } = await supabase
    .from("pos_transactions")
    .select("session_id, total_incl_mva")
    .in("session_id", sessionIds);
  if (txErr) throw txErr;

  const agg = new Map<string, { count: number; total: number }>();
  for (const t of txData ?? []) {
    const cur = agg.get(t.session_id) ?? { count: 0, total: 0 };
    cur.count += 1;
    cur.total += Number(t.total_incl_mva) || 0;
    agg.set(t.session_id, cur);
  }

  return sessions.map((s) => ({
    id: s.id,
    session_number: Number(s.session_number),
    status: s.status,
    opened_at: s.opened_at,
    closed_at: s.closed_at,
    opening_float: s.opening_float == null ? null : Number(s.opening_float),
    closing_float: s.closing_float == null ? null : Number(s.closing_float),
    counted_cash: s.counted_cash == null ? null : Number(s.counted_cash),
    expected_cash: s.expected_cash == null ? null : Number(s.expected_cash),
    terminal_id: s.terminal_id,
    terminal_code: s.terminal?.terminal_code ?? "?",
    terminal_name: s.terminal?.display_name ?? "?",
    operator_id: s.operator_id,
    operator_name: s.operator?.display_name ?? "?",
    tx_count: agg.get(s.id)?.count ?? 0,
    tx_total: agg.get(s.id)?.total ?? 0,
  }));
}

// ─── CSV export (semicolon + UTF-8 BOM, Excel-NO) ─────────────────────────

function csvEscape(v: string | number | null) {
  if (v == null) return "";
  const s = String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: SessionRow[]) {
  const header = [
    "Sesjon-ID",
    "Status",
    "Terminal",
    "Operatør",
    "Åpnet",
    "Lukket",
    "Antall transaksjoner",
    "Sum brutto",
    "Åpningsfloat",
    "Lukkings-float",
    "Talt kontant",
    "Forventet kontant",
  ];
  const lines = [header.map(csvEscape).join(";")];
  for (const r of rows) {
    lines.push(
      [
        fmtDisplayId(r),
        r.status === "open" ? "Åpen" : "Lukket",
        `${r.terminal_code} ${r.terminal_name}`,
        r.operator_name,
        r.opened_at,
        r.closed_at ?? "",
        r.tx_count,
        r.tx_total.toFixed(2).replace(".", ","),
        r.opening_float == null ? "" : r.opening_float.toFixed(2).replace(".", ","),
        r.closing_float == null ? "" : r.closing_float.toFixed(2).replace(".", ","),
        r.counted_cash == null ? "" : r.counted_cash.toFixed(2).replace(".", ","),
        r.expected_cash == null ? "" : r.expected_cash.toFixed(2).replace(".", ","),
      ]
        .map(csvEscape)
        .join(";"),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pos-sesjoner-${format(new Date(), "yyyy-MM-dd")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Page ─────────────────────────────────────────────────────────────────

function defaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 7);
  return {
    from: format(from, "yyyy-MM-dd"),
    to: format(to, "yyyy-MM-dd"),
  };
}

export default function Sesjoner() {
  const navigate = useNavigate();
  const { activeEntityId, activeEntity, isLoading: entityLoading, hasNoAccess } = useLegalEntity();
  const [{ from, to }, setDates] = useState(defaultDates);
  const [status, setStatus] = useState<SessionFilters["status"]>("all");
  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [operatorIds, setOperatorIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const filters: SessionFilters = { from, to, status, terminalIds, operatorIds };

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals_list", activeEntityId],
    queryFn: () => fetchTerminalsForEntity(activeEntityId!),
    enabled: !!activeEntityId,
  });
  const operatorsQuery = useQuery({
    queryKey: ["pos_operators_list", activeEntityId],
    queryFn: () => fetchOperatorsForEntity(activeEntityId!),
    enabled: !!activeEntityId,
  });
  const sessionsQuery = useQuery({
    queryKey: ["pos_sessions", activeEntityId, filters],
    queryFn: () => fetchSessions(activeEntityId!, filters),
    enabled: !!activeEntityId,
  });

  const filtered = useMemo(() => {
    const rows = sessionsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    const sorted = [...rows].sort((a, b) => {
      if (a.status !== b.status) return a.status === "open" ? -1 : 1;
      return b.opened_at.localeCompare(a.opened_at);
    });
    if (!q) return sorted;
    return sorted.filter((r) => {
      const id = fmtDisplayId(r).toLowerCase();
      return (
        id.includes(q) ||
        r.terminal_name.toLowerCase().includes(q) ||
        r.operator_name.toLowerCase().includes(q)
      );
    });
  }, [sessionsQuery.data, search]);

  const activeFilterCount =
    (status !== "all" ? 1 : 0) + (terminalIds.length > 0 ? 1 : 0) + (operatorIds.length > 0 ? 1 : 0);

  const clearFilters = () => {
    setStatus("all");
    setTerminalIds([]);
    setOperatorIds([]);
  };

  if (entityLoading) {
    return (
      <div className="p-6 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (hasNoAccess || !activeEntityId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Du har ikke tilgang til POS Styring for noen selskap.</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sesjoner</h1>
          <p className="text-sm text-muted-foreground">
            Åpne og lukkede kasse-sesjoner
            {activeEntity ? ` · ${activeEntity.short_code}` : ""}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => exportCsv(filtered)}
          disabled={filtered.length === 0}
        >
          <Download className="h-4 w-4" />
          Eksporter CSV
        </Button>
      </div>

      <Card className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Søk sesjon-ID, terminal eller operatør…"
              className="h-8 pl-7"
            />
          </div>

          <div className="flex items-center gap-1">
            <Label htmlFor="from" className="text-xs text-muted-foreground">Fra</Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))}
              className="h-8 w-[140px]"
            />
            <Label htmlFor="to" className="text-xs text-muted-foreground">Til</Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))}
              className="h-8 w-[140px]"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                Status
                <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                  {status === "all" ? "alle" : status === "open" ? "åpne" : "lukket"}
                </Badge>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-44 p-2">
              {(["all", "open", "closed"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-sm hover:bg-accent",
                    status === s && "bg-accent font-medium",
                  )}
                >
                  {s === "all" ? "Alle" : s === "open" ? "Kun åpne" : "Kun lukkede"}
                </button>
              ))}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                Terminal
                <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                  {terminalIds.length === 0 ? "alle" : terminalIds.length}
                </Badge>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              {terminalsQuery.data?.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">Ingen terminaler</div>
              ) : (
                <div className="max-h-[280px] space-y-0.5 overflow-y-auto">
                  {(terminalsQuery.data ?? []).map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={terminalIds.includes(t.id)}
                        onCheckedChange={() =>
                          setTerminalIds((ids) =>
                            ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id],
                          )
                        }
                      />
                      <span className="font-mono text-xs text-muted-foreground">{t.terminal_code}</span>
                      <span className="truncate">{t.display_name}</span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                Operatør
                <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                  {operatorIds.length === 0 ? "alle" : operatorIds.length}
                </Badge>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-64 p-2">
              {operatorsQuery.data?.length === 0 ? (
                <div className="p-2 text-xs text-muted-foreground">Ingen operatører</div>
              ) : (
                <div className="max-h-[280px] space-y-0.5 overflow-y-auto">
                  {(operatorsQuery.data ?? []).map((o) => (
                    <label
                      key={o.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                    >
                      <Checkbox
                        checked={operatorIds.includes(o.id)}
                        onCheckedChange={() =>
                          setOperatorIds((ids) =>
                            ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id],
                          )
                        }
                      />
                      <span className="truncate">{o.display_name}</span>
                    </label>
                  ))}
                </div>
              )}
            </PopoverContent>
          </Popover>

          {activeFilterCount > 0 && (
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={clearFilters}>
              <X className="h-3 w-3" />
              Nullstill ({activeFilterCount})
            </Button>
          )}
        </div>
      </Card>

      {sessionsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : sessionsQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getSupabaseErrorMessage(sessionsQuery.error)}</AlertDescription>
        </Alert>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <h3 className="text-base font-medium">Ingen sesjoner i perioden</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Sesjoner opprettes automatisk når en operatør åpner en kasse i POS-klienten (Kiosk).
            Juster dato-filteret eller fjern filtre for å se eldre sesjoner.
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Sesjon-ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Terminal</TableHead>
              <TableHead>Operatør</TableHead>
              <TableHead>Åpnet</TableHead>
              <TableHead>Lukket</TableHead>
              <TableHead className="text-right">Antall</TableHead>
              <TableHead className="text-right">Sum</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => (
              <TableRow
                key={r.id}
                interactive
                onClick={() => navigate(`/pos-styring/sesjoner/${r.id}`)}
              >
                <TableCell className="font-mono text-sm">{fmtDisplayId(r)}</TableCell>
                <TableCell><StatusBadge status={r.status} /></TableCell>
                <TableCell className="text-sm">{r.terminal_name}</TableCell>
                <TableCell className="text-sm">{r.operator_name}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{formatDistanceToNow(new Date(r.opened_at), { addSuffix: true, locale: nb })}</span>
                    </TooltipTrigger>
                    <TooltipContent>{format(new Date(r.opened_at), "yyyy-MM-dd HH:mm")}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {r.closed_at ? (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>{formatDistanceToNow(new Date(r.closed_at), { addSuffix: true, locale: nb })}</span>
                      </TooltipTrigger>
                      <TooltipContent>{format(new Date(r.closed_at), "yyyy-MM-dd HH:mm")}</TooltipContent>
                    </Tooltip>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{r.tx_count}</TableCell>
                <TableCell className="text-right tabular-nums">{fmtMoney(r.tx_total)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
