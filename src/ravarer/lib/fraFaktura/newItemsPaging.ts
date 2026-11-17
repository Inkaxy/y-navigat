// «Fra faktura › Nye varer»: sidevis henting. Ren logikk.
// Rask vei: rm_new_items_queue (20261119_nye_varer_les) – én liste, eldste først, tellere og leverandørtall i samme svar.
// Dagens vei (før SQL-en er kjørt): rm_work_items, først gruppen «kobling» side for side, deretter «pakning».
import { isObj } from "@/fakturaer/lib/parseRpcJson";
import { parseWorkItemList, type WorkItem } from "@/ravarer/lib/workRpc";

export const NEW_ITEMS_PAGE = 50;

export type NewItemsPageParam =
  | { source: "rask"; offset: number }
  | { source: "arbeidsliste"; group: "kobling" | "pakning"; offset: number };

export type SupplierCount = { supplier_id: string; supplier_name: string | null; count: number };

export type NewItemsPage = {
  param: NewItemsPageParam;
  items: WorkItem[];
  /** Antall elementer serveren sendte (før klientfilter), brukt til neste forskyvning. */
  rawCount: number;
  /** Antall i gruppen/listen siden gjelder (etter leverandørfilter). */
  total: number;
  /** Tellere for kobling/pakning i samme svar; null = ukjent. */
  counts: { kobling: number | null; pakning: number | null };
  /** Antall per leverandør (bare rask vei). */
  suppliers: SupplierCount[] | null;
};

export const firstNewItemsPage = (fast: boolean): NewItemsPageParam =>
  fast ? { source: "rask", offset: 0 } : { source: "arbeidsliste", group: "kobling", offset: 0 };

/** Neste side, eller `undefined` når alt er hentet. Dagens vei går fra «kobling» til «pakning». */
export function nextNewItemsPage(last: NewItemsPage): NewItemsPageParam | undefined {
  const end = last.param.offset + last.rawCount;
  const more = last.rawCount > 0 && end < last.total;
  if (last.param.source === "rask") return more ? { source: "rask", offset: end } : undefined;
  if (last.param.group === "kobling") {
    if (more) return { source: "arbeidsliste", group: "kobling", offset: end };
    return last.counts.pakning === 0 ? undefined : { source: "arbeidsliste", group: "pakning", offset: 0 };
  }
  return more ? { source: "arbeidsliste", group: "pakning", offset: end } : undefined;
}

const finite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

/** Streng lesing av rm_new_items_queue. Uleselig svar kastes (vises som feil, aldri som tom liste). */
export function parseNewItemsQueue(data: unknown, param: NewItemsPageParam): NewItemsPage {
  if (!isObj(data) || data.ok !== true) throw new Error("Uleselig svar fra listen over nye varer.");
  const total = finite(data.total);
  const c = isObj(data.counts) ? data.counts : null;
  const kobling = c ? finite(c.kobling) : null;
  const pakning = c ? finite(c.pakning) : null;
  if (total == null || kobling == null || pakning == null || !Array.isArray(data.items) || !Array.isArray(data.suppliers)) {
    throw new Error("Uleselig svar fra listen over nye varer.");
  }
  const suppliers: SupplierCount[] = data.suppliers.filter(isObj).flatMap((s) => {
    const n = finite(s.count);
    return typeof s.supplier_id === "string" && n != null
      ? [{ supplier_id: s.supplier_id, supplier_name: typeof s.supplier_name === "string" ? s.supplier_name : null, count: n }] : [];
  });
  return { param, items: parseWorkItemList(data.items), rawCount: data.items.length, total, counts: { kobling, pakning }, suppliers };
}

/** Radene i visningsrekkefølge (sidene etter hverandre), uten duplikater og bare varekort med leverandør og nøkkel. */
export function newItemsRows(pages: readonly NewItemsPage[]): (WorkItem & { supplier_id: string; item_key: string })[] {
  const seen = new Set<string>();
  const out: (WorkItem & { supplier_id: string; item_key: string })[] = [];
  for (const p of pages) for (const w of p.items) {
    if (w.type !== "varekort" || !w.supplier_id || !w.item_key || seen.has(w.key)) continue;
    seen.add(w.key);
    out.push({ ...w, supplier_id: w.supplier_id, item_key: w.item_key });
  }
  return out;
}

/** Antall rader i listen (etter filter); null = ukjent. Dagens vei: kobling + pakning fra første svar. */
export function newItemsTotal(pages: readonly NewItemsPage[]): number | null {
  const first = pages[0];
  if (!first) return null;
  if (first.param.source === "rask") return first.total;
  const { kobling, pakning } = first.counts;
  return kobling == null || pakning == null ? null : kobling + pakning;
}
