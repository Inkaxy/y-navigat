import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface RapportTotals {
  sales_incl: number;
  sales_excl: number;
  mva: number;
  tx_count: number;
  refund_count: number;
  refund_total: number;
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

const PAYMENT_LABEL: Record<PaymentBreakdownEntry["method"], string> = {
  cash: "Kontant",
  card: "Kort",
  vipps: "Vipps",
  invoice: "Faktura",
  gift_card: "Gavekort",
  other: "Annet",
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK" }).format(n);
}

interface Props {
  totals: RapportTotals;
  mva_breakdown: MvaBreakdownEntry[];
  payment_breakdown: PaymentBreakdownEntry[];
  variant?: "compact" | "full";
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "default" | "destructive" }) {
  return (
    <Card className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          "mt-1 text-xl font-semibold tabular-nums " +
          (tone === "destructive" ? "text-destructive" : "")
        }
      >
        {value}
      </div>
    </Card>
  );
}

export default function RapportSummary({ totals, mva_breakdown, payment_breakdown }: Props) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Brutto (inkl. MVA)" value={fmtMoney(totals.sales_incl)} />
        <StatCard label="MVA totalt" value={fmtMoney(totals.mva)} />
        <StatCard label="Netto (eks. MVA)" value={fmtMoney(totals.sales_excl)} />
        <StatCard label="Antall transaksjoner" value={String(totals.tx_count)} />
        <StatCard label="Antall returer" value={String(totals.refund_count)} />
        <StatCard
          label="Sum returer"
          value={fmtMoney(totals.refund_total)}
          tone={totals.refund_total < 0 ? "destructive" : "default"}
        />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          MVA-fordeling
        </h3>
        {mva_breakdown.length === 0 ? (
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
              {mva_breakdown.map((m) => (
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
      </div>

      <div className="space-y-2">
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
      </div>
    </div>
  );
}
