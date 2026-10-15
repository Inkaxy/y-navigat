/**
 * Hurtigfiltrene på Fakturaer-fanen (`?visning=`) og mappingen fra gamle
 * innboks-/listeparametre. Rene funksjoner — testes uten React.
 */
export const FAKTURA_VISNINGER = ["trenger", "klar", "etterkontroll", "avstemt", "utenfor", "alle"] as const;
export type FakturaVisning = (typeof FAKTURA_VISNINGER)[number];
export type AvstemtModus = "auto" | "manuell";

export const VISNING_LABEL: Record<FakturaVisning, string> = {
  trenger: "Trenger meg",
  klar: "Klare til avstemming",
  etterkontroll: "Godkjent – etterkontroll",
  avstemt: "Avstemt",
  utenfor: "Holdt utenfor",
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

/** Returparameteren på faktura-arbeidsflaten. `fra` er datofilteret i listen. */
export const RETURN_PARAM = "retur";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returkonteksten fra adressen: `retur`, ellers gammel `fra` når den ikke er en dato. */
export function readReturnParam(sp: URLSearchParams): string | null {
  const r = sp.get(RETURN_PARAM);
  if (r) return r;
  const legacy = sp.get("fra");
  return legacy && !ISO_DATE.test(legacy) ? legacy : null;
}

/** Listens spørrestreng som trygg returkontekst (aldri en sti). */
export function sanitizeReturnSearch(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN) return "";
  const body = raw.startsWith("?") ? raw.slice(1) : raw;
  if (body.startsWith("/") || body.includes("#") || /^[a-z][a-z0-9+.-]*:/i.test(body)) return "";
  const sp = new URLSearchParams(body);
  sp.delete(RETURN_PARAM);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/** Tillatte opprinnelser for returstier i appen (leverandørkort, lager). Aldri ekstern. */
const SAFE_RETURN_PATH = /^\/ravarer\/(leverandorer(\/[A-Za-z0-9-]+)?|lager|priskontroll\/varekort\/[A-Za-z0-9%._~-]+\/[A-Za-z0-9%._~-]+)(\?[^#\\]*)?$/;

/** Trygg returstien innen appen, eller null. Avviser protokoll, `//`, backslash og fragment. */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN) return null;
  if (raw.startsWith("//") || raw.includes("\\") || raw.includes("#")) return null;
  return SAFE_RETURN_PATH.test(raw) ? raw : null;
}

/** Retur med lesbar etikett: leverandør/lager-sti, ellers listens spørrestreng. */
export function fakturaReturn(fra: string | null | undefined): { href: string; label: string } {
  const path = safeReturnPath(fra);
  if (path) return { href: path, label: path.startsWith("/ravarer/priskontroll/varekort/") ? "Varekort" : path.startsWith("/ravarer/lager") ? "Lager" : path.startsWith("/ravarer/leverandorer/") ? "Leverandør" : "Leverandører" };
  const href = fakturaBackHref(fra);
  return { href, label: new URLSearchParams(sanitizeReturnSearch(fra)).get("fane") === "gjore" ? "Å gjøre" : "Fakturaer" };
}

/** Tilbake til Fakturaer-listen med bevarte filtre. */
export function fakturaBackHref(fra: string | null | undefined): string {
  const s = sanitizeReturnSearch(fra);
  return s ? `/ravarer/priskontroll${s}` : "/ravarer/priskontroll?fane=fakturaer";
}
