import type { Json } from "@/integrations/supabase/types";
import { bool, isObj, num, str } from "@/fakturaer/lib/parseRpcJson";
import { supabase } from "@/integrations/supabase/client";

/** Svar fra `rm_set_primary_supplier`. */
export interface SetPrimarySupplierResult {
  ok: true;
  previous_supplier_id: string | null;
  supplier_id: string | null;
  link_created: boolean;
}

export function parseSetPrimarySupplier(data: Json | null | undefined): SetPrimarySupplierResult {
  if (!isObj(data) || data.ok !== true) throw new Error("Kunne ikke sette primærleverandør");
  return {
    ok: true,
    previous_supplier_id: str(data, "previous_supplier_id"),
    supplier_id: str(data, "supplier_id"),
    link_created: bool(data, "link_created") ?? false,
  };
}

export type MoveLegacyReason = "ingen_eldre_avtalepris" | "har_avtalepris";

export type MoveLegacyAgreedPriceResult =
  | { ok: true; raw_material_supplier_id: string | null; agreed_price_per_base_unit: number | null; link_created: boolean }
  | { ok: false; reason: MoveLegacyReason | "ukjent"; agreed_price_per_base_unit: number | null };

export function parseMoveLegacyAgreedPrice(data: Json | null | undefined): MoveLegacyAgreedPriceResult {
  if (!isObj(data)) throw new Error("Uventet svar ved flytting av avtalepris");
  if (data.ok === true) {
    return {
      ok: true,
      raw_material_supplier_id: str(data, "raw_material_supplier_id"),
      agreed_price_per_base_unit: num(data, "agreed_price_per_base_unit"),
      link_created: bool(data, "link_created") ?? false,
    };
  }
  const r = str(data, "reason");
  return {
    ok: false,
    reason: r === "ingen_eldre_avtalepris" || r === "har_avtalepris" ? r : "ukjent",
    agreed_price_per_base_unit: num(data, "agreed_price_per_base_unit"),
  };
}

const fmtKr = (v: number) => v.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Norsk tekst for et avvist flytteforsøk. */
export function moveLegacyReasonText(r: Extract<MoveLegacyAgreedPriceResult, { ok: false }>): string {
  if (r.reason === "ingen_eldre_avtalepris") return "Råvaren har ingen eldre avtalepris";
  if (r.reason === "har_avtalepris") {
    const p = r.agreed_price_per_base_unit != null ? ` (${fmtKr(r.agreed_price_per_base_unit)} kr/enhet)` : "";
    return `Leverandøren har allerede en avtalepris${p} — rett den i leverandørkoblingen`;
  }
  return "Avtaleprisen kunne ikke flyttes";
}

/** Rematch-del av `rm_change_supplier_link`-svaret (brukes i fase 3). */
export interface ChangeLinkRematch { ok: boolean; queued: number; already_queued: number; pending: number }

export function parseChangeLinkRematch(data: Json | null | undefined): ChangeLinkRematch | null {
  if (!isObj(data) || !isObj(data.rematch)) return null;
  const m = data.rematch;
  return {
    ok: bool(m, "ok") ?? false,
    queued: num(m, "queued") ?? 0,
    already_queued: num(m, "already_queued") ?? 0,
    pending: num(m, "pending") ?? 0,
  };
}

/**
 * Eneste skrivevei for primærleverandør. `null` fjerner primær.
 * Generert type-signatur mangler `null`-varianten; vi omtyper RPC-kallet
 * (ikke `as any`/`as unknown as`) så kontrakten mot serveren bevares.
 */
type SetPrimaryArgs = { p_raw_material_id: string; p_supplier_id: string | null };
type RpcSetPrimary = (fn: "rm_set_primary_supplier", args: SetPrimaryArgs) => ReturnType<typeof supabase.rpc<"rm_set_primary_supplier">>;

export async function setPrimarySupplier(rawMaterialId: string, supplierId: string | null): Promise<SetPrimarySupplierResult> {
  const rpc = supabase.rpc as unknown as RpcSetPrimary;
  const { data, error } = await rpc("rm_set_primary_supplier", {
    p_raw_material_id: rawMaterialId,
    p_supplier_id: supplierId,
  });
  if (error) throw new Error("Kunne ikke sette primærleverandør");
  return parseSetPrimarySupplier(data);
}
