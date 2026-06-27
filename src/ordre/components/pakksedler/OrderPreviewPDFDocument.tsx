import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

type Order = {
  id: string;
  order_number: string | number | null;
  delivery_date: string | null;
  customer_snapshot: Record<string, any> | null;
  internal_notes: string | null;
  customer_notes: string | null;
  total_incl_vat: number | null;
};

type Line = {
  id: string;
  line_number: number | null;
  quantity: number;
  sales_unit: string | null;
  product_snapshot: Record<string, any> | null;
  unit_price_incl_vat: number | null;
  line_total_incl_vat: number | null;
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  h1: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  meta: { color: "#444", marginBottom: 12 },
  section: { marginBottom: 12 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", paddingVertical: 4 },
  th: { fontWeight: 700, backgroundColor: "#f3f4f6" },
  c1: { width: 24, textAlign: "right" },
  c2: { width: 60 },
  c3: { flex: 1 },
  c4: { width: 50, textAlign: "right" },
  c5: { width: 40 },
  c6: { width: 70, textAlign: "right" },
  totals: { marginTop: 12, alignItems: "flex-end" },
  note: { marginTop: 8, padding: 6, backgroundColor: "#fef3c7", color: "#78350f", fontStyle: "italic" },
});

function fmt(n: number | null | undefined): string {
  if (n == null) return "";
  return new Intl.NumberFormat("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

type Props = {
  order: Order;
  lines: Line[];
  tourLabel: string | null;
};

export function OrderPreviewPDFDocument({ order, lines, tourLabel }: Props) {
  const snap = (order.customer_snapshot ?? {}) as Record<string, any>;
  const customerName = snap.display_name ?? snap.name ?? "—";
  const customerNumber = snap.customer_number ?? snap.number ?? "";
  const notes = order.internal_notes ?? order.customer_notes ?? null;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.section}>
          <Text style={styles.h1}>Ordre {order.order_number ?? ""}</Text>
          <Text style={styles.meta}>
            {customerNumber ? `${customerNumber} · ` : ""}
            {customerName}
            {"\n"}
            Leveringsdato: {order.delivery_date ?? "—"}
            {tourLabel ? ` · ${tourLabel}` : ""}
          </Text>
        </View>

        <View style={[styles.row, styles.th]}>
          <Text style={styles.c1}>#</Text>
          <Text style={styles.c2}>Nr.</Text>
          <Text style={styles.c3}>Vare</Text>
          <Text style={styles.c4}>Antall</Text>
          <Text style={styles.c5}>Enhet</Text>
          <Text style={styles.c6}>Sum</Text>
        </View>
        {lines.map((l, i) => {
          const s = (l.product_snapshot ?? {}) as Record<string, any>;
          return (
            <View key={l.id} style={styles.row}>
              <Text style={styles.c1}>{l.line_number ?? i + 1}</Text>
              <Text style={styles.c2}>{s.product_number ?? s.number ?? ""}</Text>
              <Text style={styles.c3}>{s.display_name ?? s.name ?? "—"}</Text>
              <Text style={styles.c4}>{l.quantity}</Text>
              <Text style={styles.c5}>{l.sales_unit ?? ""}</Text>
              <Text style={styles.c6}>{fmt(l.line_total_incl_vat)}</Text>
            </View>
          );
        })}

        <View style={styles.totals}>
          <Text>Totalt inkl. mva: {fmt(order.total_incl_vat)} kr</Text>
        </View>

        {notes && <Text style={styles.note}>{notes}</Text>}
      </Page>
    </Document>
  );
}
