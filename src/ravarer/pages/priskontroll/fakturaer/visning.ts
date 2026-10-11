/**
 * Hurtigfiltrene på Fakturaer-fanen (`?visning=`) og mappingen fra gamle
 * innboks-/listeparametre. Rene funksjoner — testes uten React.
 */
export const FAKTURA_VISNINGER = ["trenger", "klar", "avstemt", "alle"] as const;
export type FakturaVisning = (typeof FAKTURA_VISNINGER)[number];
export type AvstemtModus = "auto" | "manuell";

export const VISNING_LABEL: Record<FakturaVisning, string> = {
  trenger: "Trenger meg",
  klar: "Klare til avstemming",
  avstemt: "Avstemt",
  alle: "Alle",
};

/** Gammel innboksfane (`innboks=klar|fullfort`) → nytt hurtigfilter. */
function fromLegacyInnboks(innboks: string | null): FakturaVisning {
  if (innboks === "klar") return "klar";
  if (innboks === "fullfort") return "avstemt";
  return "trenger";
}

export function parseVisning(sp: URLSearchParams): { visning: FakturaVisning; modus: AvstemtModus | null } {
  const raw = sp.get("visning");
  let visning: FakturaVisning;
  if (raw && (FAKTURA_VISNINGER as readonly string[]).includes(raw)) visning = raw as FakturaVisning;
  else if (raw === "innboks" || sp.has("innboks")) visning = fromLegacyInnboks(sp.get("innboks"));
  else visning = "trenger";
  const m = sp.get("modus");
  return { visning, modus: visning === "avstemt" && (m === "auto" || m === "manuell") ? m : null };
}

/**
 * Normaliserer en Priskontroll-URL: `?faktura=<id>` åpner faktura-arbeidsflaten,
 * `visning=innboks`/`innboks=…` blir de nye hurtigfiltrene. Gir ny URL, eller
 * null når adressen allerede er på ny form.
 */
export function normalizePriskontrollSearch(search: string): string | null {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const faktura = sp.get("faktura");
  if (faktura) return `/ravarer/priskontroll/faktura/${encodeURIComponent(faktura)}`;
  const raw = sp.get("visning");
  if (raw !== "innboks" && !sp.has("innboks")) return null;
  const next = new URLSearchParams();
  sp.forEach((v, k) => {
    if (k === "innboks") return;
    next.set(k, k === "visning" ? fromLegacyInnboks(sp.get("innboks")) : v);
  });
  if (!next.has("visning")) next.set("visning", fromLegacyInnboks(sp.get("innboks")));
  return `/ravarer/priskontroll?${next.toString()}`;
}

const MAX_RETURN = 1000;

/** Listens spørrestreng som trygg returkontekst (aldri en sti). */
export function sanitizeReturnSearch(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN) return "";
  const body = raw.startsWith("?") ? raw.slice(1) : raw;
  if (body.startsWith("/") || body.includes("#") || /^[a-z][a-z0-9+.-]*:/i.test(body)) return "";
  const sp = new URLSearchParams(body);
  sp.delete("fra");
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Tilbake til Fakturaer-listen med bevarte filtre. */
export function fakturaBackHref(fra: string | null | undefined): string {
  const s = sanitizeReturnSearch(fra);
  return s ? `/ravarer/priskontroll${s}` : "/ravarer/priskontroll?fane=fakturaer";
}
