import * as React from "react";
import { Document, Page, Text, View, Image, StyleSheet } from "@react-pdf/renderer";
import type { RecipePDFData, RecipePDFPart } from "@/varer/hooks/useRecipePDF";
import { fmtDuration, fmtGrams, fmtNum } from "@/varer/lib/bakers";
import {
  BrandFooter, BrandHeader, BrandRunningHeader, SubRecipeFootnote, zebraBg,
} from "@/varer/components/recipes/pdfBrand";
import logoRund from "@/assets/brand/logo-rund.png";

const PAGE_MARGIN = 56;

// Den pene utgaven — til deling, opplæring og arkiv. Rolig typografi, god luft.
const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingBottom: 64, paddingHorizontal: PAGE_MARGIN, fontSize: 10, fontFamily: "Helvetica", color: "#1a1a1a" },

  heroWrap: { position: "relative", marginBottom: 18 },
  hero: { width: "100%", height: 190, objectFit: "cover" },
  heroSeal: { position: "absolute", right: 10, bottom: 10, width: 54, height: 54, objectFit: "contain", opacity: 0.9 },

  kicker: { fontSize: 8, textTransform: "uppercase", letterSpacing: 1.4, color: "#8a7a63" },
  title: { fontSize: 28, fontWeight: 700, marginTop: 6, letterSpacing: -0.6 },
  rule: { borderBottomWidth: 1, borderBottomColor: "#d8d2c7", marginTop: 12, marginBottom: 14 },
  ingress: { fontSize: 11, lineHeight: 1.6, color: "#3c3c3c", marginBottom: 18 },


  sectionTitle: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    color: "#8a7a63",
    marginBottom: 8,
    marginTop: 4,
  },

  partName: { fontSize: 12, fontWeight: 700, marginBottom: 5, marginTop: 8 },
  partMeta: { fontSize: 9, color: "#777", marginBottom: 5 },

  tableHead: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#c9c2b6", paddingBottom: 3, marginBottom: 3 },
  th: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#8a8a8a" },
  row: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 3, borderBottomWidth: 0.25, borderBottomColor: "#ece8e0" },
  colName: { flex: 1, paddingRight: 10 },
  colGrams: { width: 72, textAlign: "right" },
  colPct: { width: 62, textAlign: "right" },
  colCost: { width: 66, textAlign: "right" },
  cellName: { fontSize: 10.5 },
  cellGrams: { fontSize: 10.5, fontWeight: 700 },
  cellPct: { fontSize: 9.5, color: "#8a8a8a" },
  cellCost: { fontSize: 9.5, color: "#555" },
  sumRow: { flexDirection: "row", paddingTop: 4, borderTopWidth: 0.5, borderTopColor: "#c9c2b6", marginTop: 1 },
  sumLabel: { flex: 1, fontSize: 9.5, fontWeight: 700 },
  sumValue: { width: 72, textAlign: "right", fontSize: 10.5, fontWeight: 700 },

  step: { flexDirection: "row", marginBottom: 11 },
  stepNo: { width: 22, fontSize: 11, fontWeight: 700, color: "#8a7a63" },
  stepBody: { flex: 1 },
  stepTitle: { fontSize: 10.5, fontWeight: 700, marginBottom: 2 },
  stepText: { fontSize: 10, lineHeight: 1.55, color: "#3c3c3c" },
  stepMeta: { fontSize: 8.5, color: "#8a8a8a", marginTop: 2 },

  factsBox: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: "#d8d2c7",
    paddingTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
  },
  fact: { marginRight: 26, marginBottom: 4 },
  factLabel: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 0.6, color: "#8a8a8a" },
  factValue: { fontSize: 11, fontWeight: 700, marginTop: 1 },

  factsSeal: { width: 46, height: 46, objectFit: "contain", opacity: 0.85, marginLeft: "auto" },

});

