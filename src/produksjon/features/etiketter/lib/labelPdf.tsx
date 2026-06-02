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
import { FIELD_LABELS } from "@/produksjon/features/utskriftsprofiler/types";
import type { LabelProductRow } from "../types";
import type { Merknad } from "@/ordre/lib/merknad";

const MM_TO_PT = 2.83465;
const mm = (v: number) => v * MM_TO_PT;

export interface LabelPdfData {
  profile: LabelPrintProfile;
  row: LabelProductRow;
  labelNumber?: string | null;
  quantity: number;
  /** Hvor mange etiketter som skal genereres (ofte = quantity). Default 1. */
  copies?: number;
  /** Merknad lagret på order_lines.merknad for denne ordrelinjen. Fyller etikett-felt. */
  merknad?: Merknad | null;
  /** Tur-etikett (f.eks. "Tur 1") for ordrelinjen. */
  tourLabel?: string | null;
  /** Hentested-navn (pickup_locations.display_name) for ordrelinjen. */
  pickupLabel?: string | null;
  /** Navn på kunden / mottakeren av kaken. */
  customerName?: string | null;
  /** Formatert leveringsadresse. */
  deliveryAddress?: string | null;
  /** Kundens telefonnummer for ordrelinjen. */
  phone?: string | null;
  /** Formatert leveringsdato for ordrelinjen. */
  deliveryDate?: string | null;
  /** Formatert hentetidspunkt (f.eks. "Hentes kl 10:00"). */
  pickupTime?: string | null;
}

function joinNonEmpty(parts: Array<string | undefined | null>, sep = " · "): string {
  return parts.filter((s): s is string => !!s && s.trim().length > 0).join(sep);
}

/** Verdi for et felt basert på tilgjengelig data. */
function valueFor(
  type: FieldType,
  data: LabelPdfData,
): { text?: string; image?: string | null } {
  const { profile, row, labelNumber, quantity, merknad, tourLabel, pickupLabel, customerName, deliveryAddress, phone, deliveryDate, pickupTime } = data;
  switch (type) {
    case "logo":
      return { image: profile.logo_url };
    case "firmanavn":
      return { text: profile.company_name || "" };
    case "firmamerknad":
      return { text: profile.company_note || "" };
    case "varenavn":
      return { text: row.display_name };
    case "varenr":
      return { text: String(row.display_number) };
    case "antall":
      return { text: String(quantity) };
    case "etikett_nr":
      return { text: labelNumber || "—" };
    case "tur":
      return { text: tourLabel || "" };
    case "hentested":
      return { text: pickupLabel || "" };
    case "kundenavn":
      return { text: customerName || "" };
    case "leveringsadresse":
      return { text: deliveryAddress || "" };
    case "telefon":
      return { text: phone || "" };
    case "leveringsdato":
      return { text: deliveryDate || "" };
    case "hentetidspunkt":
      return { text: pickupTime || "" };
    case "sist_endret":
      return { text: new Date().toLocaleString("nb-NO") };
    case "bestilt_av":
      return { text: merknad?.bestilt_av || "" };
    case "fyll":
      return { text: merknad?.fyll || "" };
    case "tekst":
      return { text: merknad?.tekst || "" };
    case "pynt":
      return { text: merknad?.pynt || "" };
    case "sukkerbilde":
      return {
        text: merknad?.sukkerbilde === true ? "+ BILDE" : "",
      };
    case "kommentar":
      return { text: merknad?.fritekst_1 || "" };
    default:
      return { text: `[${FIELD_LABELS[type]}]` };
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

function renderField(field: ProfileField, data: LabelPdfData, key: string) {
  const v = valueFor(field.field_type, data);
  const align: "left" | "center" | "right" =
    field.alignment === "center"
      ? "center"
      : field.alignment === "right"
        ? "right"
        : "left";

  const justify =
    align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  const showLabel =
    data.profile.include_field_labels &&
    (field.show_label ?? true) &&
    field.field_type !== "logo";
  const labelText = showLabel ? `${FIELD_LABELS[field.field_type]}: ` : "";

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
        alignItems: "center",
        justifyContent: justify,
        paddingHorizontal: 1,
      }}
    >
      {field.field_type === "logo" && v.image ? (
        <Image
          src={v.image}
          style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
        />
      ) : (
        <Text
          style={{
            fontSize: field.font_size,
            fontWeight: field.bold ? 700 : 400,
            textAlign: align,
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

export function CombinedLabelPdfDocument({ items }: { items: LabelPdfData[] }) {
  return (
    <Document>
      {items.map((d, i) => (
        <LabelPages key={i} data={d} />
      ))}
    </Document>
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
