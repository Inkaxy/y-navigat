import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { nb } from "date-fns/locale";
import { AlertCircle, ArrowLeft, ExternalLink, Printer } from "lucide-react";

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
import {
  formatReceiptDisplay,
  parseMvaBreakdown,
  parsePaymentSummary,
  parseProductSnapshot,
  paymentLabel,
  type DiningMode,
  type TransactionType,
} from "@/pos_styring/lib/pos-types";

interface TxDetail {
  id: string;
  receipt_number: string | null;
  receipt_sequence: number;
  transaction_type: TransactionType;
  is_training: boolean;
  dining_mode: DiningMode | string;
  created_at: string;
  subtotal_excl_mva: number;
  total_mva: number;
  total_incl_mva: number;
  mva_breakdown: unknown;
  payment_summary: unknown;
  reference_transaction_id: string | null;
  session_id: string;
  customer_id: string | null;
  customer_name: string | null;
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
  operator_name: string;
}

interface LineRow {
  id: string;
  line_number: number;
  product_id: string | null;
  product_snapshot: unknown;
  quantity: number;
  unit_price_excl_mva: number;
  line_discount: number;
  mva_rate: number;
  line_subtotal_excl_mva: number;
  line_mva: number;
  line_total_incl_mva: number;
  dining_mode_override: string | null;
}

function fmtMoney(n: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}
function getErr(e: unknown) {
  return typeof e === "object" && e !== null && "message" in e
    ? String((e as { message?: string }).message)
    : "Ukjent feil";
}

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

async function fetchTransaction(id: string): Promise<TxDetail | null> {
  const { data, error } = await supabase
    .from("pos_transactions")
    .select(
      "id, receipt_number, receipt_sequence, transaction_type, is_training, dining_mode, created_at, subtotal_excl_mva, total_mva, total_incl_mva, mva_breakdown, payment_summary, reference_transaction_id, session_id, customer_id, terminal_id, terminal:pos_terminals(terminal_code, display_name), operator:pos_operators(display_name), customer:pos_customers(display_name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id,
    receipt_number: r.receipt_number ?? null,
    receipt_sequence: Number(r.receipt_sequence),
    transaction_type: r.transaction_type,
    is_training: !!r.is_training,
    dining_mode: r.dining_mode,
    created_at: r.created_at,
    subtotal_excl_mva: Number(r.subtotal_excl_mva) || 0,
    total_mva: Number(r.total_mva) || 0,
    total_incl_mva: Number(r.total_incl_mva) || 0,
    mva_breakdown: r.mva_breakdown,
    payment_summary: r.payment_summary,
    reference_transaction_id: r.reference_transaction_id ?? null,
    session_id: r.session_id,
    customer_id: r.customer_id ?? null,
    customer_name: r.customer?.display_name ?? null,
    terminal_id: r.terminal_id,
    terminal_code: r.terminal?.terminal_code ?? "?",
    terminal_name: r.terminal?.display_name ?? "?",
    operator_name: r.operator?.display_name ?? "?",
  };
}

async function fetchLines(transactionId: string): Promise<LineRow[]> {
  const { data, error } = await supabase
    .from("pos_transaction_lines")
    .select(
      "id, line_number, product_id, product_snapshot, quantity, unit_price_excl_mva, line_discount, mva_rate, line_subtotal_excl_mva, line_mva, line_total_incl_mva, dining_mode_override",
    )
    .eq("transaction_id", transactionId)
    .order("line_number", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    line_number: Number(r.line_number),
    product_id: r.product_id ?? null,
    product_snapshot: r.product_snapshot,
    quantity: Number(r.quantity) || 0,
    unit_price_excl_mva: Number(r.unit_price_excl_mva) || 0,
    line_discount: Number(r.line_discount) || 0,
    mva_rate: Number(r.mva_rate) || 0,
    line_subtotal_excl_mva: Number(r.line_subtotal_excl_mva) || 0,
    line_mva: Number(r.line_mva) || 0,
    line_total_incl_mva: Number(r.line_total_incl_mva) || 0,
    dining_mode_override: r.dining_mode_override ?? null,
  }));
}

