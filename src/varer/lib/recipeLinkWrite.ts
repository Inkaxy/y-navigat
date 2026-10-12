/**
 * Betingede skrivinger mot `product_recipe_links`.
 *
 * Hver oppdatering/sletting bygges fra en frosset, akseptert basis (produkt + kobling +
 * oppskrift + rå `updated_at` + nøyaktige innstillinger) som predikater i ÉN forespørsel —
 * aldri les-så-skriv. Nøyaktig én returnert rad med riktig identitet er eneste suksess;
 * null rader er konflikt (ikke lagret mot gjennomgått versjon), og transporttap er ukjent.
 * Tidsstempelet sendes som den rå strengen fra databasen (mikrosekunder bevares).
 */
import { supabase } from "@/integrations/supabase/client";

export const LINK_SETTING_FIELDS = [
  "sales_unit_basis",
  "units_per_sales_unit",
  "sales_unit_weight_g",
  "units_per_batch_override",
  "sales_unit_confirmed_at",
] as const;
export type LinkSettingField = (typeof LINK_SETTING_FIELDS)[number];
export type LinkSettingValue = string | number | null;
export type LinkSettings = Record<LinkSettingField, LinkSettingValue>;

export const LINK_RETURN_SELECT =
  "id,product_id,recipe_id,updated_at,sales_unit_basis,units_per_sales_unit,sales_unit_weight_g,units_per_batch_override,sales_unit_confirmed_at,sales_unit_confirmed_by";

export interface LinkBase {
  productId: string;
  linkId: string;
  recipeId: string;
  /** Rå databasestreng — aldri gjennom Date. */
  updatedAt: string;
  settings: LinkSettings;
}

export interface ReturnedLinkRow {
  id: string;
  product_id: string;
  recipe_id: string;
  updated_at: string;
  settings: LinkSettings;
  sales_unit_confirmed_by: string | null;
}

export type LinkWriteResult =
  | { kind: "saved"; row: ReturnedLinkRow }
  | { kind: "conflict" }
  | { kind: "error"; code: string | null; message: string }
  | { kind: "unknown" };

export type LinkDeleteResult =
  | { kind: "deleted" }
  | { kind: "conflict" }
  | { kind: "error"; code: string | null; message: string }
  | { kind: "unknown" };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function settingValue(v: unknown): LinkSettingValue | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return undefined;
}

/**
 * Basis fra lest kobling. Mangler identitet, token eller ett av innstillingsfeltene
 * (udefinert ≠ kjent null), finnes ingen basis og ingenting kan skrives.
 */
export function linkBaseFrom(productId: string, link: Record<string, unknown> | null | undefined): LinkBase | null {
  if (!link) return null;
  const id = link.id, pid = link.product_id, rid = link.recipe_id, upd = link.updated_at;
  if (typeof id !== "string" || !id || typeof rid !== "string" || !rid || typeof upd !== "string" || !upd) return null;
  if (typeof pid !== "string" || pid !== productId) return null;
  const settings = {} as LinkSettings;
  for (const f of LINK_SETTING_FIELDS) {
    const v = settingValue(link[f]);
    if (v === undefined) return null;
    settings[f] = v;
  }
  return { productId, linkId: id, recipeId: rid, updatedAt: upd, settings };
}

/** Streng lesing av returnerte rader: nøyaktig én, riktig kobling/produkt/forventet oppskrift. */
export function parseReturnedLink(data: unknown, base: LinkBase, expectRecipeId: string): ReturnedLinkRow | "conflict" | null {
  if (!Array.isArray(data)) return null;
  if (data.length === 0) return "conflict";
  if (data.length !== 1 || !isRecord(data[0])) return null;
  const r = data[0];
  const next = linkBaseFrom(base.productId, r);
  if (!next || next.linkId !== base.linkId || next.recipeId !== expectRecipeId) return null;
  const by = r.sales_unit_confirmed_by;
  if (by !== null && typeof by !== "string") return null;
  return { id: next.linkId, product_id: next.productId, recipe_id: next.recipeId, updated_at: next.updatedAt, settings: next.settings, sales_unit_confirmed_by: by };
}

/** Filtre mot basisen, bygget på et vilkårlig PostgREST-filterobjekt. */
interface Filterable<T> { eq(column: string, value: string | number): T; is(column: string, value: null): T }
export function applyBasePredicates<T extends Filterable<T>>(q: T, base: LinkBase): T {
  let out = q.eq("id", base.linkId).eq("product_id", base.productId).eq("recipe_id", base.recipeId).eq("updated_at", base.updatedAt);
  for (const f of LINK_SETTING_FIELDS) {
    const v = base.settings[f];
    out = v === null ? out.is(f, null) : out.eq(f, v);
  }
  return out;
}

function errorOf(e: { code?: string; message?: string }): LinkWriteResult & LinkDeleteResult {
  // Uten SQL-kode kan vi ikke vite om skrivingen nådde databasen.
  if (!e.code) return { kind: "unknown" };
  return { kind: "error", code: e.code, message: e.message ?? "" };
}

export async function conditionalLinkUpdate(base: LinkBase, payload: Record<string, LinkSettingValue>, expectRecipeId: string): Promise<LinkWriteResult> {
  try {
    const q = applyBasePredicates(supabase.from("product_recipe_links").update(payload as never), base);
    const { data, error } = await q.select(LINK_RETURN_SELECT);
    if (error) return errorOf(error);
    const parsed = parseReturnedLink(data, base, expectRecipeId);
    if (parsed === "conflict") return { kind: "conflict" };
    if (!parsed) return { kind: "unknown" };
    return { kind: "saved", row: parsed };
  } catch {
    return { kind: "unknown" };
  }
}

export async function conditionalLinkDelete(base: LinkBase): Promise<LinkDeleteResult> {
  try {
    const q = applyBasePredicates(supabase.from("product_recipe_links").delete(), base);
    const { data, error } = await q.select("id,product_id,recipe_id");
    if (error) return errorOf(error);
    if (!Array.isArray(data)) return { kind: "unknown" };
    if (data.length === 0) return { kind: "conflict" };
    const r = data[0];
    if (data.length !== 1 || !isRecord(r) || r.id !== base.linkId || r.product_id !== base.productId || r.recipe_id !== base.recipeId) return { kind: "unknown" };
    return { kind: "deleted" };
  } catch {
    return { kind: "unknown" };
  }
}

export function linkWriteMessage(r: Exclude<LinkWriteResult, { kind: "saved" }> | Exclude<LinkDeleteResult, { kind: "deleted" }>): string {
  if (r.kind === "conflict") return "Kunne ikke lagres mot versjonen du så på. Koblingen er endret eller ikke tilgjengelig — last inn på nytt og kontroller.";
  if (r.kind === "unknown") return "Vi vet ikke om endringen ble lagret. Last inn på nytt og kontroller før du prøver igjen.";
  if (r.code === "42501") return "Du mangler skrivetilgang til varer i dette selskapet.";
  if (r.code === "23514") return "Oppskriften kan ikke kobles — det ville gitt en sirkulær referanse.";
  if (r.code === "23505") return "Oppskriften er allerede koblet til denne varen.";
  return "Lagringen ble avvist av databasen.";
}
