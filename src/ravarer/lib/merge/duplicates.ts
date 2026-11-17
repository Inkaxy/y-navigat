// «Mulige duplikater» i Råvarer › Varer: samme leverandør + samme varenummer (også lærte varenumre), eller
// svært like navn hos samme leverandør. Bare forslag – ingenting slås sammen herfra. Ren logikk (testes).
import { nameSimilarity } from "@/ravarer/lib/fraFaktura/newItems";

export interface DupItem { id: string; name: string; is_active: boolean }
export interface DupLink { raw_material_id: string; supplier_id: string; supplier_name: string | null; supplier_sku: string | null; supplier_product_name: string | null; sku_aliases?: readonly string[] }
export type DupReason = { kind: "varenummer"; supplierName: string; sku: string } | { kind: "navn"; supplierName: string };
export interface DupGroup { key: string; ids: string[]; reasons: DupReason[] }

export const NAME_MATCH_MIN = 0.85;
export const skuKey = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Grupper (union-find) av aktive varer som trolig er samme vare. Eldste rekkefølge er stabil: navn, så id. */
export function findDuplicateGroups(items: readonly DupItem[], links: readonly DupLink[], minName = NAME_MATCH_MIN): DupGroup[] {
  const active = new Map(items.filter((i) => i.is_active).map((i) => [i.id, i]));
  const parent = new Map<string, string>();
  const find = (x: string): string => { const p = parent.get(x) ?? x; if (p === x) return x; const r = find(p); parent.set(x, r); return r; };
  const reasons = new Map<string, DupReason[]>();
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const join = (a: string, b: string, why: DupReason) => {
    if (a === b) return;
    const k = pairKey(a, b);
    const list = reasons.get(k) ?? [];
    if (!list.some((r) => r.kind === why.kind && (r.kind === "navn" || (why.kind === "varenummer" && r.sku === why.sku)))) list.push(why);
    reasons.set(k, list);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const bySupplier = new Map<string, DupLink[]>();
  for (const l of links) {
    if (!active.has(l.raw_material_id)) continue;
    const list = bySupplier.get(l.supplier_id) ?? [];
    list.push(l);
    bySupplier.set(l.supplier_id, list);
  }
  for (const list of bySupplier.values()) {
    const bySku = new Map<string, { rm: string; sku: string }[]>();
    for (const l of list) {
      const skus = new Set([l.supplier_sku, ...(l.sku_aliases ?? [])].filter((s): s is string => !!s && skuKey(s).length > 0));
      for (const s of skus) {
        const k = skuKey(s);
        const arr = bySku.get(k) ?? [];
        if (!arr.some((x) => x.rm === l.raw_material_id)) arr.push({ rm: l.raw_material_id, sku: s });
        bySku.set(k, arr);
      }
    }
    for (const arr of bySku.values()) {
      for (let i = 1; i < arr.length; i++) {
        const l = list.find((x) => x.raw_material_id === arr[i].rm);
        join(arr[0].rm, arr[i].rm, { kind: "varenummer", supplierName: l?.supplier_name ?? "Ukjent leverandør", sku: arr[0].sku });
      }
    }
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.raw_material_id === b.raw_material_id) continue;
        const na = active.get(a.raw_material_id)!.name, nb = active.get(b.raw_material_id)!.name;
        const s = Math.max(
          nameSimilarity(na, nb),
          a.supplier_product_name && b.supplier_product_name ? nameSimilarity(a.supplier_product_name, b.supplier_product_name) : 0,
        );
        if (s >= minName) join(a.raw_material_id, b.raw_material_id, { kind: "navn", supplierName: a.supplier_name ?? "Ukjent leverandør" });
      }
    }
  }
  const groups = new Map<string, Set<string>>();
  for (const id of active.keys()) {
    if (!parent.has(id) && ![...parent.values()].includes(id)) continue;
    const r = find(id);
    const set = groups.get(r) ?? new Set<string>();
    set.add(id);
    groups.set(r, set);
  }
  const nameOf = (id: string) => active.get(id)?.name ?? "";
  return [...groups.values()]
    .filter((s) => s.size > 1)
    .map((s) => {
      const ids = [...s].sort((a, b) => nameOf(a).localeCompare(nameOf(b), "nb") || a.localeCompare(b));
      const rs: DupReason[] = [];
      for (const [k, list] of reasons) {
        const [a, b] = k.split("|");
        if (!s.has(a) || !s.has(b)) continue;
        for (const r of list) {
          if (!rs.some((x) => x.kind === r.kind && x.supplierName === r.supplierName && (x.kind === "navn" || (r.kind === "varenummer" && x.sku === r.sku)))) rs.push(r);
        }
      }
      return { key: ids.join("|"), ids, reasons: rs.sort((a, b) => Number(a.kind === "navn") - Number(b.kind === "navn")) };
    })
    .sort((a, b) => nameOf(a.ids[0]).localeCompare(nameOf(b.ids[0]), "nb"));
}

export function reasonText(r: DupReason): string {
  return r.kind === "varenummer" ? `Samme varenummer ${r.sku} hos ${r.supplierName}` : `Svært likt navn hos ${r.supplierName}`;
}
