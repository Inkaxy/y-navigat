// «Fra faktura › Nye varer»: ferdige svar (koble/opprett/ikke vare) i denne fanen. Ren logikk + et lite lager i minnet.
//
// Hvorfor: listen og tellerne kommer fra tunge oppslag som hentes sjelden. Et svar skal straks bli til en kvittering
// og trekke én fra tellerne, og et svar som var på vei fra serveren FØR lagringen skal ikke legge raden tilbake.
// Lageret lever til siden lastes på nytt (ikke i nettleserlagring), og overlever bytte av fane/leverandør.
import type { NewItemsPage } from "./newItemsPaging";

/** Nøkkelprefiks for listen over nye varer (re-eksporteres som `NEW_ITEMS_LIST_KEY`). */
export const NEW_ITEMS_LIST_KEY_BASE = ["ravarer-nye-varer"] as const;

export type NewItemsGroup = "kobling" | "pakning";
export interface DoneEntry<R = unknown> {
  key: string;
  supplierId: string;
  /** Gruppen raden sto i (ukoblet = kobling, koblet uten pakning = pakning). */
  group: NewItemsGroup;
  /** Klokkeslett da lagringen ble SENDT. Et oppslag som startet før dette, regnet med raden. */
  sentAt: number;
  receipt: R;
}

export const groupOfKind = (kind: string | null | undefined): NewItemsGroup => (kind === "mangler_pakning" ? "pakning" : "kobling");

/** Et oppslag som startet før lagringen ble sendt, telte raden. (Startet det etterpå, er det uvisst – da trekkes ingenting.) */
const countedBy = (startedAt: number | undefined, e: DoneEntry) => (startedAt ?? 0) < e.sentAt;

/** Siden slik den ser ut etter svarene: ferdige rader borte, totaler og tellere trukket ned én gang per svar. */
export function pageWithDone(page: NewItemsPage, entries: readonly DoneEntry[], supplierFilter: string | null): NewItemsPage {
  let p = page;
  for (const e of entries) {
    if (supplierFilter && e.supplierId !== supplierFilter) continue;
    const present = p.items.some((i) => i.key === e.key);
    if (!present && !countedBy(p.startedAt, e)) continue;
    const sameList = p.param.source === "rask" || p.param.group === e.group;
    const c = p.counts[e.group];
    p = {
      ...p,
      items: present ? p.items.filter((i) => i.key !== e.key) : p.items,
      total: sameList ? Math.max(0, p.total - 1) : p.total,
      counts: { ...p.counts, [e.group]: c == null ? null : Math.max(0, c - 1) },
      suppliers: p.suppliers ? p.suppliers.map((s) => (s.supplier_id === e.supplierId ? { ...s, count: Math.max(0, s.count - 1) } : s)) : null,
    };
  }
  return p;
}

/** Teller (meny/fane) etter svarene: trekker svar sendt etter at telleroppslaget startet. Null forblir ukjent. */
export function countWithDone(count: number | null, entries: readonly DoneEntry[], startedAt: number | undefined): number | null {
  if (count == null) return null;
  return Math.max(0, count - entries.filter((e) => countedBy(startedAt, e)).length);
}

/**
 * Antall ferdige rader serveren har fjernet foran neste side i samme liste: de som står i de hentede sidene og ble
 * lagret etter at den siste siden ble hentet (tidligere svar er alt regnet med i den sidens startpunkt).
 * «Vis flere» starter så mange plasser tidligere, slik at ingen rad hoppes over (overlapp fjernes som duplikat).
 */
export function doneBefore(pages: readonly NewItemsPage[], last: NewItemsPage, entries: readonly DoneEntry[]): number {
  const keys = new Set(entries.filter((e) => countedBy(last.startedAt, e)).map((e) => e.key));
  if (keys.size === 0) return 0;
  const param = last.param;
  const same = (p: NewItemsPage) => p.param.source === param.source && (param.source === "rask" || (p.param.source === "arbeidsliste" && p.param.group === param.group));
  let n = 0;
  for (const p of pages) if (same(p)) for (const i of p.items) if (keys.has(i.key)) n++;
  return n;
}

// ---------- Lager i minnet, per selskap ----------
type Listener = () => void;
export interface DoneStore<R> {
  list(le: string | null): readonly DoneEntry<R>[];
  add(le: string, e: DoneEntry<R>): void;
  remove(le: string, key: string): void;
  subscribe(l: Listener): () => void;
  clear(): void;
}

export function createDoneStore<R>(): DoneStore<R> {
  let byLe = new Map<string, readonly DoneEntry<R>[]>();
  const listeners = new Set<Listener>();
  const EMPTY: readonly DoneEntry<R>[] = [];
  const emit = () => listeners.forEach((l) => l());
  return {
    list: (le) => (le ? byLe.get(le) ?? EMPTY : EMPTY),
    add: (le, e) => {
      const cur = (byLe.get(le) ?? []).filter((x) => x.key !== e.key);
      byLe = new Map(byLe).set(le, [...cur, e]);
      emit();
    },
    remove: (le, key) => {
      const cur = byLe.get(le);
      if (!cur || !cur.some((x) => x.key === key)) return;
      byLe = new Map(byLe).set(le, cur.filter((x) => x.key !== key));
      emit();
    },
    subscribe: (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    clear: () => { byLe = new Map(); emit(); },
  };
}
