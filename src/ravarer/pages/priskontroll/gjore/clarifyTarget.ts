/**
 * Avklaringer i varekortets prisdel: hver sperret linje beholder serverens årsak (`reason`) og handling (`action`),
 * og får ett årsaksspesifikt mål i en EKSISTERENDE arbeidsflyt (fakturasiden med `linje`/`fokus`/`retur`).
 * Ingen skriving her — målet åpner bare riktig side; brukeren gjør selve avklaringen der.
 */
import type { ActionRequired } from "@/fakturaer/lib/financialPresentation";
import { paths } from "@/ravarer/lib/paths";
import { RETURN_PARAM } from "@/ravarer/pages/priskontroll/fakturaer/visning";

/** Fokusparameter som fakturasiden leser (`FakturaWorkspace` → `FocusNotice`). */
export const FOCUS_PARAM = "fokus";
export type FocusKind = "sum" | "lesing" | "kreditnota" | "prisgrunnlag";
export const parseFocus = (v: string | null): FocusKind | null =>
  v === "sum" || v === "lesing" || v === "kreditnota" || v === "prisgrunnlag" ? v : null;

/** Årsaksgruppe. `pakning` og `status` løses i selve varekortet (pakningsskjema / Prøv igjen). */
export type ClarifyKind = FocusKind | "pakning" | "status" | "faktura";

export type ClarifyLine = { id: string; invoice_id: string; invoice_number: string | null; invoice_date: string | null; reason: string; action: ActionRequired };

export function clarifyKind(b: Pick<ClarifyLine, "reason" | "action">): ClarifyKind {
  if (b.reason === "unchecked") return "status";
  if (b.reason === "invoice_sum_not_verified") return "sum";
  switch (b.action) {
    case "review_credit_note": return "kreditnota";
    case "review_reading": return "lesing";
    case "confirm_price_basis": return "prisgrunnlag";
    case "complete_link_or_package": return "pakning";
    default: return "faktura";
  }
}

export const CLARIFY_BUTTON: Record<ClarifyKind, string> = {
  sum: "Kontroller fakturasummen",
  lesing: "Kontroller linjen mot originalen",
  kreditnota: "Kontroller kreditnotaen",
  prisgrunnlag: "Kontroller sammenligningsprisen",
  pakning: "Kontroller pakningen",
  status: "Prøv igjen",
  faktura: "Åpne fakturaen",
};

export const CLARIFY_GROUP: Record<ClarifyKind, string> = {
  sum: "fakturasum ikke kontrollert",
  lesing: "lesing må kontrolleres",
  kreditnota: "kreditnota",
  prisgrunnlag: "sammenligningspris må avklares",
  pakning: "pakning/kobling må avklares",
  status: "prisstatus ikke hentet",
  faktura: "fakturaen må kontrolleres",
};

/** Returkontekst: arbeidsbordets spørrestreng (med `fane=gjore`) eller varekortets egen sti. */
export function clarifyReturn(pathname: string, search: string): string | null {
  if (pathname === "/ravarer/priskontroll") {
    const sp = new URLSearchParams(search);
    sp.delete(RETURN_PARAM);
    if (!sp.get("fane")) sp.set("fane", "gjore");
    return `?${sp.toString()}`;
  }
  if (pathname.startsWith("/ravarer/priskontroll/varekort/")) return `${pathname}${search}`;
  return null;
}

/** Lenke til riktig eksisterende flyt, eller null når avklaringen skjer i varekortet. */
export function clarifyHref(b: ClarifyLine, ret: string | null): string | null {
  const k = clarifyKind(b);
  if (k === "pakning" || k === "status") return null;
  return paths.faktura(b.invoice_id, { linje: b.id, [FOCUS_PARAM]: k === "faktura" ? null : k, [RETURN_PARAM]: ret });
}

const validDate = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Første avklaring: eldste gyldige fakturadato, stabil på fakturanummer og linje-id. Ukjent status kommer sist. */
export function startTarget<B extends ClarifyLine>(blocked: B[]): B | null {
  const cands = blocked.filter((b) => clarifyKind(b) !== "status");
  const pool = cands.length ? cands : blocked;
  const sorted = [...pool].sort((a, b) => {
    const da = validDate(a.invoice_date) ? a.invoice_date! : "9999-99-99";
    const db = validDate(b.invoice_date) ? b.invoice_date! : "9999-99-99";
    return da.localeCompare(db) || (a.invoice_number ?? "").localeCompare(b.invoice_number ?? "") || a.id.localeCompare(b.id);
  });
  return sorted[0] ?? null;
}

/** «2 fakturasum ikke kontrollert · 4 sammenligningspris må avklares · 1 kreditnota». */
export function clarifySummary(blocked: Pick<ClarifyLine, "reason" | "action">[]): string {
  const m = new Map<ClarifyKind, number>();
  for (const b of blocked) { const k = clarifyKind(b); m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([k, n]) => `${n} ${CLARIFY_GROUP[k]}`).join(" · ");
}
