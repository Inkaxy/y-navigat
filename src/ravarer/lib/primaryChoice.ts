import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";

/**
 * «Sett som primær leverandør» fra varekortet: kalles etter koblingen, med
 * varekortets råvare og leverandør. Gjør ingenting når valget er av eller
 * varekortet ikke er koblet.
 */
export async function savePrimaryChoice(primary: boolean, item: { rm_id: string | null; supplier_id: string }): Promise<boolean> {
  if (!primary || !item.rm_id) return false;
  await setPrimarySupplier(item.rm_id, item.supplier_id);
  return true;
}
