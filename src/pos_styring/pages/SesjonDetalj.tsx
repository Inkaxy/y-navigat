import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceStrict } from "date-fns";
import { nb } from "date-fns/locale";
import { AlertCircle, ArrowLeft, Download, FileText } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

type SessionStatus = "open" | "closed";
type TxType = "sale" | "return" | "correction" | "training";

interface SessionDetail {
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
  legal_entity_id: string;
  operator_name: string;
}
interface TxRow {
  id: string;
  receipt_number: string;
  transaction_type: TxType;
  created_at: string;
  subtotal_excl_mva: number;
  total_mva: number;
  total_incl_mva: number;
  is_training: boolean;
}
interface ZRow {
  id: string;
  z_number: number;
  closed_at: string;
  period_start: string;
  period_end: string;
  total_sales_incl_mva: number;
  transaction_count: number;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}
function fmtDisplayId(t: string, n: number) {
  return `T-${t}-${n}`;
}
function getMsg(e: unknown) {
  return typeof e === "object" && e !== null && "message" in e
    ? String((e as { message?: string }).message)
    : "Ukjent feil";
}

async function fetchSession(id: string): Promise<SessionDetail | null> {
  const { data, error } = await supabase
    .from("pos_sessions")
    .select(
      "id, session_number, status, opened_at, closed_at, opening_float, closing_float, counted_cash, expected_cash, terminal_id, terminal:pos_terminals(legal_entity_id, terminal_code, display_name), operator:pos_operators(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const s = data as any;
  return {
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
    legal_entity_id: s.terminal?.legal_entity_id ?? "",
    operator_name: s.operator?.display_name ?? "?",
  };
}

async function fetchTransactions(sessionId: string): Promise<TxRow[]> {
  const { data, error } = await supabase
    .from("pos_transactions")
    .select(
      "id, receipt_number, transaction_type, created_at, subtotal_excl_mva, total_mva, total_incl_mva, is_training",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    receipt_number: r.receipt_number,
    transaction_type: r.transaction_type,
    created_at: r.created_at,
    subtotal_excl_mva: Number(r.subtotal_excl_mva),
    total_mva: Number(r.total_mva),
    total_incl_mva: Number(r.total_incl_mva),
    is_training: r.is_training,
  }));
}

async function fetchZCoverage(
  terminalId: string,
  openedAt: string,
  closedAt: string | null,
): Promise<ZRow[]> {
  if (!closedAt) return [];
  const { data, error } = await supabase
    .from("pos_z_reports")
    .select("id, z_number, closed_at, period_start, period_end, total_sales_incl_mva, transaction_count")
    .eq("terminal_id", terminalId)
    .lte("period_start", closedAt)
    .gte("period_end", openedAt)
    .order("z_number", { ascending: false });
  if (error) throw error;
  return (data ?? []) as ZRow[];
}

