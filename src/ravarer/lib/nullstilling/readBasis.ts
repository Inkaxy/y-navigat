// «Nullstill køen» – romsligere lesing (Henriks valg 18.11.2026, før kjøring). Ren logikk, skriver ingenting.
//  A  Pakning i varenavnet godtas når den eksisterende tolkningen (`parsePackageFromDescription`, via `packageProposal`) gir én
//     entydig mengde som ikke motsies av leste pakningsfelt. Flere ulike mengder i teksten = flertydig. Ingen ny parser.
//  B  En linje med regnestykke-varsel er likevel ren når NØYAKTIG én forklaring går opp med linjesummen (±0,5 %, minst ±1 kr):
//     (1) antall × pakningsmengde × enhetspris, (2) antall × enhetspris − trykt rabatt, (3) (sum + rabatt) ÷ enhetspris = n,
//     der n = antall × stk i pakningen. Rabatt utledes aldri, og fakturalinjens antall endres aldri (prisen per grunnenhet
//     regnes fortsatt som sum ÷ (antall × pakning), samme som serveren gjør etter kobling).
import { lineReadIssues } from "@/fakturaer/lib/invoiceReadCheck";
import { parsePackageFromDescription, toBaseFactor, type PackageInfo } from "@/fakturaer/lib/units";
import { baseUnitForNew, packageProposal, readPackage, type PackageDraft } from "@/ravarer/lib/fraFaktura/newItems";
import type { CloseReason, SnapLine } from "./types";

export type Forklaring = 1 | 2 | 3;
export type PkgSource = "lest" | "direkte" | "varenavn";
export const FORKLARING_TEXT: Record<Forklaring, string> = {
  1: "antall × pakningsmengde × enhetspris",
  2: "antall × enhetspris − rabatt",
  3: "(linjesum + rabatt) ÷ enhetspris = antall × stk i pakningen",
};
/** Varsler på fakturanivå som gjør alle linjene urene. «reread_warning» bare oppsummerer linjevarslene og vurderes på linjen. */
const INVOICE_SOFT = new Set(["reread_warning"]);
/** Lagrede linjevarsler B kan forklare. Alt annet (ugyldig tall, mengde/pris mangler, prisgrunnlag, mulig rabatt …) er urent. */
const B_STORED = new Set(["regnestykke"]);

const fin = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
function magnitude(size: number, unit: string): { dim: string; v: number } {
  const g = toBaseFactor(unit, "g");
  if (g != null) return { dim: "masse", v: size * g };
  const ml = toBaseFactor(unit, "ml");
  if (ml != null) return { dim: "volum", v: size * ml };
  return { dim: unit, v: size };
}
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-9, 0.015 * Math.max(Math.abs(a), Math.abs(b)));

/**
 * A: pakningen i varenavnet. Den eksisterende tolkningen kjøres på nytt på resten av teksten; finnes en annen mengde som
 * verken er pakningen eller innerpakningen («OST 10 KG EMB 500 G»), er teksten flertydig.
 */
export function namePackage(desc: string | null | undefined): PackageInfo | "flertydig" | null {
  const first = parsePackageFromDescription(desc);
  if (!first) return null;
  const total = magnitude(first.size * first.count, first.unit), inner = magnitude(first.size, first.unit);
  let rest = norm(String(desc));
  let cut = first.matched;
  for (let i = 0; i < 8; i++) {
    const at = rest.indexOf(cut);
    if (at < 0) break;
    rest = norm(`${rest.slice(0, at)} ${rest.slice(at + cut.length)}`);
    const p = parsePackageFromDescription(rest);
    if (!p) return first;
    const m = magnitude(p.size * p.count, p.unit), mi = magnitude(p.size, p.unit);
    const fits = (x: { dim: string; v: number }) => x.dim === total.dim && (near(x.v, total.v) || near(x.v, inner.v));
    if (!fits(m) && !fits(mi)) return "flertydig";
    cut = p.matched;
  }
  return first;
}

export type LinePackage =
  | { ok: true; draft: PackageDraft; source: PkgSource; /** Stk i pakningen (lest antall eller «6 x» i navnet); 1 = ukjent/én. */ count: number }
  | { ok: false; why: CloseReason };

function fromDraft(l: SnapLine, d: PackageDraft): LinePackage {
  if (d.conflict) return { ok: false, why: "pakning_motsagt" };
  if (d.source === "direkte") return { ok: true, draft: d, source: "direkte", count: 1 };
  if (d.source === "lest") return { ok: true, draft: d, source: "lest", count: fin(l.count_per_package) && l.count_per_package > 1 ? l.count_per_package : 1 };
  if (d.source === "varenavn") {
    const n = namePackage(l.description);
    if (n === "flertydig") return { ok: false, why: "pakning_flertydig" };
    if (!n) return { ok: false, why: "pakning_uleselig" };
    // Lest antall per pakning som ikke stemmer med navnet («10 stk» lest, «2 x 5 kg» i navnet) motsier navnet.
    if (fin(l.count_per_package) && l.count_per_package > 1 && Math.abs(l.count_per_package - n.count) > 1e-9) return { ok: false, why: "pakning_motsagt" };
    return { ok: true, draft: d, source: "varenavn", count: n.count };
  }
  return { ok: false, why: "pakning_uleselig" };
}

/**
 * Pakningen for linjen: lest pakning, fakturert i grunnenhet, eller (A) varenavnet. Aldri antall utledet av regnestykket.
 * Koblet vare fakturert per stk mens varen har kg/l: den trykte pakningen (felt eller navn) brukes når den passer grunnenheten.
 */
