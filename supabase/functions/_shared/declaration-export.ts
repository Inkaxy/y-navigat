/**
 * EKSPORT AV DEKLARASJONER
 * ---------------------------------------------------------------------------
 * Ren logikk for `declarations-export`: hvilke varer regnes som «Merking:
 * Godkjent», og er API-nøkkelen gyldig for dette formålet. Samme regel som
 * varelisten bruker (`productLabelingStatus` / `deriveLabelingStatusFromDb`):
 * deklarasjon må finnes, den må ikke være markert for ny gjennomgang, og en
 * beregningsrad som finnes må ikke være utdatert.
 */

export const DECLARATIONS_SCOPE = "declarations";

export interface ExportCandidate {
  /** Effektiv deklarasjonstekst på produktet. */
  ingredientText: string | null | undefined;
  /** Produktet er flagget for ny gjennomgang. */
  needsReview: boolean | null | undefined;
  /** Beregningsraden for oppskriften — null når produktet ikke er koblet. */
  calculated: { computed_at: string | null; is_stale: boolean | null } | null;
}

export type ExportRejection = "mangler_deklarasjon" | "krever_ny_gjennomgang" | "utdatert";

/** Null når varen kan eksporteres, ellers årsaken til at den holdes tilbake. */
export function exportRejection(row: ExportCandidate): ExportRejection | null {
  if (!row.ingredientText || !row.ingredientText.trim()) return "mangler_deklarasjon";
  if (row.needsReview === true) return "krever_ny_gjennomgang";
  if (row.calculated) {
    if (!row.calculated.computed_at) return "utdatert";
    if (row.calculated.is_stale === true) return "utdatert";
  }
  return null;
}

export function isApprovedForExport(row: ExportCandidate): boolean {
  return exportRejection(row) === null;
}

export interface ApiKeyRow {
  id: string;
  legal_entity_id: string;
  revoked_at: string | null;
  scopes: string[] | null;
}

export type KeyCheck =
  | { ok: true; keyId: string; legalEntityId: string }
  | { ok: false; code: "unauthorized" | "revoked" | "forbidden_scope" };

/** Nøkkelen må finnes, ikke være tilbakekalt, og ha rettigheten «declarations». */
export function checkApiKey(row: ApiKeyRow | null | undefined): KeyCheck {
  if (!row) return { ok: false, code: "unauthorized" };
  if (row.revoked_at) return { ok: false, code: "revoked" };
  if (!(row.scopes ?? []).includes(DECLARATIONS_SCOPE)) return { ok: false, code: "forbidden_scope" };
  return { ok: true, keyId: row.id, legalEntityId: row.legal_entity_id };
}

/** Stabil, sorteringsuavhengig nøkkel for innholdet — mottaker kan cache på denne. */
export async function contentHash(value: unknown): Promise<string> {
  const json = JSON.stringify(value, Object.keys(flatten(value)).sort());
  const buf = new TextEncoder().encode(json);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function flatten(value: unknown): Record<string, true> {
  const out: Record<string, true> = {};
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
      out[k] = true;
      walk(child);
    }
  };
  walk(value);
  return out;
}
