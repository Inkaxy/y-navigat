/** Leverandørkortets seksjoner (`?seksjon=`) og listekontekst (`?liste=`) for «Tilbake». */
export const SUPPLIER_SECTIONS = ["oversikt", "varer", "avtaler", "fakturaer", "aliaser", "forhandlinger", "notater"] as const;
export type SupplierSectionId = (typeof SUPPLIER_SECTIONS)[number];

export const SUPPLIER_SECTION_LABEL: Record<SupplierSectionId, string> = {
  oversikt: "Oversikt",
  varer: "Varer",
  avtaler: "Avtaler",
  fakturaer: "Fakturaer",
  aliaser: "Aliaser",
  forhandlinger: "Forhandlinger",
  notater: "Notater",
};

/** Ukjent eller manglende seksjon → oversikt (aldri tom side). */
export function readSupplierSection(sp: URLSearchParams): SupplierSectionId {
  const v = sp.get("seksjon");
  return (SUPPLIER_SECTIONS as readonly string[]).includes(v ?? "") ? (v as SupplierSectionId) : "oversikt";
}

/** Bytter seksjon og beholder øvrige parametere (bl.a. `liste`). */
export function supplierSectionSearch(sp: URLSearchParams, s: SupplierSectionId): string {
  const n = new URLSearchParams(sp);
  if (s === "oversikt") n.delete("seksjon");
  else n.set("seksjon", s);
  const q = n.toString();
  return q ? `?${q}` : "";
}

/** Listens søk/filter/valgt som skal tilbake når brukeren går ut av kortet. */
export function listReturnSearch(sp: URLSearchParams): string {
  const raw = sp.get("liste");
  if (!raw) return "";
  const inner = new URLSearchParams(raw);
  // Bare kjente listeparametere slippes gjennom.
  const out = new URLSearchParams();
  for (const k of ["q", "status", "visning", "inaktive", "valgt"]) {
    const v = inner.get(k);
    if (v) out.set(k, v);
  }
  const q = out.toString();
  return q ? `?${q}` : "";
}

export type SupplierView = "alle" | "folges" | "aktive";
export function readSupplierView(sp: URLSearchParams): SupplierView {
  const v = sp.get("visning");
  return v === "folges" || v === "aktive" ? v : "alle";
}
