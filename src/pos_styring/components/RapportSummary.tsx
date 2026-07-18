import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Kanonisk totals-shape brukt av X- og Z-rapporter (etter kassasystemforskriftens krav).
export interface RapportTotals {
  gross: number;
  net: number;
  mva: number;
  transaction_count: number;
  refund_count: number;
  refund_total: number;
  // Utvidede felter (kassasystemforskrifta) — valgfrie for bakoverkompatibilitet
  sale_count?: number;
  correction_count?: number;
  correction_total?: number;
  discount_count?: number;
  discount_total?: number;
  receipt_count?: number;
  first_receipt_number?: string | null;
  last_receipt_number?: string | null;
}

export interface MvaBreakdownEntry {
  rate: number;
  net: number;
  vat: number;
  gross: number;
}

export interface PaymentBreakdownEntry {
  method: "cash" | "card" | "vipps" | "invoice" | "gift_card" | "other";
  amount: number;
  count: number;
}

export interface JournalCounts {
  receipt_copy?: number;
  proforma_view?: number;
  drawer_open_outside_sale?: number;
}

export interface CashSummary {
  opening_float?: number;
  closing_float?: number;
  counted_cash?: number;
  expected_cash?: number;
  cash_variance?: number;
  cash_movement?: number;
}

export interface GrandTotal {
  gross: number;
  returns: number;
  tx_count: number;
}

const PAYMENT_LABEL: Record<PaymentBreakdownEntry["method"], string> = {
  cash: "Kontant",
  card: "Kort",
  vipps: "Vipps",
  invoice: "Faktura",
  gift_card: "Gavekort",
  other: "Annet",
};

function fmtMoney(n: number | null | undefined) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(Number(n ?? 0));
}
function fmtInt(n: number | null | undefined) {
  return new Intl.NumberFormat("nb-NO").format(Number(n ?? 0));
}

interface Props {
  totals: RapportTotals;
  mva_breakdown: MvaBreakdownEntry[];
  payment_breakdown: PaymentBreakdownEntry[];
  journal_counts?: JournalCounts;
  cash_summary?: CashSummary;
  grand_total?: GrandTotal;
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "default" | "destructive" | "warning";
}) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-xl font-semibold tabular-nums " +
          (tone === "destructive"
            ? "text-destructive"
            : tone === "warning"
            ? "text-amber-600"
            : "")
        }
      >
        {value}
      </div>
    </Card>
  );
}

export default function RapportSummary({
  totals,
  mva_breakdown,
  payment_breakdown,
  journal_counts,
  cash_summary,
  grand_total,
}: Props) {
  const sortedMva = [...mva_breakdown].sort((a, b) => a.rate - b.rate);
  const jc = journal_counts ?? {};
  const cs = cash_summary ?? {};
  const variance = cs.cash_variance ?? (
    cs.counted_cash != null && cs.expected_cash != null
      ? cs.counted_cash - cs.expected_cash
      : undefined
  );

  return (
    <div className="space-y-6">
      {/* Omsetning */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Omsetning
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Brutto (inkl. MVA)" value={fmtMoney(totals.gross)} />
          <StatCard label="Netto (eks. MVA)" value={fmtMoney(totals.net)} />
          <StatCard label="MVA totalt" value={fmtMoney(totals.mva)} />
          <StatCard label="Antall transaksjoner" value={fmtInt(totals.transaction_count)} />
        </div>
      </section>

      {/* Salg/retur/korreksjoner */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Salg, retur og korreksjon
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Antall salg" value={fmtInt(totals.sale_count ?? 0)} />
          <StatCard label="Antall kvitteringer" value={fmtInt(totals.receipt_count ?? 0)} />
          <StatCard label="Antall returer" value={fmtInt(totals.refund_count)} />
          <StatCard
            label="Sum returer"
            value={fmtMoney(totals.refund_total)}
            tone={totals.refund_total < 0 ? "destructive" : "default"}
          />
          <StatCard label="Antall korreksjoner" value={fmtInt(totals.correction_count ?? 0)} />
          <StatCard label="Sum korreksjoner" value={fmtMoney(totals.correction_total ?? 0)} />
          <StatCard label="Antall rabatter" value={fmtInt(totals.discount_count ?? 0)} />
          <StatCard label="Sum rabatter" value={fmtMoney(totals.discount_total ?? 0)} />
        </div>
        {(totals.first_receipt_number || totals.last_receipt_number) && (
          <div className="text-xs text-muted-foreground font-mono">
            Kvitteringsnummer i periode: {totals.first_receipt_number ?? "—"} →{" "}
            {totals.last_receipt_number ?? "—"}
          </div>
        )}
      </section>

      {/* Journal-hendelser */}
      {(jc.receipt_copy != null || jc.proforma_view != null || jc.drawer_open_outside_sale != null) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Hendelser (journal)
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Kvitteringskopier" value={fmtInt(jc.receipt_copy ?? 0)} />
            <StatCard label="Proforma-visninger" value={fmtInt(jc.proforma_view ?? 0)} />
            <StatCard
              label="Skuffåpninger utenom salg"
              value={fmtInt(jc.drawer_open_outside_sale ?? 0)}
            />
          </div>
        </section>
      )}

      {/* MVA-fordeling */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          MVA-fordeling
        </h3>
        {sortedMva.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Ingen MVA-data.
          </div>
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
              {sortedMva.map((m) => (
                <TableRow key={m.rate}>
                  <TableCell className="font-mono">{m.rate}%</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(m.net)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtMoney(m.vat)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmtMoney(m.gross)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* Betalingsmetoder */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Betalingsmetoder
        </h3>
        {payment_breakdown.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            Ingen betalinger registrert.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Metode</TableHead>
                <TableHead className="text-right">Antall</TableHead>
                <TableHead className="text-right">Beløp</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payment_breakdown.map((p) => (
                <TableRow key={p.method}>
                  <TableCell>{PAYMENT_LABEL[p.method] ?? p.method}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.count}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {fmtMoney(p.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* Kontantoppgjør */}
      {(cs.opening_float != null ||
        cs.closing_float != null ||
        cs.counted_cash != null ||
        cs.expected_cash != null ||
        cs.cash_movement != null) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Kontantoppgjør
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cs.opening_float != null && (
              <StatCard label="Vekslekasse inn" value={fmtMoney(cs.opening_float)} />
            )}
            {cs.closing_float != null && (
              <StatCard label="Vekslekasse ut" value={fmtMoney(cs.closing_float)} />
            )}
            {cs.expected_cash != null && (
              <StatCard label="Forventet kontant" value={fmtMoney(cs.expected_cash)} />
            )}
            {cs.counted_cash != null && (
              <StatCard label="Opptalt kontant" value={fmtMoney(cs.counted_cash)} />
            )}
            {cs.cash_movement != null && (
              <StatCard label="Kontantbevegelse (salg)" value={fmtMoney(cs.cash_movement)} />
            )}
            {variance != null && (
              <StatCard
                label="Kontantavvik"
                value={fmtMoney(variance)}
                tone={Math.abs(variance) > 0 ? (Math.abs(variance) > 100 ? "destructive" : "warning") : "default"}
              />
            )}
          </div>
        </section>
      )}

      {/* Grand total (aldri nullstilt) */}
      {grand_total && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Grand total (aldri nullstilt)
          </h3>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard label="Akk. brutto" value={fmtMoney(grand_total.gross)} />
            <StatCard label="Akk. returer" value={fmtMoney(grand_total.returns)} />
            <StatCard label="Akk. transaksjoner" value={fmtInt(grand_total.tx_count)} />
          </div>
        </section>
      )}
    </div>
  );
}
