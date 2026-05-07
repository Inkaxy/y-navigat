import * as React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { PakkseddelPDFData } from "@/ordre/hooks/usePakkseddelPDF";

// NOTE: Use neutral palette only — @react-pdf/renderer doesn't read CSS tokens.
// Layout mirrors F82 DN_*.pdf in structure (not pixel-perfect).
const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#111111",
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  legalName: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  legalLine: { fontSize: 9, color: "#444" },
  titleBlock: { textAlign: "right" },
  title: { fontSize: 22, fontWeight: 700, letterSpacing: 1 },
  noteNumber: { fontSize: 11, marginTop: 4 },
  divider: { borderBottomWidth: 1, borderBottomColor: "#999", marginVertical: 8 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  metaCol: { width: "48%" },
  label: { fontSize: 8, textTransform: "uppercase", color: "#666", marginBottom: 2, letterSpacing: 0.5 },
  recipientName: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  recipientLine: { fontSize: 10 },
  metaPair: { flexDirection: "row", marginBottom: 2 },
  metaKey: { width: 70, color: "#666" },
  metaVal: { flex: 1, fontWeight: 700 },
  table: { borderTopWidth: 1, borderTopColor: "#222", marginTop: 6 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
    paddingVertical: 4,
    fontWeight: 700,
    fontSize: 9,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottomWidth: 0.5,
    borderBottomColor: "#ddd",
  },
  colNr: { width: 60 },
  colName: { flex: 1, paddingRight: 8 },
  colQty: { width: 50, textAlign: "right", paddingRight: 16 },
  colUnit: { width: 50, textAlign: "left", paddingLeft: 4 },
  bottomRow: { marginTop: 16, flexDirection: "row", justifyContent: "space-between" },
  totals: { fontSize: 10 },
  signatureBlock: { marginTop: 36, flexDirection: "row", justifyContent: "space-between" },
  signatureField: { width: "45%" },
  signatureLine: { borderBottomWidth: 1, borderBottomColor: "#111", height: 28 },
  signatureLabel: { fontSize: 8, color: "#666", marginTop: 2 },
  footer: {
    position: "absolute",
    bottom: 18,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 8,
    color: "#777",
  },
  notes: { marginTop: 14, padding: 8, backgroundColor: "#f4f4f4", fontSize: 9 },
});

function formatNorwegianDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

interface Props {
  data: PakkseddelPDFData;
}

/**
 * Standalone én-side pakkseddel-PDF.
 * For bulk-bruk, importer `PakkseddelPDFPage` direkte og pakk inn i felles <Document>.
 */
export function PakkseddelPDFDocument({ data }: Props) {
  return (
    <Document title={`Pakkseddel ${data.display_number}`} author={data.legal_entity.legal_name}>
      <PakkseddelPDFPage data={data} />
    </Document>
  );
}

/** Selve <Page>-innholdet — gjenbrukbart i bulk-PDF. */
export function PakkseddelPDFPage({ data }: Props) {
  const totalLines = data.lines.length;
  const totalQty = data.lines.reduce((sum, l) => sum + l.quantity, 0);
  const orderText =
    data.order_numbers.length === 0
      ? "—"
      : data.order_numbers.length === 1
      ? data.order_numbers[0]
      : data.order_numbers.join(", ");

  const hasAddress =
    !!data.delivery_address.line1 || !!data.delivery_address.postal_code || !!data.delivery_address.city;

  return (
    <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.legalName}>{data.legal_entity.legal_name}</Text>
            {data.legal_entity.invoice_address_line1 && (
              <Text style={styles.legalLine}>{data.legal_entity.invoice_address_line1}</Text>
            )}
            {(data.legal_entity.invoice_postal_code || data.legal_entity.invoice_city) && (
              <Text style={styles.legalLine}>
                {data.legal_entity.invoice_postal_code} {data.legal_entity.invoice_city}
              </Text>
            )}
            <Text style={styles.legalLine}>Org.nr: {data.legal_entity.org_number}</Text>
          </View>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>PAKKSEDDEL</Text>
            <Text style={styles.noteNumber}>Pakkseddel nr. {data.display_number}</Text>
            <Text style={styles.legalLine}>Dato: {formatNorwegianDate(data.delivery_date)}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Recipient + meta */}
        <View style={styles.metaRow}>
          <View style={styles.metaCol}>
            <Text style={styles.label}>Mottaker</Text>
            <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap" }}>
              <Text style={styles.recipientName}>{data.customer.name}</Text>
              {data.customer.customer_number && data.customer.customer_number !== "—" && (
                <Text style={{ fontSize: 9, color: "#666", marginLeft: 6 }}>
                  #{data.customer.customer_number}
                </Text>
              )}
            </View>
            {hasAddress && (
              <>
                {data.delivery_address.line1 && (
                  <Text style={styles.recipientLine}>{data.delivery_address.line1}</Text>
                )}
                {data.delivery_address.line2 && (
                  <Text style={styles.recipientLine}>{data.delivery_address.line2}</Text>
                )}
                {(data.delivery_address.postal_code || data.delivery_address.city) && (
                  <Text style={styles.recipientLine}>
                    {data.delivery_address.postal_code} {data.delivery_address.city}
                  </Text>
                )}
              </>
            )}
          </View>
          <View style={styles.metaCol}>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Kundenr:</Text>
              <Text style={styles.metaVal}>
                {data.customer.customer_number && data.customer.customer_number !== "—"
                  ? `#${data.customer.customer_number}`
                  : "—"}
              </Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Leveringsdato:</Text>
              <Text style={styles.metaVal}>{formatNorwegianDate(data.delivery_date)}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>Tur:</Text>
              <Text style={styles.metaVal}>{data.route_label ?? "—"}</Text>
            </View>
            <View style={styles.metaPair}>
              <Text style={styles.metaKey}>
                {data.order_numbers.length > 1 ? "Ordre:" : "Ordre:"}
              </Text>
              <Text style={styles.metaVal}>{orderText}</Text>
            </View>
          </View>
        </View>

        {/* Lines */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.colNr}>Varenr</Text>
            <Text style={styles.colName}>Beskrivelse</Text>
            <Text style={styles.colQty}>Antall</Text>
            <Text style={styles.colUnit}>Enhet</Text>
          </View>
          {data.lines.map((l) => (
            <View key={l.id} style={styles.row} wrap={false}>
              <Text style={styles.colNr}>{l.product_number}</Text>
              <Text style={styles.colName}>{l.product_name}</Text>
              <Text style={styles.colQty}>{l.quantity}</Text>
              <Text style={styles.colUnit}>{l.sales_unit}</Text>
            </View>
          ))}
          {data.lines.length === 0 && (
            <View style={styles.row}>
              <Text style={{ flex: 1, textAlign: "center", color: "#999" }}>Ingen linjer</Text>
            </View>
          )}
        </View>

        {/* Totals */}
        <View style={styles.bottomRow}>
          <Text style={styles.totals}>
            Totalt {totalLines} linje{totalLines === 1 ? "" : "r"} — {totalQty} stk
          </Text>
        </View>

        {data.notes && (
          <View style={styles.notes}>
            <Text>{data.notes}</Text>
          </View>
        )}

        {/* Signature */}
        <View style={styles.signatureBlock}>
          <View style={styles.signatureField}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Mottatt av (signatur)</Text>
          </View>
          <View style={styles.signatureField}>
            <View style={styles.signatureLine} />
            <Text style={styles.signatureLabel}>Dato</Text>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer} fixed>
          <Text>Pakkseddel nr. {data.display_number}</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
          />
        </View>
      </Page>
  );
}