function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function pct(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${fmtNum(n, decimals)} %`;
}

function PartTable({ part, showCosts }: { part: RecipePDFPart; showCosts: boolean }) {
  const sum = part.lines.reduce((s, l) => s + l.grams, 0);
  return (
    <View>
      <View style={styles.tableHead} fixed>
        <View style={styles.colName}><Text style={styles.th}>Ingrediens</Text></View>
        <View style={styles.colGrams}><Text style={[styles.th, { textAlign: "right" }]}>Gram</Text></View>
        <View style={styles.colPct}><Text style={[styles.th, { textAlign: "right" }]}>Baker-%</Text></View>
        {showCosts && <View style={styles.colCost}><Text style={[styles.th, { textAlign: "right" }]}>Kost</Text></View>}
      </View>
      {part.lines.map((l, i) => (
        <View key={l.id} style={[styles.row, zebraBg(i)]} wrap={false}>
          <View style={styles.colName}>
            <Text style={styles.cellName}>{l.name}{l.isSubRecipe ? " †" : ""}</Text>
          </View>
          <View style={styles.colGrams}><Text style={styles.cellGrams}>{fmtGrams(l.grams)} g</Text></View>
          <View style={styles.colPct}><Text style={styles.cellPct}>{pct(l.percent)}</Text></View>
          {showCosts && (
            <View style={styles.colCost}>
              <Text style={styles.cellCost}>{l.cost != null ? `${fmtNum(l.cost, 2)} kr` : "—"}</Text>
            </View>
          )}
        </View>
      ))}

      <View style={styles.sumRow}>
        <Text style={styles.sumLabel}>Sum</Text>
        <Text style={styles.sumValue}>{fmtGrams(sum)} g</Text>
        <View style={styles.colPct} />
        {showCosts && <View style={styles.colCost} />}
      </View>
    </View>
  );
}

interface Props {
  data: RecipePDFData;
  showCosts?: boolean;
}

export function RecipeCardPDFDocument({ data, showCosts = false }: Props) {
  const s = data.stats;
  const allParts = [...data.preferments, ...data.mainParts];
  const hasSubRecipe = allParts.some((p) => p.lines.some((l) => l.isSubRecipe));
  const headMeta = `v${data.version ?? 1} · ${fmtDate(data.printedAt)}`;

  return (
    <Document title={`Oppskrift - ${data.name}`}>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <BrandRunningHeader name={data.name} meta={data.category ?? headMeta} margin={PAGE_MARGIN} />
        <BrandHeader docType="Oppskriftskort" name={data.name} meta={headMeta} />

        {data.imageUrl ? (
          <View style={styles.heroWrap}>
            <Image style={styles.hero} src={data.imageUrl} />
            <Image style={styles.heroSeal} src={logoRund} />
          </View>
        ) : null}


        <Text style={styles.kicker}>{data.category || "Oppskrift"}</Text>
        <Text style={styles.title}>{data.name}</Text>
        <View style={styles.rule} />

        {data.description ? <Text style={styles.ingress}>{data.description}</Text> : null}

        <Text style={styles.sectionTitle}>Ingredienser · {fmtNum(data.scaledUnits)} stk</Text>
        {allParts.map((p) => (
          <View key={p.id} wrap={false}>
            {allParts.length > 1 && <Text style={styles.partName}>{p.name}</Text>}
            {p.partType === "preferment" && (p.ripeTimeHours != null || p.targetTempCelsius != null) && (
              <Text style={styles.partMeta}>
                {p.ripeTimeHours != null ? `${fmtNum(p.ripeTimeHours, 1)} timer modning` : ""}
                {p.ripeTimeHours != null && p.targetTempCelsius != null ? " · " : ""}
                {p.targetTempCelsius != null ? `${fmtNum(p.targetTempCelsius, 1)} °C` : ""}
              </Text>
            )}
            <PartTable part={p} showCosts={showCosts} />
          </View>
        ))}

        {data.steps.length > 0 && (
          <View style={{ marginTop: 22 }}>
            <Text style={styles.sectionTitle}>Fremgangsmåte</Text>
            {data.steps.map((st) => (
              <View key={st.index} style={styles.step} wrap={false}>
                <Text style={styles.stepNo}>{st.index}.</Text>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{st.title || st.typeLabel}</Text>
                  {st.instruction ? <Text style={styles.stepText}>{st.instruction}</Text> : null}
                  {(st.durationMinutes || st.tempCelsius != null) && (
                    <Text style={styles.stepMeta}>
                      {st.durationMinutes ? fmtDuration(st.durationMinutes) : ""}
                      {st.durationMinutes && st.tempCelsius != null ? " · " : ""}
                      {st.tempCelsius != null ? `${fmtNum(st.tempCelsius, 1)} °C` : ""}
                      {st.humidityPct != null ? ` · ${fmtNum(st.humidityPct)} % RF` : ""}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.factsBox} wrap={false}>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Hydrering</Text>
            <Text style={styles.factValue}>{pct(s.hydrationPct)}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Deigtemperatur</Text>
            <Text style={styles.factValue}>{s.targetDoughTemp != null ? `${fmtNum(s.targetDoughTemp, 1)} °C` : "—"}</Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Utbytte</Text>
            <Text style={styles.factValue}>
              {fmtNum(data.scaledUnits)} stk{data.unitWeightGrams ? ` à ${fmtGrams(data.unitWeightGrams)} g` : ""}
            </Text>
          </View>
          <View style={styles.fact}>
            <Text style={styles.factLabel}>Deigvekt</Text>
            <Text style={styles.factValue}>{fmtGrams(s.doughG)} g</Text>
          </View>
          {showCosts && data.costs && (
            <View style={styles.fact}>
              <Text style={styles.factLabel}>Råvarekost</Text>
              <Text style={styles.factValue}>
                {fmtNum(data.costs.total, 2)} kr
                {data.costs.perUnit != null ? ` · ${fmtNum(data.costs.perUnit, 2)} kr/stk` : ""}
              </Text>
            </View>
          )}
          {!data.imageUrl && <Image style={styles.factsSeal} src={logoRund} />}
        </View>

        <SubRecipeFootnote show={hasSubRecipe} />

        <BrandFooter margin={PAGE_MARGIN} />

      </Page>
    </Document>
  );
}

export default RecipeCardPDFDocument;
