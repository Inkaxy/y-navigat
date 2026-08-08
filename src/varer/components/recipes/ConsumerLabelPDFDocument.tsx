import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type LabelSizeKey = "60x40" | "100x70" | "a6";

export const LABEL_SIZES: Record<LabelSizeKey, { label: string; width: number; height: number }> = {
  // Punkt = mm / 25.4 * 72
  "60x40": { label: "60 × 40 mm", width: 170.08, height: 113.39 },
  "100x70": { label: "100 × 70 mm", width: 283.46, height: 198.43 },
  a6: { label: "A6 (105 × 148 mm)", width: 297.64, height: 419.53 },
};

/**
 * Minste tillatte skriftstørrelse på ingredienslisten.
 * Matinformasjonsforordningen krever x-høyde ≥ 1,2 mm. For vanlige grotesker er
 * x-høyden ca. 0,52 av punktstørrelsen ⇒ 1,2 mm / 0,52 ≈ 2,31 mm ≈ 6,54 pt.
 */
export const MIN_INGREDIENT_FONT_PT = 6.6;

export interface ConsumerLabelNutritionRow {
  label: string;
  value: string;
  indent?: boolean;
}

export interface ConsumerLabelData {
  productName: string;
  ingredientText: string;
  /** Allergennavn som skal stå i fet skrift i ingredienslisten. */
  allergenTerms: string[];
  netWeightText: string | null;
  shelfLifeText: string | null;
  storageText: string | null;
  originText: string | null;
  nutritionRows: ConsumerLabelNutritionRow[];
  nutritionUsable: boolean;
  producerName: string | null;
  producerAddress: string | null;
  /** Data-URL-er for merker som er slått på og godkjent. */
  grainMarkImage: string | null;
  grainMarkFallbackText: string | null;
  keyholeMark: boolean;
}

const styles = StyleSheet.create({
  page: { padding: 10, fontSize: 7, fontFamily: "Helvetica", color: "#111" },
  name: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  section: { marginBottom: 3 },
  h: { fontSize: 6.5, fontFamily: "Helvetica-Bold", textTransform: "uppercase", marginBottom: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.4, borderBottomColor: "#bbb", paddingVertical: 0.6 },
  marks: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  markBox: { borderWidth: 0.8, borderColor: "#111", borderRadius: 3, paddingHorizontal: 4, paddingVertical: 2, fontSize: 6.5 },
  small: { fontSize: 6, color: "#555" },
});

/** Deler ingredienslisten opp slik at allergener kan settes i fet skrift. */
function renderIngredients(text: string, terms: string[], fontSize: number) {
  const clean = terms.filter(Boolean).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!clean.length) return <Text style={{ fontSize }}>{text}</Text>;
  const re = new RegExp(`(${clean.join("|")})`, "gi");
  const parts = text.split(re);
  return (
    <Text style={{ fontSize }}>
      {parts.map((p, i) =>
        re.test(p) && clean.some((c) => new RegExp(`^${c}$`, "i").test(p)) ? (
          <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>{p}</Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </Text>
  );
}

/**
 * Forbrukeretikett — rekkefølgen følger matinformasjonsregelverket:
 * navn, ingredienser, nettovekt, holdbarhet, oppbevaring, opprinnelse,
 * næringsdeklarasjon, produsent, og til slutt merkene.
 */
export function ConsumerLabelPDFDocument({
  data,
  size,
  ingredientFontSize = MIN_INGREDIENT_FONT_PT,
}: {
  data: ConsumerLabelData;
  size: LabelSizeKey;
  ingredientFontSize?: number;
}) {
  const s = LABEL_SIZES[size];
  const fs = Math.max(MIN_INGREDIENT_FONT_PT, ingredientFontSize);

  return (
    <Document>
      <Page size={{ width: s.width, height: s.height }} style={styles.page}>
        <Text style={styles.name}>{data.productName}</Text>

        <View style={styles.section}>
          <Text style={styles.h}>Ingredienser</Text>
          {renderIngredients(data.ingredientText, data.allergenTerms, fs)}
        </View>

        {data.netWeightText && (
          <Text style={styles.section}>Nettovekt: {data.netWeightText}</Text>
        )}
        {data.shelfLifeText && <Text style={styles.section}>{data.shelfLifeText}</Text>}
        {data.storageText && <Text style={styles.section}>Oppbevaring: {data.storageText}</Text>}
        {data.originText && <Text style={styles.section}>Opprinnelse: {data.originText}</Text>}

        {data.nutritionUsable && data.nutritionRows.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.h}>Næringsinnhold per 100 g</Text>
            {data.nutritionRows.map((r, i) => (
              <View key={i} style={styles.row}>
                <Text style={{ paddingLeft: r.indent ? 6 : 0 }}>{r.label}</Text>
                <Text>{r.value}</Text>
              </View>
            ))}
          </View>
        )}

        {(data.producerName || data.producerAddress) && (
          <Text style={[styles.section, styles.small]}>
            {[data.producerName, data.producerAddress].filter(Boolean).join(", ")}
          </Text>
        )}

        {(data.grainMarkImage || data.grainMarkFallbackText || data.keyholeMark) && (
          <View style={styles.marks}>
            {data.grainMarkImage ? (
              <Image src={data.grainMarkImage} style={{ width: 34, height: 34, objectFit: "contain" }} />
            ) : data.grainMarkFallbackText ? (
              <Text style={styles.markBox}>{data.grainMarkFallbackText}</Text>
            ) : null}
            {data.keyholeMark && <Text style={styles.markBox}>Nøkkelhullet</Text>}
          </View>
        )}
      </Page>
    </Document>
  );
}
