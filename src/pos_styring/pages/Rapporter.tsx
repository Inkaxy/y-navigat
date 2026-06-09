import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { toast } from "sonner";
import { AlertCircle, Download, FileText, Loader2, Play, RefreshCw } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useLegalEntity } from "@/pos_styring/contexts/LegalEntityContext";

import RapportSummary, {
  MvaBreakdownEntry,
  PaymentBreakdownEntry,
  RapportTotals,
} from "@/pos_styring/components/RapportSummary";

// ─── Types ────────────────────────────────────────────────────────────────

interface TerminalOption {
  id: string;
  terminal_code: string;
  display_name: string;
}

interface ZRow {
  id: string;
  z_number: number;
  closed_at: string;
  period_start: string;
  period_end: string;
  total_sales_incl_mva: number;
  transaction_count: number;
  refund_count: number;
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
}

interface OpenSession {
  id: string;
  session_number: number;
  opened_at: string;
}

// Matcher faktisk pos_generate_x_report-output (flat, ingen header-wrapper).
interface XReport {
  report_type: "x";
  session_id: string;
  session_number: number;
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
  operator_id: string;
  operator_code: string;
  operator_name: string;
  period_start: string;
  period_end: string;
  generated_at: string;
  totals: RapportTotals;
  mva_breakdown: MvaBreakdownEntry[];
  payment_breakdown: PaymentBreakdownEntry[];
  last_journal_id: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function fmtMoney(n: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}
function getMsg(e: unknown) {
  return typeof e === "object" && e !== null && "message" in e
    ? String((e as { message?: string }).message)
    : "Ukjent feil";
}
function getCode(e: unknown): string {
  return typeof e === "object" && e !== null && "code" in e
    ? String((e as { code?: string }).code)
    : "";
}

function defaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  return { from: format(from, "yyyy-MM-dd"), to: format(to, "yyyy-MM-dd") };
}

