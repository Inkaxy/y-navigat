import * as React from "react";
import { Image, StyleSheet, Text, View } from "@react-pdf/renderer";
import logoLang from "@/assets/brand/logo-lang.png";
import logoEmblem from "@/assets/brand/logo-emblem.png";

/**
 * Felles bakeri-ramme for oppskrifts-PDF-ene. @react-pdf/renderer leser hverken
 * CSS-tokens eller SVG-filer, så farger og logoer ligger som konstanter og PNG.
 */

/** Bronsen fra kringlen i emblemet (RGB 163,108,58). */
export const BRONZE = "#a36c3a";
export const INK = "#1a1a1a";
export const HAIRLINE = "#d8d2c7";
export const ZEBRA = "#f6f3ee";
export const MUTED = "#8a8a8a";

/** Ordmerket er 2103 × 277 px — 119 pt bredt tilsvarer ca. 42 mm. */
export const LOGO_LANG_W = 119;
export const LOGO_LANG_H = Math.round((119 * 277) / 2103);
/** Emblemet er 509 × 855 px — 20 pt høyt tilsvarer ca. 7 mm. */
export const LOGO_EMBLEM_H = 20;
export const LOGO_EMBLEM_W = Math.round((20 * 509) / 855);

export const FOOTER_LINE = "Nøtterø Bakeri & Konditori · Vestfolds eldste bakeri · est. 1898";

const s = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: BRONZE,
    paddingBottom: 6,
    marginBottom: 12,
  },
  headerRight: { alignItems: "flex-end", maxWidth: "58%" },
  docType: { fontSize: 7.5, textTransform: "uppercase", letterSpacing: 1.2, color: BRONZE },
  docName: { fontSize: 11, fontWeight: 700, color: INK, marginTop: 2, textAlign: "right" },
  docMeta: { fontSize: 8, color: MUTED, marginTop: 1, textAlign: "right" },

  slimHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: BRONZE,
    paddingBottom: 4,
    marginBottom: 10,
  },
  slimName: { fontSize: 8.5, color: MUTED },

  footer: {
    position: "absolute",
    bottom: 18,
    flexDirection: "row",
    alignItems: "center",
    borderTopWidth: 0.5,
    borderTopColor: HAIRLINE,
    paddingTop: 5,
  },
  footerCenter: { flex: 1, textAlign: "center", fontSize: 7.5, color: MUTED },
  footerRight: { width: LOGO_EMBLEM_W + 40, textAlign: "right", fontSize: 7.5, color: MUTED },
  footNote: { fontSize: 7.5, color: MUTED, marginTop: 6 },
});

/** Topptekst på side 1: ordmerke til venstre, dokumenttype og navn til høyre. */
export function BrandHeader({
  docType,
  name,
  meta,
}: {
  docType: string;
  name: string;
  meta?: string | null;
}) {
  return (
    <View style={s.header}>
      <Image src={logoLang} style={{ width: LOGO_LANG_W, height: LOGO_LANG_H, objectFit: "contain" }} />
      <View style={s.headerRight}>
        <Text style={s.docType}>{docType}</Text>
        <Text style={s.docName}>{name}</Text>
        {meta ? <Text style={s.docMeta}>{meta}</Text> : null}
      </View>
    </View>
  );
}

/** Slankere gjentakelse på side 2 og utover: bare emblem og navn. */
export function BrandRunningHeader({ name, meta }: { name: string; meta?: string | null }) {
  return (
    <View style={s.slimHeader} fixed render={({ pageNumber }) => (pageNumber === 1 ? null : undefined)}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Image src={logoEmblem} style={{ width: LOGO_EMBLEM_W * 0.7, height: LOGO_EMBLEM_H * 0.7, objectFit: "contain" }} />
        <Text style={[s.slimName, { marginLeft: 6, fontWeight: 700, color: INK }]}>{name}</Text>
      </View>
      {meta ? <Text style={s.slimName}>{meta}</Text> : null}
    </View>
  );
}

/** Bunntekst med emblem, bakerilinje og sidetall. Sett `left`/`right` lik sidemargen. */
export function BrandFooter({ margin }: { margin: number }) {
  return (
    <View style={[s.footer, { left: margin, right: margin }]} fixed>
      <Image src={logoEmblem} style={{ width: LOGO_EMBLEM_W, height: LOGO_EMBLEM_H, objectFit: "contain" }} />
      <Text style={s.footerCenter}>{FOOTER_LINE}</Text>
      <Text style={s.footerRight} render={({ pageNumber, totalPages }) => `Side ${pageNumber} av ${totalPages}`} />
    </View>
  );
}

/** Fotnote for grunnoppskrift-merket «†». Vises bare når en linje er merket. */
export function SubRecipeFootnote({ show }: { show: boolean }) {
  if (!show) return null;
  return <Text style={s.footNote}>† grunnoppskrift/halvfabrikat</Text>;
}

/** Bakgrunnsfargen for annenhver rad i ingredienstabellene. */
export function zebraBg(index: number): { backgroundColor?: string } {
  return index % 2 === 1 ? { backgroundColor: ZEBRA } : {};
}
