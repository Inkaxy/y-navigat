import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type {
  LabelPrintProfile,
  ProfileField,
  FieldType,
} from "@/produksjon/features/utskriftsprofiler/types";
import { FALLBACK_FIELD_LABELS } from "@/produksjon/features/utskriftsprofiler/types";
import { fitFontSizePt } from "@/produksjon/features/utskriftsprofiler/lib/fitText";
import type { LabelProductRow } from "../types";
import { code128Modules } from "./code128";

const MM_TO_PT = 2.83465;
const mm = (v: number) => v * MM_TO_PT;
/** Største fornuftige punktstørrelse som får plass i en boks på `h` mm. */
const mmToPtCap = (h: number) => Math.max(6, mm(h) * 0.7);

export interface LabelPdfData {
  profile: LabelPrintProfile;
  row: LabelProductRow;
  labelNumber?: string | null;
  quantity: number;
  /** Hvor mange etiketter som skal genereres (ofte = quantity). Default 1. */
  copies?: number;
  /** Hentested-navn (pickup_locations.display_name) for ordrelinjen. */
  pickupLabel?: string | null;
  /** Verdi som skal kodes i strekkoden. Default: etikettnummer, ellers varenr. */
  barcodeValue?: string | null;
  /** Oppløste feltverdier fra RPC `resolve_label_data` — nøkkel = field_key. */
  felter?: Record<string, unknown> | null;
  /** Visningsnavn per feltnøkkel fra `label_field_catalog`. */
  fieldLabels?: Record<string, string> | null;
}


function fieldLabelFor(type: FieldType, data: LabelPdfData): string {
  return data.fieldLabels?.[type] ?? FALLBACK_FIELD_LABELS[type] ?? type;
}

function formatValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "boolean") return v ? "Ja" : "Nei";
  if (Array.isArray(v)) return v.filter(Boolean).map(String).join(", ");
  if (typeof v === "object") return "";
  return String(v);
}




/** Verdi for et felt: system-/profilfelt her, alt annet fra `felter`. */
function valueFor(
  type: FieldType,
  data: LabelPdfData,
): { text?: string; image?: string | null } {
  const { profile, labelNumber } = data;
  switch (type) {
    case "logo":
      return { image: profile.logo_url };
    case "firmanavn":
      return { text: profile.company_name || "" };
    case "firmamerknad":
      return { text: profile.company_note || "" };
    case "etikett_nr":
      return { text: labelNumber || "—" };
    case "strekkode":
      return { text: barcodeText(data) };
    case "utskriftstidspunkt":
      return { text: new Date().toLocaleString("nb-NO") };
    default:
      return { text: formatValue(data.felter?.[type]) };
  }
}

const styles = StyleSheet.create({
  page: { backgroundColor: "white" },
  inner: { position: "relative", width: "100%", height: "100%" },
  fieldText: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
});

function barcodeText(data: LabelPdfData): string {
  return (
    data.barcodeValue ||
    data.labelNumber ||
    (data.row?.display_number != null ? String(data.row.display_number) : "")
  );
}

function BarcodeView({ value, heightMm }: { value: string; heightMm: number }) {
  const modules = code128Modules(value);
  const totalUnits = modules.reduce((acc, m) => acc + m.width, 0) || 1;
  const barsHeight = Math.max(mm(heightMm) - 8, 6);
  return (
    <View style={{ width: "100%", height: "100%", alignItems: "center", justifyContent: "center" }}>
      <View style={{ flexDirection: "row", height: barsHeight, width: "100%" }}>
        {modules.map((m, i) => (
          <View
            key={i}
            style={{
              flexGrow: m.width,
              flexBasis: `${(m.width / totalUnits) * 100}%`,
              backgroundColor: m.dark ? "#000" : "#fff",
              height: "100%",
            }}
          />
        ))}
      </View>
      <Text style={{ fontSize: 5, marginTop: 1 }}>{value}</Text>
    </View>
  );
}

