import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { pendingDelete, pendingInsert, pendingPatch, pendingSelect, useCapability } from "@/lib/pendingRpc";
import type { MarkupChange, MarkupRow, ResaleKind, ResaleLink, ResaleMaterial } from "@/varer/lib/handelsvarer";

export const HANDELSVARER_KEY = (le: string | null) => ["varer", "handelsvarer", le] as const;
export const RESALE_MARKUP_KEY = (le: string | null) => ["varer", "handelsvarer", "pasla", le] as const;

export interface HandelsvareRow {
  material: ResaleMaterial;
  link: ResaleLink | null;
  /** Antall varer koblet til råvaren (mer enn én = flere salgsenheter). */
  linkCount: number;
}

type RmRow = {
  id: string; name: string; item_type: string | null; base_unit: string | null;
  current_cost_price: number | null; cost_basis_status: string | null;
  supplier: { name: string | null } | null;
};
type LinkRow = {
  raw_material_id: string; product_id: string; base_units_per_sold_unit: number | null; is_primary: boolean | null;
  product: { display_number: number | null; display_name: string; mva_rate: number | null; status: string | null } | null;
};

/** Handelsvarer = aktive råvarer med varetype videresalg eller emballasje, med eventuell kobling til en vare. */
export function useHandelsvarer(legalEntityId: string | null) {
  return useQuery({
    queryKey: HANDELSVARER_KEY(legalEntityId),
    enabled: !!legalEntityId,
    queryFn: async (): Promise<HandelsvareRow[]> => {
      const rms = await fetchAllRows<RmRow>((from, to) =>
        supabase.from("raw_materials")
          .select("id, name, item_type, base_unit, current_cost_price, cost_basis_status, supplier:suppliers!raw_materials_primary_supplier_id_fkey(name)")
          .eq("legal_entity_id", legalEntityId!).eq("is_active", true).in("item_type", ["videresalg", "emballasje"])
          .order("name").order("id").range(from, to));
      const ids = rms.map((r) => r.id);
      const links: LinkRow[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const { data, error } = await supabase.from("raw_material_products")
          .select("raw_material_id, product_id, base_units_per_sold_unit, is_primary, product:products!raw_material_products_product_id_fkey(display_number, display_name, mva_rate, status)")
          .in("raw_material_id", chunk);
        if (error) throw error;
        links.push(...((data ?? []) as LinkRow[]));
      }
      const byRm = new Map<string, LinkRow[]>();
      for (const l of links) {
        if (!l.product || l.product.status === "discontinued") continue;
        const arr = byRm.get(l.raw_material_id) ?? [];
        arr.push(l);
        byRm.set(l.raw_material_id, arr);
      }
      return rms.map((r) => {
        const ls = (byRm.get(r.id) ?? []).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
        const l = ls[0];
        return {
          material: {
            id: r.id, name: r.name, itemType: (r.item_type === "emballasje" ? "emballasje" : "videresalg") as ResaleKind,
            baseUnit: r.base_unit, costPrice: r.current_cost_price == null ? null : Number(r.current_cost_price),
            costStatus: r.cost_basis_status, supplierName: r.supplier?.name ?? null,
          },
          link: l && l.product ? {
            productId: l.product_id, productNumber: l.product.display_number, productName: l.product.display_name,
            baseUnitsPerSoldUnit: l.base_units_per_sold_unit == null ? null : Number(l.base_units_per_sold_unit),
            mvaRate: l.product.mva_rate == null ? null : Number(l.product.mva_rate),
          } : null,
          linkCount: ls.length,
        };
      });
    },
  });
}

export interface StoredMarkup extends MarkupRow { id: string }

/**
 * Lagrede påslag (PENDING 20261118_handelsvarer). `cap=false` = ikke kjørt ennå: standard 1,2 brukes,
 * og endringer gjelder bare i vinduet. `cap=null` = ukjent (vises ikke som lagret).
 */