function TxTypeBadge({ type, training }: { type: TxType; training: boolean }) {
  if (training || type === "training") {
    return (
      <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning hover:bg-warning/10">
        Trening
      </Badge>
    );
  }
  const map: Record<TxType, { label: string; cls: string }> = {
    sale: { label: "Salg", cls: "border-success/30 bg-success/10 text-success" },
    return: { label: "Retur", cls: "border-destructive/30 bg-destructive/10 text-destructive" },
    correction: { label: "Korreksjon", cls: "border-warning/30 bg-warning/10 text-warning" },
    training: { label: "Trening", cls: "border-warning/30 bg-warning/10 text-warning" },
  };
  const m = map[type] ?? { label: type, cls: "" };
  return (
    <Badge variant="outline" className={cn("hover:bg-inherit", m.cls)}>
      {m.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: SessionStatus }) {
  if (status === "open") {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success hover:bg-success/10">
        Åpen
      </Badge>
    );
  }
  return <Badge variant="outline" className="border-muted bg-muted text-muted-foreground">Lukket</Badge>;
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

export default function SesjonDetalj() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const sessionQuery = useQuery({
    queryKey: ["pos_session", id],
    queryFn: () => fetchSession(id!),
    enabled: !!id,
  });
  const txQuery = useQuery({
    queryKey: ["pos_transactions_for_session", id],
    queryFn: () => fetchTransactions(id!),
    enabled: !!id,
  });
  const zQuery = useQuery({
    queryKey: [
      "pos_z_coverage",
      sessionQuery.data?.terminal_id,
      sessionQuery.data?.opened_at,
      sessionQuery.data?.closed_at,
    ],
    queryFn: () =>
      fetchZCoverage(
        sessionQuery.data!.terminal_id,
        sessionQuery.data!.opened_at,
        sessionQuery.data!.closed_at,
      ),
    enabled: !!sessionQuery.data && sessionQuery.data.status === "closed",
  });

  const totals = useMemo(() => {
    const rows = txQuery.data ?? [];
    const t = { tx: 0, returns: 0, corrections: 0, training: 0, brutto: 0, mva: 0, netto: 0 };
    for (const r of rows) {
      if (r.is_training || r.transaction_type === "training") {
        t.training += 1;
        continue;
      }
      t.tx += 1;
      if (r.transaction_type === "return") t.returns += 1;
      if (r.transaction_type === "correction") t.corrections += 1;
      t.brutto += r.total_incl_mva;
      t.mva += r.total_mva;
      t.netto += r.subtotal_excl_mva;
    }
    return t;
  }, [txQuery.data]);

  if (sessionQuery.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (sessionQuery.error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getMsg(sessionQuery.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const session = sessionQuery.data;
  if (!session) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/sesjoner")}>
          <ArrowLeft className="h-4 w-4" />
          Tilbake
        </Button>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Sesjonen finnes ikke eller du har ikke tilgang.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const duration = session.closed_at
    ? formatDistanceStrict(new Date(session.opened_at), new Date(session.closed_at), { locale: nb })
    : formatDistanceStrict(new Date(session.opened_at), new Date(), { locale: nb }) + " (pågår)";

  const hasVariance = session.counted_cash != null && session.expected_cash != null;
  const variance = hasVariance ? session.counted_cash! - session.expected_cash! : null;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/sesjoner")}>
          <ArrowLeft className="h-4 w-4" />
          Tilbake til sesjoner
        </Button>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight font-mono">
              {fmtDisplayId(session.terminal_code, session.session_number)}
            </h1>
            <StatusBadge status={session.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {session.terminal_name} · {session.operator_name}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Åpnet</div>
          <div className="mt-1 text-sm font-medium">
            {format(new Date(session.opened_at), "yyyy-MM-dd HH:mm")}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Lukket</div>
          <div className="mt-1 text-sm font-medium">
            {session.closed_at ? format(new Date(session.closed_at), "yyyy-MM-dd HH:mm") : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Varighet</div>
          <div className="mt-1 text-sm font-medium">{duration}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Antall transaksjoner</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{totals.tx}</div>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sum brutto</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(totals.brutto)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sum MVA</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(totals.mva)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sum netto</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">{fmtMoney(totals.netto)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Returer / Korreksjoner</div>
          <div className="mt-1 text-xl font-semibold tabular-nums">
            {totals.returns} <span className="text-muted-foreground">/</span> {totals.corrections}
          </div>
          {totals.training > 0 && (
            <div className="mt-1 text-xs text-warning">{totals.training} trening</div>
          )}
        </Card>
      </div>

      {(session.opening_float != null || session.closing_float != null || hasVariance) && (
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Kontant-oppgjør
          </h2>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Åpningsfloat</dt>
              <dd className="font-mono">{session.opening_float != null ? fmtMoney(session.opening_float) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Lukkings-float</dt>
              <dd className="font-mono">{session.closing_float != null ? fmtMoney(session.closing_float) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Talt kontant</dt>
              <dd className="font-mono">{session.counted_cash != null ? fmtMoney(session.counted_cash) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Forventet kontant</dt>
              <dd className="font-mono">{session.expected_cash != null ? fmtMoney(session.expected_cash) : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Variance</dt>
              <dd
                className={cn(
                  "font-mono",
                  variance != null && variance < 0 && "text-destructive",
                  variance != null && variance > 0 && "text-warning",
                )}
              >
                {variance != null ? fmtMoney(variance) : "—"}
              </dd>
            </div>
          </dl>
        </Card>
      )}

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Kvitteringer
        </h2>
        {txQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (txQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Ingen transaksjoner registrert på denne sesjonen.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kvittering-nr</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Tid</TableHead>
                <TableHead className="text-right">Netto</TableHead>
                <TableHead className="text-right">MVA</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(txQuery.data ?? []).map((t) => (
                <TableRow
                  key={t.id}
                  interactive
                  onClick={() => navigate(`/pos-styring/transaksjoner/${t.id}`)}
                >
                  <TableCell className="font-mono text-sm">{t.receipt_number}</TableCell>
                  <TableCell><TxTypeBadge type={t.transaction_type} training={t.is_training} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(t.created_at), "HH:mm:ss")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(t.subtotal_excl_mva)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(t.total_mva)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{fmtMoney(t.total_incl_mva)}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/pos-styring/transaksjoner/${t.id}`);
                      }}
                    >
                      Detaljer
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Z-rapporter som dekker denne sesjonen
        </h2>
        {session.status === "open" ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Sesjonen er åpen — Z-rapport kan først tas etter at sesjonen er lukket.
            </AlertDescription>
          </Alert>
        ) : zQuery.isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (zQuery.data ?? []).length === 0 ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Ingen Z-rapport dekker denne sesjonen ennå. Z genereres fra POS-klienten eller via Rapporter (bygges i F5).
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {(zQuery.data ?? []).map((z) => (
              <Card key={z.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="font-mono text-sm font-medium">Z-{z.z_number}</span>
                      <Badge variant="outline" className="text-xs">
                        {z.transaction_count} tx · {fmtMoney(Number(z.total_sales_incl_mva))}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Periode: {format(new Date(z.period_start), "yyyy-MM-dd HH:mm")} →{" "}
                      {format(new Date(z.period_end), "yyyy-MM-dd HH:mm")}
                      {" · "}generert {format(new Date(z.closed_at), "yyyy-MM-dd HH:mm")}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => downloadJson(`z-rapport-${z.z_number}.json`, z)}
                    >
                      <Download className="h-4 w-4" />
                      JSON
                    </Button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          <Button variant="ghost" size="sm" disabled asChild>
                            <Link to="#">Full rapport</Link>
                          </Button>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>Bygges i F5 (Rapporter)</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
