import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },
  header: { borderBottomWidth: 1, borderBottomColor: "#333", paddingBottom: 8, marginBottom: 16 },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  subtitle: { fontSize: 9, color: "#666", marginTop: 2 },
  imageWrap: { alignItems: "center", marginBottom: 16 },
  image: { maxHeight: 180, maxWidth: 260, objectFit: "contain" },
  section: { marginBottom: 12 },
  h3: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  body: { lineHeight: 1.4 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 3 },
  rowLabel: { flex: 1 },
  rowValue: { width: 80, textAlign: "right" },
  footer: { position: "absolute", bottom: 24, left: 40, right: 40, fontSize: 8, color: "#888", textAlign: "center" },
});

export type DatasheetData = {
  productName: string;
  imageUrl?: string | null;
  description?: string | null;
  ingredientsText?: string | null;
  allergensContains?: string[];
  allergensMay?: string[];
  nutrition?: Record<string, number | null> | null;
  isManual?: boolean;
};

const NUTRITION_FIELDS: { key: string; label: string }[] = [
  { key: "energy_kj", label: "Energi (kJ)" },
  { key: "energy_kcal", label: "Energi (kcal)" },
  { key: "fat_g", label: "Fett (g)" },
  { key: "saturated_fat_g", label: "— hvorav mettede fettsyrer (g)" },
  { key: "carbs_g", label: "Karbohydrater (g)" },
  { key: "sugars_g", label: "— hvorav sukkerarter (g)" },
  { key: "fiber_g", label: "Fiber (g)" },
  { key: "protein_g", label: "Protein (g)" },
  { key: "salt_g", label: "Salt (g)" },
];

export function DatasheetPDFDocument({ data }: { data: DatasheetData }) {
  const today = new Date().toLocaleDateString("nb-NO");
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{data.productName}</Text>
          <Text style={styles.subtitle}>Produktdatablad — Nøtterø Bakeri — {today}</Text>
        </View>

        {data.imageUrl ? (
          <View style={styles.imageWrap}>
            <Image style={styles.image} src={data.imageUrl} />
          </View>
        ) : null}

        {data.description ? (
          <View style={styles.section}>
            <Text style={styles.h3}>Beskrivelse</Text>
            <Text style={styles.body}>{data.description}</Text>
          </View>
        ) : null}

        {data.ingredientsText ? (
          <View style={styles.section}>
            <Text style={styles.h3}>Ingredienser</Text>
            <Text style={styles.body}>{data.ingredientsText}</Text>
            {data.isManual ? <Text style={styles.subtitle}>Lagt inn manuelt</Text> : null}
          </View>
        ) : null}

        {data.allergensContains && data.allergensContains.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h3}>Allergener</Text>
            <Text style={styles.body}>{data.allergensContains.join(", ")}</Text>
          </View>
        ) : null}

        {data.allergensMay && data.allergensMay.length > 0 ? (
          <View style={styles.section}>
            <Text style={styles.h3}>Kan inneholde spor av</Text>
            <Text style={styles.body}>{data.allergensMay.join(", ")}</Text>
          </View>
        ) : null}

        {data.nutrition ? (
          <View style={styles.section}>
            <Text style={styles.h3}>Næringsinnhold pr 100 g</Text>
            {NUTRITION_FIELDS.map((f) => {
              const v = data.nutrition?.[f.key];
              if (v == null) return null;
              return (
                <View key={f.key} style={styles.row}>
                  <Text style={styles.rowLabel}>{f.label}</Text>
                  <Text style={styles.rowValue}>{v}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <Text style={styles.footer} fixed>
          Generert fra Nøtterø Bakeri produktinfo
        </Text>
      </Page>
    </Document>
  );
}
