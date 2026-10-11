import type { WorkItem } from "@/ravarer/lib/workRpcTypes";
import type { LinkSupplierItemBody, LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";
import { failedRow, reportLinkRow, type BulkRowReport } from "@/fakturaer/lib/bulkLink";
import type { CardPreview } from "./bulkPreview";

/** Grense for bekreftelse før masseløp (samme som i fakturaarbeidsflaten). */
export const CONFIRM_ABOVE_LINES = 10;

export type BulkAction =
  | { kind: "ikke_vare"; reason: string }
  | { kind: "opprett"; category: string; baseUnit: string }
  /** Godta forslag: råvare per varekort — entydig forslag eller eksplisitt valgt kandidat. */
  | { kind: "godta"; choices: ReadonlyMap<string, string> };

/** Hvilke valgte elementer en handling kan gjelde (resten hoppes over med forklaring). */
export function eligible(items: readonly WorkItem[], action: BulkAction["kind"]): { ok: WorkItem[]; skipped: WorkItem[] } {
  const ok: WorkItem[] = []; const skipped: WorkItem[] = [];
  for (const it of items) {
    const isCard = it.type === "varekort" && !!it.supplier_id && !!it.item_key;
    const fits = action === "opprett" || action === "godta" ? isCard && it.kind === "ukoblet" : isCard;
    (fits ? ok : skipped).push(it);
  }
  return { ok, skipped };
}

export const totalLines = (items: readonly WorkItem[]) => items.reduce((s, i) => s + i.open_lines, 0);
/** Linjetall fra faktisk forhåndsvisning (fryste ID-er), ikke fra listens teller. */
export const previewLines = (items: readonly WorkItem[], previews: ReadonlyMap<string, CardPreview>) =>
  items.reduce((s, i) => s + (previews.get(i.key)?.lineIds.length ?? 0), 0);
const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Kjør handlingen sekvensielt over varekort på tvers av fakturaer og leverandører, via samme
 * motor som enkeltvis (`link-supplier-item`). Fortsetter ved feil og rapporterer per varekort.
 * Opprett: like navn opprettes én gang; resten kobles til råvaren som ble opprettet.
 */
export async function runBulk(
  items: readonly WorkItem[], action: BulkAction, legalEntityId: string,
  link: (b: LinkSupplierItemBody) => Promise<LinkSupplierItemResult>,
  onProgress?: (done: number, total: number) => void,
  previews?: ReadonlyMap<string, CardPreview>,
): Promise<BulkRowReport[]> {
  const out: BulkRowReport[] = [];
  const createdByName = new Map<string, string>();
  let n = 0;
  for (const it of items) {
    const name = it.title || it.sku || "Varekort";
    try {
      const base: LinkSupplierItemBody = { legal_entity_id: legalEntityId, supplier_id: it.supplier_id!, item_key: it.item_key! };
      // Fryste linje-ID-er fra forhåndsvisningen. Tomt utvalg hoppes over — sendes aldri som «alle».
      const pv = previews?.get(it.key);
      if (previews && (!pv || pv.lineIds.length === 0)) {
        out.push({ name, ok: false, text: pv?.error ? `hoppet over: ${pv.error.toLowerCase()}` : "hoppet over: ingen åpne linjer lenger" });
        n += 1; onProgress?.(n, items.length); continue;
      }
      if (pv) base.line_ids = pv.lineIds;
      const skippedNote = (r: LinkSupplierItemResult) => (r.skipped_line_ids?.length ? ` (${r.skipped_line_ids.length} løst i mellomtiden, urørt)` : "");
      if (action.kind === "godta") {
        const rmId = action.choices.get(it.key);
        if (!rmId) { out.push({ name, ok: false, text: "hoppet over: ingen entydig eller valgt forslag" }); n += 1; onProgress?.(n, items.length); continue; }
        const r = await link({ ...base, raw_material_id: rmId });
        const row = reportLinkRow(name, r);
        out.push({ ...row, text: row.text.replace(/^opprettet/, "forslag godtatt") + skippedNote(r) });
      } else if (action.kind === "ikke_vare") {
        const r = await link({ ...base, not_raw_material: true, reason: action.reason });
        out.push({ name, ok: true, text: `merket som ikke vare (${r.lines_updated} ${r.lines_updated === 1 ? "linje" : "linjer"})` });
      } else {
        const existing = createdByName.get(nameKey(name));
        const r = existing
          ? await link({ ...base, raw_material_id: existing })
          : await link({ ...base, new_raw_material: { name, base_unit: action.baseUnit, category: action.category, sku: it.sku ?? undefined } });
        if (!existing && r.raw_material_id) createdByName.set(nameKey(name), r.raw_material_id);
        out.push(existing ? { ...reportLinkRow(name, r), text: reportLinkRow(name, r).text.replace(/^opprettet/, "koblet til råvaren opprettet over") } : reportLinkRow(name, r));
      }
    } catch (e) {
      out.push(failedRow(name, e instanceof Error ? e.message : "ukjent feil"));
    }
    n += 1;
    onProgress?.(n, items.length);
  }
  return out;
}
