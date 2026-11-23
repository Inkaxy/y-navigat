/**
 * Kostnadsposter (PENDING `1-kjor-na/02_kostnadsposter.sql`): strenge lesere for svarene. Alt som ikke har full form er
 * ukjent (null) – aldri en tom oversikt eller 0 kr. Beløp kan være null = ukjent beløp på minst én linje.
 */
import { bool, isObj, num, str, type Obj } from "@/fakturaer/lib/parseRpcJson";

export interface CostPostSupplier { supplierId: string; name: string | null; amount: number | null; lines: number; missingAmount: number }
export interface CostPostItem {
  supplierId: string; supplierName: string | null; itemKey: string; text: string | null;
  amount: number | null; lines: number; missingAmount: number; lastDate: string | null;
}
export interface CostPost {
  id: string; name: string; archived: boolean; amount: number | null; lines: number; invoices: number; missingAmount: number;
  suppliers: CostPostSupplier[]; items: CostPostItem[];
}
export interface CostSuggestion {
  supplierId: string; supplierName: string | null; itemKey: string; text: string | null; lineKind: string | null;
  amount: number | null; lines: number; missingAmount: number;
}
export interface CostSummary { year: number; invoices: number; unreadInvoices: number; posts: CostPost[]; suggestions: CostSuggestion[] }
export interface CostLine {
  id: string; invoiceId: string; invoiceNumber: string | null; invoiceDate: string | null; isCreditNote: boolean;
  supplierId: string | null; supplierName: string | null; text: string | null; quantity: number | null; unit: string | null;
  unitPrice: number | null; amount: number | null;
}
export interface CostLines { total: number; lines: CostLine[] }

const count = (o: Obj, k: string): number | null => { const n = num(o, k); return n != null && Number.isInteger(n) && n >= 0 ? n : null; };
/** Hver rad må lese; én uleselig rad gjør hele listen ukjent. */
function all<T>(v: unknown, f: (o: Obj) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) { const r = isObj(x) ? f(x) : null; if (!r) return null; out.push(r); }
  return out;
}
const amount = (o: Obj): number | null | undefined => (o.amount === null ? null : num(o, "amount") ?? undefined);

function supplier(o: Obj): CostPostSupplier | null {
  const id = str(o, "supplier_id"), lines = count(o, "lines"), miss = count(o, "missing_amount"), a = amount(o);
  return id && lines != null && miss != null && a !== undefined ? { supplierId: id, name: str(o, "name"), amount: a, lines, missingAmount: miss } : null;
}
function item(o: Obj): CostPostItem | null {
  const id = str(o, "supplier_id"), key = str(o, "item_key"), lines = count(o, "lines"), miss = count(o, "missing_amount"), a = amount(o);
  return id && key && lines != null && miss != null && a !== undefined
    ? { supplierId: id, supplierName: str(o, "supplier_name"), itemKey: key, text: str(o, "text"), amount: a, lines, missingAmount: miss, lastDate: str(o, "last_date") } : null;
}
function post(o: Obj): CostPost | null {
  const id = str(o, "id"), name = str(o, "name"), archived = bool(o, "archived"), a = amount(o);
  const lines = count(o, "lines"), invoices = count(o, "invoices"), miss = count(o, "missing_amount");
  const suppliers = all(o.suppliers, supplier), items = all(o.items, item);
  if (!id || !name || archived == null || a === undefined || lines == null || invoices == null || miss == null || !suppliers || !items) return null;
  return { id, name, archived, amount: a, lines, invoices, missingAmount: miss, suppliers, items };
}
function suggestion(o: Obj): CostSuggestion | null {
  const id = str(o, "supplier_id"), key = str(o, "item_key"), lines = count(o, "lines"), miss = count(o, "missing_amount"), a = amount(o);
  return id && key && lines != null && miss != null && a !== undefined
    ? { supplierId: id, supplierName: str(o, "supplier_name"), itemKey: key, text: str(o, "text"), lineKind: str(o, "line_kind"), amount: a, lines, missingAmount: miss } : null;
}

