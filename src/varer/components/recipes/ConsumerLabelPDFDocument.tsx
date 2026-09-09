import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { splitMarkedText } from "@/varer/lib/markedText";

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
  /** «Kan inneholde spor av …» — skal stå på etiketten, ikke bare i visningen. */
  mayContain: string[];
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
  /** Grovhetsprosenten trykkes under merket (BKLF pkt. 4.4). */
  grainPctText: string | null;
  /** Data-URL for nokkelhullet.svg — null når merket ikke er godkjent. */
  keyholeMarkImage: string | null;
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
  markPct: { fontSize: 6, marginTop: 1, textAlign: "center" },
});

/**
 * Deler ingredienslisten opp slik at allergener kan settes i fet skrift.
 * Teksten kommer med *stjerne*-markører rundt allergenordene — aldri hele
 * feltet — og deles opp med samme funksjon som brukes på selve etiketten.
 */
function renderIngredients(text: string, _terms: string[], fontSize: number) {
  const segments = splitMarkedText(text);
  if (!segments.length) return <Text style={{ fontSize }}>{text}</Text>;
  return (
    <Text style={{ fontSize }}>
      {segments.map((seg, i) =>
        seg.bold ? (
          <Text key={i} style={{ fontFamily: "Helvetica-Bold" }}>{seg.text}</Text>
        ) : (
          <Text key={i}>{seg.text}</Text>
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
  customSize,
  ingredientFontSize = MIN_INGREDIENT_FONT_PT,
}: {
  data: ConsumerLabelData;
  size: LabelSizeKey;
  /** Papirmål i punkt fra en etikettprofil — overstyrer `size` når den er satt. */
  customSize?: { width: number; height: number } | null;
  ingredientFontSize?: number;
}) {
  const s = customSize ?? LABEL_SIZES[size];
  const fs = Math.max(MIN_INGREDIENT_FONT_PT, ingredientFontSize);

  return (
    <Document>
      <Page size={{ width: s.width, height: s.height }} style={styles.page}>
        <Text style={styles.name}>{data.productName}</Text>

        <View style={styles.section}>
          <Text style={styles.h}>Ingredienser</Text>
          {renderIngredients(data.ingredientText, data.allergenTerms, fs)}
        </View>

        {data.mayContain.length > 0 && (
          <Text style={[styles.section, { fontSize: fs }]}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Kan inneholde spor av: </Text>
            {data.mayContain.join(", ")}
          </Text>
        )}

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

        {(data.grainMarkImage || data.keyholeMarkImage) && (
          <View style={styles.marks}>
            {data.grainMarkImage ? (
              <View style={{ alignItems: "center" }}>
                <Image src={data.grainMarkImage} style={{ width: 34, height: 34, objectFit: "contain" }} />
                {data.grainPctText && <Text style={styles.markPct}>{data.grainPctText}</Text>}
              </View>
            ) : null}
            {data.keyholeMarkImage && (
              <Image src={data.keyholeMarkImage} style={{ width: 34, height: 34, objectFit: "contain" }} />
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}
