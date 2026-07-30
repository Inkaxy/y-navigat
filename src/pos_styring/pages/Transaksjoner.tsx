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
import {
  formatReceiptDisplay,
  parsePaymentSummary,
  paymentLabel,
  type TransactionType,
} from "@/pos_styring/lib/pos-types";
import { osloDayStartIso, osloDayEndIso } from "@/pos_styring/lib/osloTime";

interface TxRow {
  id: string;
  receipt_number: string | null;
  receipt_sequence: number;
  transaction_type: TransactionType;
  is_training: boolean;
  created_at: string;
  total_incl_mva: number;
  payment_summary: unknown;
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
  operator_id: string;
  operator_name: string;
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
function getErr(e: unknown) {
  return typeof e === "object" && e !== null && "message" in e
    ? String((e as { message?: string }).message)
    : "Ukjent feil";
}

const TX_TYPES: TransactionType[] = ["sale", "return", "correction", "training"];
const TX_LABEL: Record<TransactionType, string> = {
  sale: "Salg",
  return: "Retur",
  correction: "Korreksjon",
  training: "Trening",
};

function TxTypeBadge({ type, training }: { type: TransactionType; training: boolean }) {
  const effective: TransactionType = training ? "training" : type;
  const cls: Record<TransactionType, string> = {
    sale: "border-border bg-muted/40 text-foreground",
    return: "border-warning/30 bg-warning/10 text-warning",
    correction: "border-destructive/30 bg-destructive/10 text-destructive",
    training: "border-muted bg-muted/60 text-muted-foreground",
  };
  const suffix = training && type !== "training" ? ` (${TX_LABEL[type].toLowerCase()})` : "";
  return (
    <Badge variant="outline" className={cn("hover:bg-inherit", cls[effective])}>
      {TX_LABEL[effective]}
      {suffix}
    </Badge>
  );
}

// ─── Data ──────────────────────────────────────────────────────────────────

async function fetchTerminals(entityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name")
    .eq("legal_entity_id", entityId)
    .order("terminal_code");
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}
async function fetchOperators(entityId: string): Promise<OperatorOption[]> {
  const { data, error } = await supabase
    .from("pos_operators")
    .select("id, display_name")
    .eq("legal_entity_id", entityId)
    .order("display_name");
  if (error) throw error;
  return (data ?? []) as OperatorOption[];
}

interface TxFilters {
  from: string;
  to: string;
  terminalIds: string[];
  operatorIds: string[];
  types: TransactionType[];
  includeTraining: boolean;
}

async function fetchTransactions(entityId: string, f: TxFilters): Promise<TxRow[]> {
  let query = supabase
    .from("pos_transactions")
    .select(
      "id, receipt_number, receipt_sequence, transaction_type, is_training, created_at, total_incl_mva, payment_summary, terminal_id, operator_id, terminal:pos_terminals!inner(legal_entity_id, terminal_code, display_name), operator:pos_operators(display_name)",
    )
    .eq("terminal.legal_entity_id", entityId)
    .gte("created_at", osloDayStartIso(f.from))
    .lte("created_at", osloDayEndIso(f.to))
    .order("created_at", { ascending: false })
    .limit(500);

  if (f.terminalIds.length > 0) query = query.in("terminal_id", f.terminalIds);
  if (f.operatorIds.length > 0) query = query.in("operator_id", f.operatorIds);
  if (f.types.length > 0 && f.types.length < TX_TYPES.length) query = query.in("transaction_type", f.types);
  if (!f.includeTraining) query = query.eq("is_training", false);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    receipt_number: r.receipt_number ?? null,
    receipt_sequence: Number(r.receipt_sequence),
    transaction_type: r.transaction_type,
    is_training: !!r.is_training,
    created_at: r.created_at,
    total_incl_mva: Number(r.total_incl_mva) || 0,
    payment_summary: r.payment_summary,
    terminal_id: r.terminal_id,
    terminal_code: r.terminal?.terminal_code ?? "?",
    terminal_name: r.terminal?.display_name ?? "?",
    operator_id: r.operator_id,
    operator_name: r.operator?.display_name ?? "?",
  }));
}

// ─── CSV ──────────────────────────────────────────────────────────────────