export function parseCostSummary(v: unknown): CostSummary | null {
  if (!isObj(v) || v.ok !== true) return null;
  const year = count(v, "year"), invoices = count(v, "invoices"), unread = count(v, "unread_invoices");
  const posts = all(v.posts, post), suggestions = all(v.suggestions, suggestion);
  if (year == null || invoices == null || unread == null || !posts || !suggestions) return null;
  return { year, invoices, unreadInvoices: unread, posts, suggestions };
}

function line(o: Obj): CostLine | null {
  const id = str(o, "id"), inv = str(o, "invoice_id"), a = amount(o);
  if (!id || !inv || a === undefined) return null;
  return {
    id, invoiceId: inv, invoiceNumber: str(o, "invoice_number"), invoiceDate: str(o, "invoice_date"), isCreditNote: bool(o, "is_credit_note") === true,
    supplierId: str(o, "supplier_id"), supplierName: str(o, "supplier_name"), text: str(o, "text"), quantity: num(o, "quantity"), unit: str(o, "unit"),
    unitPrice: num(o, "unit_price"), amount: a,
  };
}
export function parseCostLines(v: unknown): CostLines | null {
  if (!isObj(v) || v.ok !== true) return null;
  const total = count(v, "total"), lines = all(v.lines, line);
  return total != null && lines && lines.length <= total ? { total, lines } : null;
}

export type SavePostResult = { ok: true; id: string; name: string; existed: boolean } | { ok: false; code: string };
export function parseSavePost(v: unknown): SavePostResult | null {
  if (!isObj(v)) return null;
  if (v.ok === false) { const code = str(v, "code"); return code ? { ok: false, code } : null; }
  const id = str(v, "id"), name = str(v, "name");
  return v.ok === true && id && name ? { ok: true, id, name, existed: bool(v, "existed") === true } : null;
}

export type SetRuleResult = { ok: true; costPostId: string | null; previousPostId: string | null; changed: boolean } | { ok: false; code: string };
export function parseSetRule(v: unknown): SetRuleResult | null {
  if (!isObj(v)) return null;
  if (v.ok === false) { const code = str(v, "code"); return code ? { ok: false, code } : null; }
  const changed = bool(v, "changed");
  if (v.ok !== true || changed == null) return null;
  const idOrNull = (k: string): string | null | undefined => (v[k] === null ? null : str(v, k) ?? undefined);
  const cur = idOrNull("cost_post_id"), prev = idOrNull("previous_post_id");
  return cur === undefined || prev === undefined ? null : { ok: true, costPostId: cur, previousPostId: prev, changed };
}

export interface CostPostOption { id: string; name: string }
export function parsePostOptions(v: unknown): CostPostOption[] | null {
  return all(v, (o) => { const id = str(o, "id"), name = str(o, "name"); return id && name ? { id, name } : null; });
}

/** Norsk tekst for avvisningskodene fra serveren. */
export const COST_POST_CODE: Record<string, string> = {
  ugyldig_navn: "Navnet må ha 1–60 tegn.",
  navn_finnes: "Det finnes allerede en post med det navnet.",
  finnes_ikke: "Posten finnes ikke lenger. Last siden på nytt.",
  ukjent_post: "Posten er arkivert eller finnes ikke. Velg en annen.",
  ukjent_linje: "Fant ikke linjen på selskapets fakturaer.",
  ugyldig: "Valget kunne ikke lagres.",
};

/** Summen kan bare vises som komplett når ingen linje mangler beløp og alle fakturaer i året er lest. */
export function sumIsComplete(p: { amount: number | null; missingAmount: number }, unreadInvoices: number): boolean {
  return p.amount != null && p.missingAmount === 0 && unreadInvoices === 0;
}

export const LINE_KIND_LABEL: Record<string, string> = { frakt: "Frakt", gebyr: "Gebyr/avgift", pant: "Pant", annet: "Annet" };