export function linePackage(l: SnapLine, baseUnit: string | null = null): LinePackage {
  const d = packageProposal(l, null, null);
  if (d.source === "direkte" && baseUnit && readPackage(d, baseUnit).state !== "valid") {
    const printed = fromDraft(l, packageProposal({ ...l, unit: null }, null, null));
    if (printed.ok && printed.source !== "direkte" && readPackage(printed.draft, baseUnit).state === "valid") return { ...printed, draft: { ...printed.draft, container: d.container } };
  }
  return fromDraft(l, d);
}

export type ReadVerdict =
  | { ok: true; forklaring: 0 | Forklaring; /** Forklaringer som også passet (samme resultat). */ also: Forklaring[] }
  | { ok: false; why: CloseReason; detail?: string };

const storedCodes = (v: unknown): (string | null)[] =>
  Array.isArray(v) ? v.map((x: unknown) => (x && typeof x === "object" && "code" in x && typeof x.code === "string" ? x.code : null)) : [];

/** Lesingen av linjen. `pkg` trengs bare for forklaring (1) og (3). 0 = lesekontrollen er grønn uten forklaring. */
export function readVerdict(l: SnapLine, pkg: LinePackage | null, allowB = true): ReadVerdict {
  if (l.invoice_read_codes.some((c) => !INVOICE_SOFT.has(c))) return { ok: false, why: "lesevarsel_faktura", detail: l.invoice_read_codes.filter((c) => !INVOICE_SOFT.has(c)).join(", ") };
  if ((l.review_reason ?? "").split(",").map((s) => s.trim()).includes("extraction_unresolved")) return { ok: false, why: "uavklart_belop" };
  const stored = storedCodes(l.extraction_issues);
  if (stored.some((c) => c == null || !B_STORED.has(c))) return { ok: false, why: "lesevarsel" };
  const basis = (l.unit_price_basis ?? "").trim().toLowerCase() || null;
  const fresh = lineReadIssues({
    quantity: l.quantity, unit: l.unit, unit_price: l.unit_price, total_amount: l.total_amount, package_size: l.package_size,
    package_unit: l.package_unit, count_per_package: l.count_per_package, unit_price_basis: l.unit_price_basis, discount_amount: l.discount_amount,
    line_kind: l.line_kind, is_credit: l.is_credit_note,
  });
  if (stored.length === 0 && fresh.length === 0) return { ok: true, forklaring: 0, also: [] };
  // Dagens lesekontroll kaller «summen passer med pris per pakning/vekt» for prisgrunnlag_uavklart (uten oppgitt grunnlag). Det er
  // nettopp det B forklarer; samme kode med oppgitt grunnlag («mengden kan ikke regnes om») forblir uren.
  if (fresh.some((i) => !(i.code === "regnestykke" || (i.code === "prisgrunnlag_uavklart" && basis == null)))) return { ok: false, why: "lesevarsel" };
  if (!allowB) return { ok: false, why: "lesevarsel" };
  return explain(l, pkg);
}

function explain(l: SnapLine, pkg: LinePackage | null): ReadVerdict {
  const q = l.quantity, p = l.unit_price, t = l.total_amount;
  if (!fin(q) || !fin(p) || !fin(t) || q <= 0 || p <= 0 || t <= 0) return { ok: false, why: "lesevarsel" };
  const d = fin(l.discount_amount) && l.discount_amount > 0 ? l.discount_amount : 0;
  const tol = Math.max(1, 0.005 * t);
  const nat = pkg?.ok ? readPackage(pkg.draft, baseUnitForNew(pkg.draft.unit)) : null;
  const P = nat && nat.state === "valid" ? nat.baseUnitsPerPackage : null;
  const c = pkg?.ok ? pkg.count : 1;
  // Resultat = pris per grunnenhet slik forklaringen leser enhetsprisen (null = ukjent uten pakning).
  const fits: { f: Forklaring; res: number | null }[] = [];
  if (P != null && Math.abs(q * P * p - d - t) <= tol) fits.push({ f: 1, res: p });
  if (Math.abs(q * p - d - t) <= tol) fits.push({ f: 2, res: P != null ? p / P : null });
  const n = Math.round((t + d) / p);
  if (n >= 1 && n !== q && c > 1 && Math.abs(n * p - (t + d)) <= tol && Math.abs(n - q * c) < 1e-6) fits.push({ f: 3, res: P != null ? (p * c) / P : null });
  if (fits.length === 0) return { ok: false, why: "regnestykke_uforklart" };
  const known = fits.filter((x) => x.res != null) as { f: Forklaring; res: number }[];
  const differs = known.some((a) => known.some((b) => Math.abs(a.res / b.res - 1) > 0.005));
  if (differs) return { ok: false, why: "regnestykke_flertydig", detail: `passer med (${fits.map((x) => x.f).join("), (")}) med ulik pris` };
  return { ok: true, forklaring: fits[0].f, also: fits.slice(1).map((x) => x.f) };
}

/** C: prisen per grunnenhet spriker mer enn ±20 % mellom linjene (største ÷ minste − 1 > 20 %). */
export function priceSpread(ppbs: readonly number[], max = 0.2): { spread: boolean; min: number; max: number } | null {
  if (ppbs.length < 2) return null;
  const lo = Math.min(...ppbs), hi = Math.max(...ppbs);
  return { spread: lo > 0 && hi / lo - 1 > max + 1e-9, min: lo, max: hi };
}
