import type { QueryClient } from "@tanstack/react-query";
import { setPrimarySupplier } from "@/ravarer/lib/supplierLinkRpc";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";

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

/**
 * Hele kjeden varekortet kjører: lagre primærvalget og oppdater råvaren og
 * varekortlistene. Kaster med norsk melding ved feil (ingen invalidering da).
 */
export async function savePrimaryAndRefresh(qc: QueryClient, primary: boolean, item: { rm_id: string | null; supplier_id: string }): Promise<boolean> {
  const saved = await savePrimaryChoice(primary, item);
  if (!saved || !item.rm_id) return false;
  invalidateRawMaterial(qc, item.rm_id);
  void qc.invalidateQueries({ queryKey: ["supplier-items"] });
  return true;
}
