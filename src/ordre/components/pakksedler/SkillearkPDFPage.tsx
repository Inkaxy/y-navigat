import * as React from "react";
import { Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: "Helvetica",
    color: "#111111",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    fontSize: 18,
    letterSpacing: 4,
    color: "#666",
    marginBottom: 24,
    textTransform: "uppercase",
  },
  tourName: {
    fontSize: 64,
    fontWeight: 700,
    textAlign: "center",
    marginBottom: 32,
    letterSpacing: 1,
  },
  meta: { fontSize: 14, marginBottom: 6, color: "#333" },
  metaStrong: { fontSize: 14, marginBottom: 6, color: "#111", fontWeight: 700 },
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
});

function formatNorwegianDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T12:00:00");
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

interface Props {
  tourLabel: string; // f.eks. "FØRSTE TUR" eller "UTEN TUR"
  deliveryDate: string;
  noteCount: number;
}

export function SkillearkPDFPage({ tourLabel, deliveryDate, noteCount }: Props) {
  return (
    <Page size="A4" style={styles.page}>
      <Text style={styles.label}>Tur</Text>
      <Text style={styles.tourName}>{tourLabel.toUpperCase()}</Text>
      <Text style={styles.meta}>Leveransedato</Text>
      <Text style={styles.metaStrong}>{formatNorwegianDate(deliveryDate)}</Text>
      <View style={{ height: 12 }} />
      <Text style={styles.meta}>Antall pakksedler</Text>
      <Text style={styles.metaStrong}>{noteCount}</Text>

      <View style={styles.footer} fixed>
        <Text>{tourLabel.toUpperCase()}</Text>
        <Text
          render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`}
        />
      </View>
    </Page>
  );
}
