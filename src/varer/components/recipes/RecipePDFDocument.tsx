import * as React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { RecipePDFData, RecipePDFLine, RecipePDFPart } from "@/varer/hooks/useRecipePDF";
import { fmtDuration, fmtGrams, fmtNum } from "@/varer/lib/bakers";
import {
  BrandFooter, BrandHeader, BrandRunningHeader, SubRecipeFootnote, zebraBg,
} from "@/varer/components/recipes/pdfBrand";
import { RECIPE_DEPARTMENT_LABEL } from "@/varer/lib/departments";


const PAGE_MARGIN = 32;

// NOTE: Nøytral palett — @react-pdf/renderer leser ikke CSS-tokens.
// Arket henger i bakeriet: stor skrift, tydelige rammer, ingen kostpriser.
const styles = StyleSheet.create({
  page: { paddingTop: 28, paddingBottom: 62, paddingHorizontal: PAGE_MARGIN, fontSize: 11, fontFamily: "Helvetica", color: "#111111" },


  title: { fontSize: 26, fontWeight: 700, letterSpacing: -0.4 },
  subTitle: { fontSize: 12, color: "#444", marginTop: 2 },
  headMetaRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, marginBottom: 12 },
  headMeta: { marginRight: 22 },
  headMetaLabel: { fontSize: 8, textTransform: "uppercase", color: "#666", letterSpacing: 0.5 },
  headMetaValue: { fontSize: 14, fontWeight: 700, marginTop: 1 },

  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderWidth: 1,
    borderColor: "#111",
    marginBottom: 14,
  },
  statCell: {
    width: "14.28%",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRightWidth: 0.5,
    borderRightColor: "#999",
  },
  statLabel: { fontSize: 7, textTransform: "uppercase", color: "#555", letterSpacing: 0.4 },
  statValue: { fontSize: 13, fontWeight: 700, marginTop: 2 },

  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 4, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.6 },

  prefermentBox: { borderWidth: 1.5, borderColor: "#111", padding: 8, marginBottom: 10 },
  prefermentHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 5 },
  prefermentTitle: { fontSize: 15, fontWeight: 700 },
  prefermentMeta: { fontSize: 10, color: "#333" },

  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#111",
    paddingBottom: 3,
    marginBottom: 3,
  },
  th: { fontSize: 8, textTransform: "uppercase", color: "#555", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: "#ddd" },
  colCheck: { width: 22 },
  colName: { flex: 1, paddingRight: 8 },
  colGrams: { width: 78, textAlign: "right" },
  colPct: { width: 62, textAlign: "right" },
  checkbox: { width: 12, height: 12, borderWidth: 1, borderColor: "#111" },
  ingName: { fontSize: 12 },
  ingNameFlour: { fontSize: 12, fontWeight: 700 },
  ingGrams: { fontSize: 13, fontWeight: 700 },
  ingPct: { fontSize: 10, color: "#888" },


  totalRow: { flexDirection: "row", alignItems: "center", paddingTop: 5, marginTop: 1, borderTopWidth: 1, borderTopColor: "#111" },
  totalLabel: { flex: 1, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4 },
  totalValue: { width: 78, textAlign: "right", fontSize: 13, fontWeight: 700 },
  totalExact: { width: 62, textAlign: "right", fontSize: 8, color: "#888" },

  instructions: { fontSize: 10, color: "#333", marginTop: 5, lineHeight: 1.35 },

  step: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#ddd", paddingVertical: 8 },
  stepNo: { width: 26, fontSize: 15, fontWeight: 700 },
  stepBody: { flex: 1, paddingRight: 8 },
  stepTitle: { fontSize: 13, fontWeight: 700 },
  stepText: { fontSize: 10, color: "#333", marginTop: 3, lineHeight: 1.35 },
  stepMeta: { width: 116, textAlign: "right" },
  stepDuration: { fontSize: 13, fontWeight: 700 },
  stepTemp: { fontSize: 10, color: "#444", marginTop: 2 },

  signBlock: { marginTop: 18, flexDirection: "row", justifyContent: "space-between" },
  signField: { width: "31%" },
  signLine: { borderBottomWidth: 1, borderBottomColor: "#111", height: 30 },
  signLabel: { fontSize: 8, color: "#555", marginTop: 3, textTransform: "uppercase", letterSpacing: 0.4 },

});


