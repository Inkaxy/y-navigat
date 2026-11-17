// Demo D – svarene i «Nye varer». Skriver bare via dagens vei (link-supplier-item → rm_link_supplier_item) og,
// når 20261119_fra_faktura er kjørt, rm_remember_supplier_item_names / rm_undo_supplier_item_link.
// «Ikke vare» angres med rm_undo_not_item (kjørt 17.11). Ukjent utfall sendes aldri automatisk på nytt.
import { useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/hooks/useCompany";
import { callPendingRpc, useCapability } from "@/lib/pendingRpc";
import { invalidateAfterLink, linkSupplierItem } from "@/fakturaer/hooks/useSupplierItems";
import { invalidateRavarerCounts } from "@/ravarer/lib/invalidate";
import { parseUndoResult, undoSummary } from "@/ravarer/lib/quickAnswers";
import { NEW_ITEM_TYPE_LABEL, packagePayload, type NewItemType, type PackageState } from "@/ravarer/lib/fraFaktura/newItems";

export type NewItemUndo =
  | { kind: "kobling"; supplierId: string; itemKey: string; lineIds: string[]; rawMaterialId: string; created: boolean }
  | { kind: "ikke_vare"; supplierId: string; itemKey: string; lineIds: string[] };

export interface NewItemReceipt { title: string; detail: string; undo: NewItemUndo | null; undone?: string | null }

export interface LinkInput {
  supplierId: string; supplierName: string | null; itemKey: string; text: string; lineIds: string[];
  target: { kind: "existing"; id: string; name: string } | { kind: "new"; name: string; type: NewItemType };
  pkg: PackageState;
}

const lines = (n: number) => `${n} ${n === 1 ? "fakturalinje" : "fakturalinjer"}`;

export function useNewItemActions() {
  const qc = useQueryClient();
  const { data: company } = useCompany();
  const capFra = useCapability("rm_cap_fra_faktura_v1");
  const capUndoNotItem = useCapability("rm_cap_beslutninger_v1");

  const refresh = (rmId?: string) => {
    invalidateAfterLink(qc, rmId);
    invalidateRavarerCounts(qc);
    void qc.invalidateQueries({ queryKey: ["ravarer", "work-items"] });
    void qc.invalidateQueries({ queryKey: ["ravarer", "fra-faktura"] });
    void qc.invalidateQueries({ queryKey: ["raw_materials"] });
  };

  /** Koble eller opprett. Ett svar kobler alle åpne linjer med samme leverandørvare og godkjenner pakningen. */
  const link = async (i: LinkInput): Promise<NewItemReceipt> => {
    if (!company) throw new Error("Selskapet er ikke lastet ennå.");
    if (i.pkg.state !== "valid") throw new Error("Fyll inn pakningen først.");
    const pkg = packagePayload(i.pkg);
    const r = await linkSupplierItem({
      legal_entity_id: company.id, supplier_id: i.supplierId, item_key: i.itemKey,
      ...(i.target.kind === "existing"
        ? { raw_material_id: i.target.id }
        : { new_raw_material: { name: i.target.name.trim(), base_unit: i.pkg.baseUnit, item_type: i.target.type } }),
      ...(pkg ? { package: pkg } : {}),
      ...(i.lineIds.length ? { line_ids: i.lineIds } : {}),
    }).finally(() => refresh());
    const rmId = r.raw_material_id;
    if (capFra === true && r.raw_material_supplier_id) {
      // Skrivemåtene huskes etter koblingen. Feil her gjør ikke koblingen ugyldig.
      const m = await callPendingRpc("rm_remember_supplier_item_names", { p_legal_entity_id: company.id, p_supplier_id: i.supplierId, p_item_key: i.itemKey, p_raw_material_supplier_id: r.raw_material_supplier_id });
      if (m.kind !== "ok") console.warn("[fra-faktura] skrivemåter ble ikke lagret", m.kind);
    }
    refresh(rmId ?? undefined);
    const what = i.target.kind === "existing" ? `«${i.target.name}»` : `ny ${NEW_ITEM_TYPE_LABEL[i.target.type].toLowerCase()} «${i.target.name.trim()}»`;
    const open = r.still_open_lines > 0 ? ` ${r.still_open_lines} står fortsatt til kontroll.` : "";
    return {
      title: i.text, detail: `${what}. ${lines(r.lines_updated)} koblet.${open}`,
      undo: rmId && r.lines_updated > 0 && i.lineIds.length ? { kind: "kobling", supplierId: i.supplierId, itemKey: i.itemKey, lineIds: i.lineIds, rawMaterialId: rmId, created: r.created_raw_material } : null,
    };
  };

  /** «Ikke vare»: dagens regel for alle senere fakturaer fra leverandøren. */
  const notItem = async (i: { supplierId: string; supplierName: string | null; itemKey: string; text: string; lineIds: string[] }): Promise<NewItemReceipt> => {
    if (!company) throw new Error("Selskapet er ikke lastet ennå.");
    if (i.lineIds.length === 0) throw new Error("Ingen åpne linjer. Last siden på nytt.");
    await linkSupplierItem({ legal_entity_id: company.id, supplier_id: i.supplierId, item_key: i.itemKey, not_raw_material: true, reason: "Ikke vare (Fra faktura)", line_ids: i.lineIds })
      .finally(() => refresh());
    return { title: i.text, detail: `ikke en vare. Hoppes over på alle fakturaer fra ${i.supplierName ?? "leverandøren"}.`, undo: { kind: "ikke_vare", supplierId: i.supplierId, itemKey: i.itemKey, lineIds: i.lineIds } };
  };

  const canUndo = (u: NewItemUndo | null): boolean => !!u && (u.kind === "kobling" ? capFra === true : capUndoNotItem === true);

  /** Angre. Gir norsk kvitteringstekst; kaster ved ukjent utfall slik at knappen ikke lover noe. */
  const undo = async (u: NewItemUndo): Promise<string> => {
    if (!company) throw new Error("Selskapet er ikke lastet ennå.");
    const r = u.kind === "kobling"
      ? await callPendingRpc("rm_undo_supplier_item_link", { p_legal_entity_id: company.id, p_supplier_id: u.supplierId, p_item_key: u.itemKey, p_line_ids: u.lineIds, p_raw_material_id: u.rawMaterialId, p_created: u.created })
      : await callPendingRpc("rm_undo_not_item", { p_legal_entity_id: company.id, p_supplier_id: u.supplierId, p_item_key: u.itemKey, p_line_ids: u.lineIds, p_remove_rule: true });
    refresh(u.kind === "kobling" ? u.rawMaterialId : undefined);
    if (r.kind === "missing") throw new Error("Angre venter på databaseendringen.");
    if (r.kind === "denied") throw new Error("Du har ikke skrivetilgang til fakturaer.");
    const o = r.kind === "ok" ? parseUndoResult(r.data) : null;
    if (!o) throw new Error("Utfallet er ukjent. Kontroller fakturaen før du prøver igjen.");
    const deactivated = r.kind === "ok" && typeof r.data === "object" && r.data !== null && "deactivated" in r.data && r.data.deactivated === true;
    return `${undoSummary(o)}${deactivated ? " Den nye varen er satt inaktiv." : ""}`;
  };

  return { link, notItem, undo, canUndo, capFra };
}
