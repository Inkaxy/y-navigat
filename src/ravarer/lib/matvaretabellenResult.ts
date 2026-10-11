import { isObj, num, str, bool, type Obj } from "@/fakturaer/lib/parseRpcJson";

/** Svar fra `rm_apply_matvaretabellen` (jsonb). */
export interface ApplyMatvaretabellenResult {
  written: string[];
  skipped: string[];
  water_content_set: boolean;
  water_g_skipped: boolean;
  declaration_name_set: string | null;
  forced: boolean;
}

const strings = (o: Obj, k: string): string[] | null => {
  const v = o[k];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  return v as string[];
};

export interface ApplyRequest { rawMaterialId: string; foodId: string; force: boolean }

/**
 * Streng lesing av `rm_apply_matvaretabellen(uuid,text,boolean)`: alle felt må finnes med riktig type,
 * og svaret må gjelde nøyaktig forespurt råvare/matvare/force. Alt annet → null = ukjent utfall
 * (aldri «koblet», aldri «0 felt skrevet»).
 */
export function parseApplyResult(data: unknown, req: ApplyRequest): ApplyMatvaretabellenResult | null {
  if (!isObj(data)) return null;
  if (data.raw_material_id !== req.rawMaterialId || data.food_id !== req.foodId || data.forced !== req.force) return null;
  const written = strings(data, "written");
  const skipped = strings(data, "skipped");
  if (!written || !skipped) return null;
  const water = bool(data, "water_content_set");
  const waterSkip = bool(data, "water_g_skipped");
  if (water == null || waterSkip == null) return null;
  const decl = data.declaration_name_set;
  if (decl != null && typeof decl !== "string") return null;
  return { written, skipped, water_content_set: water, water_g_skipped: waterSkip, declaration_name_set: decl ?? null, forced: req.force };
}

/** Én setning om hva som faktisk ble skrevet — aldri ubetinget «næringsverdier hentet». */
export function applyResultMessage(r: ApplyMatvaretabellenResult | null): { tone: "success" | "warning"; text: string } {
  if (!r) return { tone: "warning", text: "Utfallet er ukjent — kontroller næringsdata på råvaren før du prøver igjen" };
  const parts: string[] = [];
  parts.push(r.written.length > 0 ? `${r.written.length} felt hentet fra Matvaretabellen${r.forced ? " (overskrevet)" : ""}` : "Ingen felt ble skrevet");
  if (r.skipped.length > 0) parts.push(`${r.skipped.length} beholdt fra datablad/manuell kilde`);
  if (r.declaration_name_set) parts.push(`deklarasjonsnavn satt til «${r.declaration_name_set}»`);
  return { tone: r.written.length > 0 && r.skipped.length === 0 ? "success" : "warning", text: parts.join(" · ") };
}

export interface SyncResult { foods: number; upserted: number; groups: number }

/** Synk er bare vellykket når serveren sier `ok: true` med tall; ellers kastes reell feil. */
export function parseSyncResult(data: unknown): SyncResult {
  if (!isObj(data)) throw new Error("Ukjent svar fra synkroniseringen");
  if (data.ok !== true) throw new Error(str(data, "error") ?? str(data, "message") ?? "Synkroniseringen feilet");
  const upserted = num(data, "upserted");
  if (upserted == null) throw new Error("Synkroniseringen returnerte ikke antall lagrede matvarer");
  return { upserted, foods: num(data, "foods") ?? upserted, groups: num(data, "groups") ?? 0 };
}