function fmtDate(d: Date): string {
  return new Intl.DateTimeFormat("nb-NO", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function pct(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return `${fmtNum(n, decimals)} %`;
}

function IngredientRow({ line, index, showPercent }: { line: RecipePDFLine; index: number; showPercent: boolean }) {
  return (
    <View style={[styles.row, zebraBg(index)]} wrap={false}>
      <View style={styles.colCheck}><View style={styles.checkbox} /></View>
      <View style={styles.colName}>
        <Text style={line.isFlour ? styles.ingNameFlour : styles.ingName}>
          {line.name}{line.isSubRecipe ? " †" : ""}
        </Text>
      </View>
      <View style={styles.colGrams}><Text style={styles.ingGrams}>{fmtGrams(line.grams)} g</Text></View>
      {showPercent && (
        <View style={styles.colPct}><Text style={styles.ingPct}>{pct(line.percent)}</Text></View>
      )}
    </View>
  );
}

function IngredientTable({ part, showPercent }: { part: RecipePDFPart; showPercent: boolean }) {
  const rounded = part.lines.reduce((s, l) => s + l.grams, 0);
  const exact = part.lines.reduce((s, l) => s + l.exactGrams, 0);
  return (
    <View>
      <View style={styles.tableHead} fixed>
        <View style={styles.colCheck} />
        <View style={styles.colName}><Text style={styles.th}>Ingrediens</Text></View>
        <View style={styles.colGrams}><Text style={[styles.th, { textAlign: "right" }]}>Vekt</Text></View>
        {showPercent && <View style={styles.colPct}><Text style={[styles.th, { textAlign: "right" }]}>Baker-%</Text></View>}
      </View>
      {part.lines.map((l, i) => <IngredientRow key={l.id} line={l} index={i} showPercent={showPercent} />)}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Sum {part.name.toLowerCase()}</Text>
        <Text style={styles.totalValue}>{fmtGrams(rounded)} g</Text>
        {showPercent && <Text style={styles.totalExact}>({fmtNum(exact, 1)} g)</Text>}
      </View>
    </View>
  );
}


export function RecipePDFDocument({ data }: { data: RecipePDFData }) {
  const s = data.stats;
  const hasSubRecipe = [...data.preferments, ...data.mainParts].some((p) => p.lines.some((l) => l.isSubRecipe));
  const stats: { label: string; value: string }[] = [
    { label: "Melvekt", value: `${fmtGrams(s.flourG)} g` },
    { label: "Deigvekt", value: `${fmtGrams(s.doughG)} g` },
    { label: "Hydrering", value: pct(s.hydrationPct) },
    { label: "Salt", value: pct(s.saltPct) },
    { label: "Forfermentert", value: pct(s.prefermentedFlourPct) },
    { label: "Ønsket deigtemp", value: s.targetDoughTemp != null ? `${fmtNum(s.targetDoughTemp, 1)} °C` : "—" },
    { label: "Vanntemp", value: s.waterTempFeasible && s.waterTemp != null ? `${fmtNum(s.waterTemp, 1)} °C` : "—" },
  ];

  const headMeta = `${fmtNum(data.scaledUnits)} stk · v${data.version ?? 1} · ${fmtDate(data.printedAt)}`;

  return (
    <Document title={`Produksjonsark - ${data.name} - ${data.scaledUnits} stk`}>
      <Page size="A4" orientation="portrait" style={styles.page}>
        <BrandRunningHeader name={data.name} meta={headMeta} margin={PAGE_MARGIN} />
        <BrandHeader docType={data.department ? `Produksjonsark · ${RECIPE_DEPARTMENT_LABEL[data.department]}` : "Produksjonsark"} name={data.name} meta={headMeta} />

        <Text style={styles.title}>{data.name}</Text>
        <Text style={styles.subTitle}>
          {data.category ? `${data.category} · ` : ""}Produksjonsark
        </Text>


        <View style={styles.headMetaRow}>
          <View style={styles.headMeta}>
            <Text style={styles.headMetaLabel}>Antall</Text>
            <Text style={styles.headMetaValue}>{fmtNum(data.scaledUnits)} stk</Text>
          </View>
          <View style={styles.headMeta}>
            <Text style={styles.headMetaLabel}>Emnevekt</Text>
            <Text style={styles.headMetaValue}>
              {data.unitWeightGrams ? `${fmtGrams(data.unitWeightGrams)} g` : "—"}
            </Text>
          </View>
          <View style={styles.headMeta}>
            <Text style={styles.headMetaLabel}>Dato</Text>
            <Text style={styles.headMetaValue}>{fmtDate(data.printedAt)}</Text>
          </View>
          <View style={styles.headMeta}>
            <Text style={styles.headMetaLabel}>Versjon</Text>
            <Text style={styles.headMetaValue}>v{data.version ?? 1}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          {stats.map((st) => (
            <View key={st.label} style={styles.statCell}>
              <Text style={styles.statLabel}>{st.label}</Text>
              <Text style={styles.statValue}>{st.value}</Text>
            </View>
          ))}
        </View>

        {data.preferments.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Fordeiger</Text>
            {data.preferments.map((p) => (
              <View key={p.id} style={styles.prefermentBox} wrap={false}>
                <View style={styles.prefermentHead}>
                  <Text style={styles.prefermentTitle}>
                    {p.prefermentKind
                      ? p.prefermentKind.charAt(0).toUpperCase() + p.prefermentKind.slice(1)
                      : p.name}
                  </Text>
                  <Text style={styles.prefermentMeta}>
                    {p.ripeTimeHours != null ? `${fmtNum(p.ripeTimeHours, 1)} t modning` : "Modningstid ikke satt"}
                    {p.targetTempCelsius != null ? ` · ${fmtNum(p.targetTempCelsius, 1)} °C` : ""}
                  </Text>
                </View>
                <IngredientTable part={p} showPercent />
                {p.instructions ? <Text style={styles.instructions}>{p.instructions}</Text> : null}
              </View>
            ))}
          </View>
        )}

        {data.mainParts.map((p) => (
          <View key={p.id} style={{ marginBottom: 12 }}>
            <Text style={styles.sectionTitle}>{p.name}</Text>
            <IngredientTable part={p} showPercent />
            {p.instructions ? <Text style={styles.instructions}>{p.instructions}</Text> : null}
          </View>
        ))}

        {data.steps.length > 0 && (
          <View>
            <Text style={styles.sectionTitle}>Prosess</Text>
            {data.steps.map((st) => (
              <View key={st.index} style={styles.step} wrap={false}>
                <View style={styles.colCheck}><View style={styles.checkbox} /></View>
                <Text style={styles.stepNo}>{st.index}</Text>
                <View style={styles.stepBody}>
                  <Text style={styles.stepTitle}>{st.title || st.typeLabel}</Text>
                  {st.instruction ? <Text style={styles.stepText}>{st.instruction}</Text> : null}
                </View>
                <View style={styles.stepMeta}>
                  <Text style={styles.stepDuration}>{fmtDuration(st.durationMinutes)}</Text>
                  <Text style={styles.stepTemp}>
                    {st.tempCelsius != null ? `${fmtNum(st.tempCelsius, 1)} °C` : ""}
                    {st.tempCelsius != null && st.humidityPct != null ? " · " : ""}
                    {st.humidityPct != null ? `${fmtNum(st.humidityPct)} % RF` : ""}
                  </Text>
                </View>
              </View>
            ))}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Samlet prosesstid</Text>
              <Text style={[styles.totalValue, { width: 116 }]}>{fmtDuration(data.totalProcessMinutes)}</Text>
            </View>
          </View>
        )}

        <View style={styles.signBlock} wrap={false}>
          <View style={styles.signField}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Faktisk deigtemperatur (°C)</Text>
          </View>
          <View style={styles.signField}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Bakt av (signatur)</Text>
          </View>
          <View style={styles.signField}>
            <View style={styles.signLine} />
            <Text style={styles.signLabel}>Dato / klokkeslett</Text>
          </View>
        </View>

        <SubRecipeFootnote show={hasSubRecipe} />

        <BrandFooter margin={PAGE_MARGIN} />

      </Page>
    </Document>
  );
}

export default RecipePDFDocument;