function csvEscape(v: string | number | null) {
  if (v == null) return "";
  const s = String(v);
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportZCsv(rows: ZRow[]) {
  const header = [
    "Z-nr",
    "Terminal",
    "Periode start",
    "Periode slutt",
    "Antall transaksjoner",
    "Antall returer",
    "Sum brutto",
    "Lukket",
  ];
  const lines = [header.map(csvEscape).join(";")];
  for (const r of rows) {
    lines.push(
      [
        r.z_number,
        `${r.terminal_code} ${r.terminal_name}`,
        r.period_start,
        r.period_end,
        r.transaction_count,
        r.refund_count,
        r.total_sales_incl_mva.toFixed(2).replace(".", ","),
        r.closed_at,
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
  a.download = `pos-z-rapporter-${format(new Date(), "yyyy-MM-dd")}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

// ─── Data ─────────────────────────────────────────────────────────────────

async function fetchTerminals(entityId: string): Promise<TerminalOption[]> {
  const { data, error } = await supabase
    .from("pos_terminals")
    .select("id, terminal_code, display_name")
    .eq("legal_entity_id", entityId)
    .order("terminal_code");
  if (error) throw error;
  return (data ?? []) as TerminalOption[];
}

async function fetchZ(entityId: string, from: string, to: string, terminalId: string | null): Promise<ZRow[]> {
  let q = supabase
    .from("pos_z_reports")
    .select(
      "id, z_number, closed_at, period_start, period_end, total_sales_incl_mva, transaction_count, refund_count, terminal_id, terminal:pos_terminals!inner(legal_entity_id, terminal_code, display_name)",
    )
    .eq("terminal.legal_entity_id", entityId)
    .gte("closed_at", `${from}T00:00:00`)
    .lte("closed_at", `${to}T23:59:59.999`)
    .order("closed_at", { ascending: false })
    .limit(500);
  if (terminalId) q = q.eq("terminal_id", terminalId);
  const { data, error } = await q;
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    z_number: Number(r.z_number),
    closed_at: r.closed_at,
    period_start: r.period_start,
    period_end: r.period_end,
    total_sales_incl_mva: Number(r.total_sales_incl_mva),
    transaction_count: Number(r.transaction_count),
    refund_count: Number(r.refund_count),
    terminal_id: r.terminal_id,
    terminal_code: r.terminal?.terminal_code ?? "?",
    terminal_name: r.terminal?.display_name ?? "?",
  }));
}

async function fetchOpenSessions(terminalId: string): Promise<OpenSession[]> {
  const { data, error } = await supabase
    .from("pos_sessions")
    .select("id, session_number, opened_at")
    .eq("terminal_id", terminalId)
    .eq("status", "open")
    .order("opened_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as any[]).map((s) => ({
    id: s.id,
    session_number: Number(s.session_number),
    opened_at: s.opened_at,
  }));
}

async function countTxInPeriod(terminalId: string, fromIso: string, toIso: string): Promise<number> {
  // Snitter pos_sessions for terminal-scope; client-side count som sanity-check.
  const { data: sessions } = await supabase
    .from("pos_sessions")
    .select("id")
    .eq("terminal_id", terminalId);
  const ids = (sessions ?? []).map((s: any) => s.id);
  if (ids.length === 0) return 0;
  const { count, error } = await supabase
    .from("pos_transactions")
    .select("id", { count: "exact", head: true })
    .in("session_id", ids)
    .neq("transaction_type", "training")
    .gte("created_at", fromIso)
    .lte("created_at", toIso);
  if (error) throw error;
  return count ?? 0;
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function Rapporter() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { activeEntityId, activeEntity, isLoading: entityLoading, hasNoAccess } = useLegalEntity();
  const [searchParams, setSearchParams] = useSearchParams();

  const tab = (searchParams.get("tab") as "z" | "x" | "generer") || "z";
  const setTab = (v: string) => {
    const p = new URLSearchParams(searchParams);
    p.set("tab", v);
    setSearchParams(p, { replace: true });
  };

  const terminalsQuery = useQuery({
    queryKey: ["pos_terminals_list", activeEntityId],
    queryFn: () => fetchTerminals(activeEntityId!),
    enabled: !!activeEntityId,
  });

  // ── Z-historikk state ──
  const [{ from, to }, setDates] = useState(defaultDates);
  const [search, setSearch] = useState("");
  const [zTerminalId, setZTerminalId] = useState<string>("all");

  const zQuery = useQuery({
    queryKey: ["pos_z_reports_list", activeEntityId, from, to, zTerminalId],
    queryFn: () => fetchZ(activeEntityId!, from, to, zTerminalId === "all" ? null : zTerminalId),
    enabled: !!activeEntityId,
  });

  const filteredZ = useMemo(() => {
    const rows = zQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.z_number).includes(q));
  }, [zQuery.data, search]);

  // ── X-snapshot state ──
  const [xTerminalId, setXTerminalId] = useState<string>("");
  const [xSessionId, setXSessionId] = useState<string>("");
  const [xResult, setXResult] = useState<XReport | null>(null);
  const [xGeneratedAt, setXGeneratedAt] = useState<Date | null>(null);

  const openSessionsQuery = useQuery({
    queryKey: ["pos_open_sessions", xTerminalId],
    queryFn: () => fetchOpenSessions(xTerminalId),
    enabled: !!xTerminalId,
  });

  const xMutation = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data, error } = await supabase.rpc("pos_generate_x_report", {
        p_session_id: sessionId,
      });
      if (error) throw error;
      // RPC returnerer kanonisk shape (flat, totals med gross/net/transaction_count).
      return data as unknown as XReport;
    },
    onSuccess: (data) => {
      setXResult(data);
      setXGeneratedAt(new Date());
    },
    onError: (e) => {
      const code = getCode(e);
      if (code === "42501") toast.error("Du har ikke tilgang");
      else toast.error(getMsg(e));
    },
  });

  // ── Z-generering state ──
  const [genTerminalId, setGenTerminalId] = useState<string>("");
  const [genFrom, setGenFrom] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [genTo, setGenTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));
  const [genCount, setGenCount] = useState<number | null>(null);
  const [genCountLoading, setGenCountLoading] = useState(false);

  const previewCount = async () => {
    if (!genTerminalId) return;
    setGenCountLoading(true);
    try {
      const fromIso = new Date(`${genFrom}T00:00:00`).toISOString();
      const toIso = new Date(`${genTo}T23:59:59.999`).toISOString();
      const n = await countTxInPeriod(genTerminalId, fromIso, toIso);
      setGenCount(n);
    } catch (e) {
      toast.error(getMsg(e));
    } finally {
      setGenCountLoading(false);
    }
  };

  const zGenMutation = useMutation({
    mutationFn: async () => {
      const fromIso = new Date(`${genFrom}T00:00:00`).toISOString();
      const toIso = new Date(`${genTo}T23:59:59.999`).toISOString();
      const { data, error } = await supabase.rpc("pos_generate_z_report", {
        p_terminal_id: genTerminalId,
        p_period_start: fromIso,
        p_period_end: toIso,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (newId) => {
      toast.success("Z-rapport generert");
      qc.invalidateQueries({ queryKey: ["pos_z_reports_list"] });
      navigate(`/pos-styring/rapporter/z/${newId}`);
    },
    onError: (e) => {
      const code = getCode(e);
      const msg = getMsg(e);
      if (code === "23505") {
        toast.error("Z-rapport for denne perioden finnes allerede");
      } else if (code === "42501") {
        toast.error("Du har ikke tilgang");
      } else if (msg.includes("Invalid period")) {
        toast.error("Periodens slutt må være etter start");
      } else if (msg.toLowerCase().includes("session") && msg.toLowerCase().includes("open")) {
        toast.error(msg);
      } else {
        toast.error(msg);
      }
    },
  });

  if (entityLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (hasNoAccess || !activeEntityId) {
    return (
      <div className="p-6">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Du har ikke tilgang til POS Styring for noen selskap.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rapporter</h1>
          <p className="text-sm text-muted-foreground">
            X-snapshot, Z-historikk og manuell Z-generering
            {activeEntity ? ` · ${activeEntity.short_code}` : ""}
          </p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="z">Z-historikk</TabsTrigger>
          <TabsTrigger value="x">X-snapshot</TabsTrigger>
          <TabsTrigger value="generer">Generer Z</TabsTrigger>
        </TabsList>

        {/* ── TAB: Z-historikk ── */}
        <TabsContent value="z" className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex items-center gap-1">
                <Label htmlFor="zfrom" className="text-xs text-muted-foreground">Fra</Label>
                <Input
                  id="zfrom"
                  type="date"
                  value={from}
                  onChange={(e) => setDates((d) => ({ ...d, from: e.target.value }))}
                  className="h-8 w-[140px]"
                />
                <Label htmlFor="zto" className="text-xs text-muted-foreground">Til</Label>
                <Input
                  id="zto"
                  type="date"
                  value={to}
                  onChange={(e) => setDates((d) => ({ ...d, to: e.target.value }))}
                  className="h-8 w-[140px]"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground">Terminal</Label>
                <Select value={zTerminalId} onValueChange={setZTerminalId}>
                  <SelectTrigger className="h-8 w-[200px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle terminaler</SelectItem>
                    {(terminalsQuery.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.terminal_code} · {t.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Søk Z-nr…"
                className="h-8 w-[140px]"
              />
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                disabled={filteredZ.length === 0}
                onClick={() => exportZCsv(filteredZ)}
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
            </div>
          </Card>

          {zQuery.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : zQuery.error ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{getMsg(zQuery.error)}</AlertDescription>
            </Alert>
          ) : filteredZ.length === 0 ? (
            <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
              Ingen Z-rapporter generert ennå.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Z-nr</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Periode</TableHead>
                  <TableHead className="text-right">Tx</TableHead>
                  <TableHead className="text-right">Returer</TableHead>
                  <TableHead className="text-right">Sum brutto</TableHead>
                  <TableHead>Lukket</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredZ.map((r) => (
                  <TableRow
                    key={r.id}
                    interactive
                    onClick={() => navigate(`/pos-styring/rapporter/z/${r.id}`)}
                  >
                    <TableCell className="font-mono">#{r.z_number}</TableCell>
                    <TableCell>
                      <span className="font-mono text-xs text-muted-foreground">
                        {r.terminal_code}
                      </span>{" "}
                      {r.terminal_name}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(r.period_start), "yyyy-MM-dd HH:mm")} →{" "}
                      {format(new Date(r.period_end), "yyyy-MM-dd HH:mm")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.transaction_count}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.refund_count}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtMoney(r.total_sales_incl_mva)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(r.closed_at), { addSuffix: true, locale: nb })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        {/* ── TAB: X-snapshot ── */}
        <TabsContent value="x" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Terminal</Label>
                <Select
                  value={xTerminalId}
                  onValueChange={(v) => {
                    setXTerminalId(v);
                    setXSessionId("");
                    setXResult(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Velg terminal…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(terminalsQuery.data ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.terminal_code} · {t.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Åpen sesjon</Label>
                <Select value={xSessionId} onValueChange={setXSessionId} disabled={!xTerminalId}>
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        !xTerminalId
                          ? "Velg terminal først"
                          : openSessionsQuery.isLoading
                            ? "Laster…"
                            : (openSessionsQuery.data ?? []).length === 0
                              ? "Ingen åpne sesjoner"
                              : "Velg sesjon…"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(openSessionsQuery.data ?? []).map((s) => {
                      const t = terminalsQuery.data?.find((x) => x.id === xTerminalId);
                      const code = t?.terminal_code ?? "?";
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          T-{code}-{s.session_number} · åpnet{" "}
                          {formatDistanceToNow(new Date(s.opened_at), {
                            addSuffix: true,
                            locale: nb,
                          })}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!xSessionId || xMutation.isPending}
                onClick={() => xMutation.mutate(xSessionId)}
              >
                {xMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Generer X-snapshot
              </Button>
              {xResult && (
                <>
                  <Button variant="outline" onClick={() => xMutation.mutate(xSessionId)}>
                    <RefreshCw className="h-4 w-4" /> Generer på nytt
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      downloadJson(
                        `x-snapshot-${xResult.terminal_code}-s${xResult.session_number}.json`,
                        xResult,
                      )
                    }
                  >
                    <Download className="h-4 w-4" /> Eksporter JSON
                  </Button>
                </>
              )}
            </div>
            <Alert>
              <FileText className="h-4 w-4" />
              <AlertDescription>
                X-snapshot lagres ikke. Bruk Z-rapport for permanent regnskapsrapport.
              </AlertDescription>
            </Alert>
          </Card>

          {xResult && (
            <div className="space-y-3">
              <div>
                <h2 className="text-lg font-semibold">
                  X-rapport for {xResult.header.terminal_code} sesjon{" "}
                  {xResult.header.session_number}
                </h2>
                {xGeneratedAt && (
                  <p className="text-sm text-muted-foreground">
                    Generert kl. {format(xGeneratedAt, "HH:mm:ss")} ({xResult.header.operator_name})
                  </p>
                )}
              </div>
              <RapportSummary
                totals={xResult.totals}
                mva_breakdown={xResult.mva_breakdown}
                payment_breakdown={xResult.payment_breakdown}
              />
            </div>
          )}
        </TabsContent>

        {/* ── TAB: Generer Z ── */}
        <TabsContent value="generer" className="space-y-4">
          <Card className="p-4 space-y-3 max-w-xl">
            <div>
              <Label className="text-xs text-muted-foreground">Terminal</Label>
              <Select value={genTerminalId} onValueChange={(v) => { setGenTerminalId(v); setGenCount(null); }}>
                <SelectTrigger>
                  <SelectValue placeholder="Velg terminal…" />
                </SelectTrigger>
                <SelectContent>
                  {(terminalsQuery.data ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.terminal_code} · {t.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground">Fra (00:00)</Label>
                <Input
                  type="date"
                  value={genFrom}
                  onChange={(e) => { setGenFrom(e.target.value); setGenCount(null); }}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Til (23:59)</Label>
                <Input
                  type="date"
                  value={genTo}
                  onChange={(e) => { setGenTo(e.target.value); setGenCount(null); }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={previewCount}
                disabled={!genTerminalId || genCountLoading}
              >
                {genCountLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Forhåndsvis antall
              </Button>
              {genCount != null && (
                <span className="text-sm text-muted-foreground">
                  {genCount} ikke-training-transaksjoner i perioden
                </span>
              )}
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="destructive"
                  disabled={!genTerminalId || zGenMutation.isPending}
                >
                  {zGenMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : null}
                  Generer Z-rapport
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Generer Z-rapport</AlertDialogTitle>
                  <AlertDialogDescription>
                    Dette låser perioden for valgt terminal og kan ikke angres. Sesjoner som
                    overlapper perioden må være lukket.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Avbryt</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => zGenMutation.mutate()}
                  >
                    Generer
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