function renderField(field: ProfileField, data: LabelPdfData, key: string) {
  const v = valueFor(field.field_type, data);
  // Hopp over tomme felter med mindre profilen ber om å alltid tegne dem.
  const isEmpty =
    field.field_type === "logo" ? !v.image : !(v.text ?? "").trim();
  if (isEmpty && !(field.always_show ?? false)) return null;
  const align: "left" | "center" | "right" =
    field.alignment === "center"
      ? "center"
      : field.alignment === "right"
        ? "right"
        : "left";

  const justify =
    align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  const vAlign = field.vertical_alignment ?? "middle";
  const alignItems =
    vAlign === "top" ? "flex-start" : vAlign === "bottom" ? "flex-end" : "center";

  const showLabel =
    data.profile.include_field_labels &&
    (field.show_label ?? true) &&
    field.field_type !== "logo";
  const labelText = showLabel ? `${fieldLabelFor(field.field_type, data)}: ` : "";

  // Etikettnummeret er hovedidentifikatoren i produksjon — det skal alltid
  // stå stort og fett, uansett hva profilen er satt opp med.
  const isLabelNumber = field.field_type === "etikett_nr";
  const autoFit = field.auto_fit ?? false;
  const fullText = labelText + (v.text ?? "");
  const fontPt =
    autoFit && field.field_type !== "logo"
      ? fitFontSizePt(fullText, field.font_size, field.width_mm, field.height_mm, {
          bold: field.bold,
        })
      : field.font_size;
  const effectiveFontPt = isLabelNumber
    ? Math.max(fontPt, Math.min(mmToPtCap(field.height_mm), 24))
    : fontPt;

  return (
    <View
      key={key}
      style={{
        position: "absolute",
        left: mm(field.x_mm),
        top: mm(field.y_mm),
        width: mm(field.width_mm),
        height: mm(field.height_mm),
        borderStyle: "solid",
        borderWidth: field.show_border ? 0.5 : 0,
        borderBottomWidth: field.show_line && !field.show_border ? 0.5 : field.show_border ? 0.5 : 0,
        borderColor: "#777",
        flexDirection: "row",
        alignItems,
        justifyContent: justify,
        paddingHorizontal: 1,
        overflow: "hidden",
      }}
    >
      {field.field_type === "strekkode" ? (
        <BarcodeView value={barcodeText(data)} heightMm={field.height_mm} />
      ) : field.field_type === "logo" && v.image ? (
        <Image
          src={v.image}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      ) : (
        <Text
          style={{
            fontSize: effectiveFontPt,
            fontWeight: isLabelNumber || field.bold ? 700 : 400,
            textAlign: align,
            lineHeight: 1.15,
          }}
        >
          {showLabel ? (
            <Text style={{ fontWeight: data.profile.field_labels_bold ? 700 : 400 }}>
              {labelText}
            </Text>
          ) : null}
          {v.text ?? ""}
        </Text>
      )}
    </View>
  );
}

function LabelPages({ data }: { data: LabelPdfData }) {
  const { profile } = data;
  const landscape = profile.orientation === "landscape";
  const paperW = landscape ? profile.paper_width_mm : profile.paper_height_mm;
  const paperH = landscape ? profile.paper_height_mm : profile.paper_width_mm;

  const fields = profile.fields
    .filter((f) => f.include)
    .sort((a, b) => a.z_index - b.z_index);

  const copies = Math.max(1, data.copies ?? 1);
  const pages = Array.from({ length: copies });

  return (
    <>
      {pages.map((_, i) => (
        <Page key={i} size={[mm(paperW), mm(paperH)]} style={styles.page}>
          <View
            style={{
              position: "absolute",
              left: mm(profile.margin_left_mm),
              top: mm(profile.margin_top_mm),
              width: mm(
                paperW - profile.margin_left_mm - profile.margin_right_mm,
              ),
              height: mm(
                paperH - profile.margin_top_mm - profile.margin_bottom_mm,
              ),
            }}
          >
            {fields.map((f, idx) =>
              renderField(f, data, `${f.field_type}-${idx}`),
            )}
            {(profile.lines ?? []).map((ln) => {
              const isH = ln.orientation === "horizontal";
              return (
                <View
                  key={ln.id}
                  style={{
                    position: "absolute",
                    left: mm(ln.x_mm),
                    top: mm(ln.y_mm),
                    width: isH ? mm(ln.length_mm) : Math.max(0.3, mm(ln.thickness_mm)),
                    height: isH ? Math.max(0.3, mm(ln.thickness_mm)) : mm(ln.length_mm),
                    backgroundColor: "#555",
                  }}
                />
              );
            })}
          </View>
        </Page>
      ))}
    </>
  );
}

export function LabelPdfDocument({ data }: { data: LabelPdfData }) {
  return (
    <Document>
      <LabelPages data={data} />
    </Document>
  );
}

export type CombinedLabelItem =
  | LabelPdfData
  | { separator: true; profile: LabelPrintProfile; text?: string };

export function CombinedLabelPdfDocument({ items }: { items: CombinedLabelItem[] }) {
  return (
    <Document>
      {items.map((d, i) =>
        "separator" in d ? (
          <SeparatorPage key={i} profile={d.profile} text={d.text ?? "---- KOPI ----"} />
        ) : (
          <LabelPages key={i} data={d} />
        ),
      )}
    </Document>
  );
}

function SeparatorPage({ profile, text }: { profile: LabelPrintProfile; text: string }) {
  const landscape = profile.orientation === "landscape";
  const paperW = landscape ? profile.paper_width_mm : profile.paper_height_mm;
  const paperH = landscape ? profile.paper_height_mm : profile.paper_width_mm;
  return (
    <Page size={[mm(paperW), mm(paperH)]} style={styles.page}>
      <View
        style={{
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: 700, letterSpacing: 2 }}>{text}</Text>
      </View>
    </Page>
  );
}

export function slugifyLabel(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/gi, "ae")
    .replace(/ø/gi, "o")
    .replace(/å/gi, "a")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .toLowerCase();
}
