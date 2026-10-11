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
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return null;
  return v as string[];
};

/** Typet lesing; ugyldig form → null (kalleren viser «ukjent resultat», ikke suksess med 0). */
export function parseApplyResult(data: unknown): ApplyMatvaretabellenResult | null {
  if (!isObj(data)) return null;
  const written = strings(data, "written");
  const skipped = strings(data, "skipped");
  if (!written || !skipped) return null;
  return {
    written, skipped,
    water_content_set: bool(data, "water_content_set") ?? false,
    water_g_skipped: bool(data, "water_g_skipped") ?? false,
    declaration_name_set: str(data, "declaration_name_set"),
    forced: bool(data, "forced") ?? false,
  };
}

/** Én setning om hva som faktisk ble skrevet — aldri ubetinget «næringsverdier hentet». */
export function applyResultMessage(r: ApplyMatvaretabellenResult | null): { tone: "success" | "warning"; text: string } {
  if (!r) return { tone: "warning", text: "Koblet, men serveren returnerte ukjent resultat — kontroller næringsdata på råvaren" };
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