async function fetchRefReceiptDisplay(refId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("pos_transactions")
    .select("receipt_number, receipt_sequence, terminal:pos_terminals(terminal_code)")
    .eq("id", refId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return formatReceiptDisplay({
    receipt_number: r.receipt_number,
    terminal_code: r.terminal?.terminal_code ?? "?",
    receipt_sequence: r.receipt_sequence,
  });
}

export default function TransaksjonDetalj() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const txQuery = useQuery({
    queryKey: ["pos_transaction", id],
    queryFn: () => fetchTransaction(id!),
    enabled: !!id,
  });
  const linesQuery = useQuery({
    queryKey: ["pos_transaction_lines", id],
    queryFn: () => fetchLines(id!),
    enabled: !!id,
  });
  const refQuery = useQuery({
    queryKey: ["pos_transaction_ref", txQuery.data?.reference_transaction_id],
    queryFn: () => fetchRefReceiptDisplay(txQuery.data!.reference_transaction_id!),
    enabled: !!txQuery.data?.reference_transaction_id,
  });

  const tx = txQuery.data;

  const mva = useMemo(() => (tx ? parseMvaBreakdown(tx.mva_breakdown) : []), [tx]);
  const payments = useMemo(() => (tx ? parsePaymentSummary(tx.payment_summary) : null), [tx]);

  if (txQuery.isLoading) {
    return (
      <div className="p-6 space-y-3">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (txQuery.error) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{getErr(txQuery.error)}</AlertDescription>
        </Alert>
      </div>
    );
  }
  if (!tx) {
    return (
      <div className="p-6 space-y-3">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/transaksjoner")}>
          <ArrowLeft className="h-4 w-4" />
          Tilbake
        </Button>
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>Transaksjonen finnes ikke eller du har ikke tilgang.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const display = formatReceiptDisplay({
    receipt_number: tx.receipt_number,
    terminal_code: tx.terminal_code,
    receipt_sequence: tx.receipt_sequence,
  });

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate("/pos-styring/transaksjoner")}>
          <ArrowLeft className="h-4 w-4" />
          Tilbake til transaksjoner
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button variant="outline" size="sm" disabled>
                <Printer className="h-4 w-4" />
                Skriv ut kvittering
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>Bygges i F4.2</TooltipContent>
        </Tooltip>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight font-mono">{display}</h1>
          <TxTypeBadge type={tx.transaction_type} training={tx.is_training} />
          {tx.dining_mode && (
            <Badge variant="outline" className="text-xs">
              {tx.dining_mode === "eatin" ? "Spise her" : tx.dining_mode === "takeaway" ? "Takeaway" : tx.dining_mode}
            </Badge>
          )}
          {tx.reference_transaction_id && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => navigate(`/pos-styring/transaksjoner/${tx.reference_transaction_id}`)}
            >
              <ExternalLink className="h-3 w-3" />
              Refererer til {refQuery.data ?? "kvittering"}
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {format(new Date(tx.created_at), "yyyy-MM-dd HH:mm:ss")} ·{" "}
          {formatDistanceToNow(new Date(tx.created_at), { addSuffix: true, locale: nb })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Terminal</div>
          <div className="mt-1 text-sm font-medium">
            <span className="font-mono text-xs text-muted-foreground">{tx.terminal_code}</span>{" "}
            {tx.terminal_name}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Operatør</div>
          <div className="mt-1 text-sm font-medium">{tx.operator_name}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Sesjon</div>
          <div className="mt-1 text-sm font-medium">
            <Link
              to={`/pos-styring/sesjoner/${tx.session_id}`}
              className="text-primary hover:underline"
            >
              Åpne sesjon
            </Link>
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Kunde</div>
          <div className="mt-1 text-sm font-medium">
            {tx.customer_id ? (
              <Link to={`/kunder/${tx.customer_id}`} className="text-primary hover:underline">
                {tx.customer_name ?? "Åpne kunde"}
              </Link>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Linjer
        </h2>
        {linesQuery.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : (linesQuery.data ?? []).length === 0 ? (
          <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
            Ingen linjer registrert.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12 text-right">#</TableHead>
                <TableHead>Produkt</TableHead>
                <TableHead className="text-right">Antall</TableHead>
                <TableHead className="text-right">Pris à</TableHead>
                <TableHead className="text-right">Rabatt</TableHead>
                <TableHead className="text-right">Netto</TableHead>
                <TableHead className="text-right">MVA</TableHead>
                <TableHead className="text-right">Brutto</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(linesQuery.data ?? []).map((l) => {
                const snap = parseProductSnapshot(l.product_snapshot);
                return (
                  <TableRow key={l.id}>
                    <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                      {l.line_number}
                    </TableCell>
                    <TableCell className="text-sm">
                      <div className="font-medium">{snap.display_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {snap.display_number && (
                          <span className="font-mono">{snap.display_number}</span>
                        )}
                        {snap.display_number && (snap.unit || l.dining_mode_override) && " · "}
                        {snap.unit && <span>{snap.unit}</span>}
                        {l.dining_mode_override && (
                          <span className="ml-1 italic">
                            ({l.dining_mode_override === "eatin" ? "spise her" : "takeaway"})
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.quantity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(l.unit_price_excl_mva)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {l.line_discount > 0 ? `-${fmtMoney(l.line_discount)}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtMoney(l.line_subtotal_excl_mva)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmtMoney(l.line_mva)}{" "}
                      <span className="text-xs">({l.mva_rate}%)</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {fmtMoney(l.line_total_incl_mva)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            MVA-oppsummering
          </h2>
          {mva.length === 0 ? (
            <div className="text-sm text-muted-foreground">Ingen MVA-fordeling registrert.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sats</TableHead>
                  <TableHead className="text-right">Netto</TableHead>
                  <TableHead className="text-right">MVA</TableHead>
                  <TableHead className="text-right">Brutto</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mva.map((m, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{m.rate}%</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(m.net)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(m.vat)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(m.gross)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <dl className="mt-4 space-y-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal eks. mva</dt>
              <dd className="tabular-nums">{fmtMoney(tx.subtotal_excl_mva)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Sum MVA</dt>
              <dd className="tabular-nums">{fmtMoney(tx.total_mva)}</dd>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold">
              <dt>Total inkl. mva</dt>
              <dd className="tabular-nums">{fmtMoney(tx.total_incl_mva)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Betaling
          </h2>
          {!payments || payments.payments.length === 0 ? (
            <div className="text-sm text-muted-foreground">Ingen betalinger registrert.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metode</TableHead>
                  <TableHead>Referanse</TableHead>
                  <TableHead className="text-right">Beløp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.payments.map((p, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-sm">{paymentLabel(p)}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {p.reference ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(p.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {payments && (
            <dl className="mt-4 space-y-1 border-t pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Sum betalt</dt>
                <dd className="tabular-nums">{fmtMoney(payments.total_paid)}</dd>
              </div>
              {payments.change_given != null && payments.change_given > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Vekslepenger</dt>
                  <dd className="tabular-nums">{fmtMoney(payments.change_given)}</dd>
                </div>
              )}
              {Math.abs(payments.total_paid - tx.total_incl_mva) > 0.01 && (
                <div className="mt-2">
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Sum betalt avviker fra total: {fmtMoney(payments.total_paid - tx.total_incl_mva)}
                    </AlertDescription>
                  </Alert>
                </div>
              )}
            </dl>
          )}
        </Card>
      </div>
    </div>
  );
}