function csvEscape(v: string | number | null) {
  if (v == null) return "";
  const s = String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: TxRow[]) {
  const header = [
    "Kvittering",
    "Type",
    "Training",
    "Tid",
    "Terminal",
    "Operatør",
    "Total inkl. mva",
    "Primær betaling",
  ];
  const lines = [header.map(csvEscape).join(";")];
  for (const r of rows) {
    const ps = parsePaymentSummary(r.payment_summary);
    const primary = ps.payments.length > 0
      ? ps.payments.reduce((a, b) => (b.amount > a.amount ? b : a))
      : null;
    lines.push(
      [
        formatReceiptDisplay({
          receipt_number: r.receipt_number,
          terminal_code: r.terminal_code,
          receipt_sequence: r.receipt_sequence,
        }),
        TX_LABEL[r.transaction_type],
        r.is_training ? "Ja" : "Nei",
        r.created_at,
        `${r.terminal_code} ${r.terminal_name}`,
        r.operator_name,
        r.total_incl_mva.toFixed(2).replace(".", ","),
        primary ? paymentLabel(primary) : "",
      ].map(csvEscape).join(";"),
    );
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pos-transaksjoner-${format(new Date(), "yyyy-MM-dd")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function defaultDates() {
  const today = format(new Date(), "yyyy-MM-dd");
  return { from: today, to: today };
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function Transaksjoner() {
  const navigate = useNavigate();
  const { activeEntityId, activeEntity, isLoading: entityLoading, hasNoAccess } = useLegalEntity();
  const [{ from, to }, setDates] = useState(defaultDates);
  const [terminalIds, setTerminalIds] = useState<string[]>([]);
  const [operatorIds, setOperatorIds] = useState<string[]>([]);
  const [types, setTypes] = useState<TransactionType[]>([]);
  const [includeTraining, setIncludeTraining] = useState(false);
  const [search, setSearch] = useState("");

  const filters: TxFilters = { from, to, terminalIds, operatorIds, types, includeTraining };

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals_list", activeEntityId],
    queryFn: () => fetchTerminals(activeEntityId!),
    enabled: !!activeEntityId,
  });
  const operatorsQuery = useQuery({
    queryKey: ["pos_operators_list", activeEntityId],
    queryFn: () => fetchOperators(activeEntityId!),
    enabled: !!activeEntityId,
  });
  const txQuery = useQuery({
    queryKey: ["pos_transactions_list", activeEntityId, filters],
    queryFn: () => fetchTransactions(activeEntityId!, filters),
    enabled: !!activeEntityId,
  });

  const filtered = useMemo(() => {
    const rows = txQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const display = formatReceiptDisplay({
        receipt_number: r.receipt_number,
        terminal_code: r.terminal_code,
        receipt_sequence: r.receipt_sequence,
      }).toLowerCase();
      return display.includes(q) || r.id.toLowerCase().startsWith(q);
    });
  }, [txQuery.data, search]);

  const activeFilterCount =
    (terminalIds.length > 0 ? 1 : 0) +
    (operatorIds.length > 0 ? 1 : 0) +
    (types.length > 0 ? 1 : 0) +
    (includeTraining ? 1 : 0);

  const clearFilters = () => {
    setTerminalIds([]);
    setOperatorIds([]);
    setTypes([]);
    setIncludeTraining(false);
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
          <h1 className="text-2xl font-semibold tracking-tight">Transaksjoner</h1>
          <p className="text-sm text-muted-foreground">
            Kvitteringer fra alle terminaler
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
              placeholder="Søk kvittering eller transaksjon-ID…"
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
                Type
                <Badge variant="secondary" className="h-4 px-1 font-mono text-[10px]">
                  {types.length === 0 ? "alle" : types.length}
                </Badge>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-52 p-2">
              {TX_TYPES.map((t) => (
                <label
                  key={t}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent"
                >
                  <Checkbox
                    checked={types.includes(t)}
                    onCheckedChange={() =>
                      setTypes((curr) =>
                        curr.includes(t) ? curr.filter((x) => x !== t) : [...curr, t],
                      )
                    }
                  />
                  <span>{TX_LABEL[t]}</span>
                </label>
              ))}
              <div className="mt-2 border-t pt-2">
                <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent">
                  <Checkbox
                    checked={includeTraining}
                    onCheckedChange={(v) => setIncludeTraining(!!v)}
                  />
                  <span>Inkluder training</span>
                </label>
              </div>
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
              {(terminalsQuery.data ?? []).length === 0 ? (
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
              {(operatorsQuery.data ?? []).length === 0 ? (
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

      {txQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : txQuery.error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getErr(txQuery.error)}</AlertDescription>
        </Alert>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center">
          <h3 className="text-base font-medium">Ingen transaksjoner i valgt periode</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Juster dato-filter eller fjern filtre. Transaksjoner skapes fra POS-klienten (Kiosk).
          </p>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Kvittering</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Tid</TableHead>
              <TableHead>Terminal</TableHead>
              <TableHead>Operatør</TableHead>
              <TableHead>Betaling</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const ps = parsePaymentSummary(r.payment_summary);
              const primary = ps.payments.length > 0
                ? ps.payments.reduce((a, b) => (b.amount > a.amount ? b : a))
                : null;
              const display = formatReceiptDisplay({
                receipt_number: r.receipt_number,
                terminal_code: r.terminal_code,
                receipt_sequence: r.receipt_sequence,
              });
              return (
                <TableRow
                  key={r.id}
                  interactive
                  onClick={() => navigate(`/pos-styring/transaksjoner/${r.id}`)}
                >
                  <TableCell className="font-mono text-sm">{display}</TableCell>
                  <TableCell>
                    <TxTypeBadge type={r.transaction_type} training={r.is_training} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          {formatDistanceToNow(new Date(r.created_at), { addSuffix: true, locale: nb })}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {format(new Date(r.created_at), "yyyy-MM-dd HH:mm:ss")}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{r.terminal_code}</span>{" "}
                    {r.terminal_name}
                  </TableCell>
                  <TableCell className="text-sm">{r.operator_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {primary ? paymentLabel(primary) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmtMoney(r.total_incl_mva)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