export function useResaleMarkups(legalEntityId: string | null) {
  const cap = useCapability("varer_cap_handelsvarer_v1");
  const q = useQuery({
    queryKey: RESALE_MARKUP_KEY(legalEntityId),
    enabled: cap === true && !!legalEntityId,
    queryFn: async (): Promise<{ defaultFactor: number | null; rows: StoredMarkup[] }> => {
      const le = encodeURIComponent(legalEntityId!);
      const [rowsR, ecsR] = await Promise.all([
        pendingSelect("resale_markup_settings", `select=id,price_list_id,raw_material_id,factor,blocked&legal_entity_id=eq.${le}&limit=5000`),
        pendingSelect("entity_calc_settings", `select=resale_default_factor&legal_entity_id=eq.${le}`),
      ]);
      if (rowsR.kind !== "ok" || ecsR.kind !== "ok") throw new Error("Kunne ikke lese påslagene.");
      const rows = Array.isArray(rowsR.data) ? rowsR.data : [];
      const ecs = Array.isArray(ecsR.data) ? ecsR.data[0] : null;
      const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
      return {
        defaultFactor: ecs && typeof ecs === "object" ? num((ecs as Record<string, unknown>).resale_default_factor) : null,
        rows: rows.flatMap((r): StoredMarkup[] => {
          if (!r || typeof r !== "object") return [];
          const o = r as Record<string, unknown>;
          if (typeof o.id !== "string") return [];
          return [{
            id: o.id,
            priceListId: typeof o.price_list_id === "string" ? o.price_list_id : null,
            rawMaterialId: typeof o.raw_material_id === "string" ? o.raw_material_id : null,
            factor: num(o.factor), blocked: o.blocked === true,
          }];
        }),
      };
    },
  });
  return { cap, ...q };
}

/** Lagrer en samlet påslagskladd. Kaster ved første feil; allerede lagrede rader står (leses på nytt). */
export function useSaveResaleMarkups(legalEntityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ changes, existing, userId }: { changes: MarkupChange[]; existing: StoredMarkup[]; userId: string | null }) => {
      if (!legalEntityId) throw new Error("Fant ikke selskapet.");
      let saved = 0;
      for (const c of changes) {
        const found = existing.find((e) => c.kind === "list"
          ? e.priceListId === c.priceListId && e.rawMaterialId == null
          : e.priceListId === c.priceListId && e.rawMaterialId === c.rawMaterialId);
        const empty = c.factor == null && (c.kind === "list" || !c.blocked);
        const body: Record<string, unknown> = c.kind === "list"
          ? { factor: c.factor, updated_by: userId }
          : { factor: c.factor, blocked: c.blocked, updated_by: userId };
        const r = found
          ? empty ? await pendingDelete("resale_markup_settings", `id=eq.${found.id}`)
                  : await pendingPatch("resale_markup_settings", `id=eq.${found.id}`, body)
          : empty ? { kind: "ok" as const, data: [] }
                  : await pendingInsert("resale_markup_settings", {
                      ...body, legal_entity_id: legalEntityId, price_list_id: c.priceListId,
                      raw_material_id: c.kind === "cell" ? c.rawMaterialId : null,
                    });
        if (r.kind !== "ok") throw new Error(r.kind === "denied" ? "Du har ikke skrivetilgang til påslag." : "Påslaget ble ikke lagret. Last inn på nytt og kontroller.");
        saved++;
      }
      return saved;
    },
    onSettled: () => { void qc.invalidateQueries({ queryKey: RESALE_MARKUP_KEY(legalEntityId) }); },
  });
}

/** Kobler en handelsvare til en vare i varelisten (eksisterende tabell raw_material_products). */
export function useLinkResaleProduct(legalEntityId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { rawMaterialId: string; productId: string; baseUnitsPerSoldUnit: number; userId: string | null }) => {
      const { data, error } = await supabase.from("raw_material_products").insert({
        raw_material_id: p.rawMaterialId, product_id: p.productId, base_units_per_sold_unit: p.baseUnitsPerSoldUnit,
        is_primary: true, created_by: p.userId,
      }).select("id");
      if (error) throw error;
      if (!data || data.length !== 1) throw new Error("Koblingen ble ikke bekreftet. Last inn på nytt og kontroller.");
      return data[0].id;
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: HANDELSVARER_KEY(legalEntityId) });
      void qc.invalidateQueries({ queryKey: ["product-margins"] });
    },
  });
}
