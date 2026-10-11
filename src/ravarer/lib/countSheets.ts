import { supabase } from "@/integrations/supabase/client";
import type { CountDraft } from "@/ravarer/lib/countDraft";

/**
 * Serverlagret telleark (`rm_stock_count_sheets`).
 *
 * Telling på nettbrett i lageret tåler ikke at utkastet bare ligger i én
 * nettleser: brettet byttes, økta logges ut, og noen fortsetter fra PC-en.
 * Utkastet lagres derfor også i basen, med samme operasjons-ID som bokføringen
 * bruker. Tabellen rulles ut manuelt, så alle kall her feiler stille hvis den
 * ikke finnes ennå — da fungerer tellingen som før med lokal lagring alene.
 */

export interface CountSheetRow {
  id: string;
  op_id: string;
  status: "draft" | "applying" | "applied" | "discarded";
  note: string | null;
  payload: CountSheetPayload;
  updated_at: string;
}

export interface CountSheetPayload {
  entries: CountDraft["entries"];
  lineNotes: CountDraft["lineNotes"];
  /** Beholdningen som ble frosset da linja ble talt. */
  expected: Record<string, number>;
  note: string;
}

type LooseClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (c: string, v: unknown) => {
        eq: (c: string, v: unknown) => {
          eq: (c: string, v: unknown) => {
            order: (c: string, o: { ascending: boolean }) => {
              limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
            };
          };
          order: (c: string, o: { ascending: boolean }) => {
            limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }>;
          };
        };
      };
    };
    upsert: (
      values: Record<string, unknown>,
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
    update: (values: Record<string, unknown>) => {
      eq: (c: string, v: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

const client = () => supabase as unknown as LooseClient;

/** Sant når feilen bare betyr at tabellen ikke er rullet ut ennå. */
function isMissingTable(message: string): boolean {
  return /does not exist|could not find the table|schema cache/i.test(message);
}

function toPayload(value: unknown): CountSheetPayload {
  const v = (value ?? {}) as Partial<CountSheetPayload>;
  return {
    entries: v.entries && typeof v.entries === "object" ? v.entries : {},
    lineNotes: v.lineNotes && typeof v.lineNotes === "object" ? v.lineNotes : {},
    expected: v.expected && typeof v.expected === "object" ? v.expected : {},
    note: typeof v.note === "string" ? v.note : "",
  };
}

export type OpenSheetResult =
  | { kind: "absent" }
  | { kind: "draft"; row: CountSheetRow }
  /** Kunne ikke lese — aldri det samme som «ingen serverutkast». */
  | { kind: "error" };

/** Henter dagens nyeste åpne telleark. Feil skilles fra fravær. */
export async function fetchOpenCountSheetResult(legalEntityId: string, dateISO: string): Promise<OpenSheetResult> {
  try {
    const { data, error } = await client()
      .from("rm_stock_count_sheets")
      .select("id, op_id, status, note, payload, updated_at")
      .eq("legal_entity_id", legalEntityId)
      .eq("count_date", dateISO)
      // Filtrer på utkast i basen før grensen, så et eldre åpent utkast ikke skjules av bokførte ark.
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (error) return isMissingTable(error.message) ? { kind: "absent" } : { kind: "error" };
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    const open = rows.find(r => r.status === "draft");
    if (!open) return { kind: "absent" };
    return {
      kind: "draft",
      row: {
        id: String(open.id),
        op_id: String(open.op_id),
        status: "draft",
        note: typeof open.note === "string" ? open.note : null,
        payload: toPayload(open.payload),
        updated_at: String(open.updated_at ?? ""),
      },
    };
  } catch (e) {
    console.warn("[varetelling] kunne ikke hente serverutkast", e);
    return { kind: "error" };
  }
}

/** Bakoverkompatibel: åpent telleark eller null (feil gir også null). Bruk `fetchOpenCountSheetResult`. */
export async function fetchOpenCountSheet(legalEntityId: string, dateISO: string): Promise<CountSheetRow | null> {
  const r = await fetchOpenCountSheetResult(legalEntityId, dateISO);
  return r.kind === "draft" ? r.row : null;
}

export type SheetStatusResult =
  | { kind: "found"; status: CountSheetRow["status"] }
  | { kind: "absent" }
  | { kind: "error" };

/**
 * Autoritativ status for ÉN operasjons-ID (brukes før en 23505-konflikt frigjøres).
 * `applied` = den opprinnelige tellingen er bokført; `absent` = ingen bokføring med denne ID-en.
 */
export async function fetchCountSheetStatus(legalEntityId: string, opId: string): Promise<SheetStatusResult> {
  try {
    const { data, error } = await (supabase as unknown as {
      from: (t: string) => { select: (c: string) => { eq: (c: string, v: unknown) => { eq: (c: string, v: unknown) => { limit: (n: number) => Promise<{ data: unknown; error: { message: string } | null }> } } } };
    })
      .from("rm_stock_count_sheets")
      .select("op_id, status")
      .eq("legal_entity_id", legalEntityId)
      .eq("op_id", opId)
      .limit(2);
    if (error) return { kind: "error" };
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { kind: "absent" };
    if (rows.length !== 1 || rows[0].op_id !== opId) return { kind: "error" };
    const st = rows[0].status;
    if (st === "draft" || st === "applying" || st === "applied" || st === "discarded") return { kind: "found", status: st };
    return { kind: "error" };
  } catch (e) {
    console.warn("[varetelling] kunne ikke lese tellearkets status", e);
    return { kind: "error" };
  }
}

/** Lagrer utkastet på serveren. Feiler stille — lokal lagring er fortsatt intakt. */
export async function saveCountSheet(input: {
  legalEntityId: string;
  dateISO: string;
  opId: string;
  payload: CountSheetPayload;
  createdBy: string;
}): Promise<boolean> {
  try {
    const { error } = await client()
      .from("rm_stock_count_sheets")
      .upsert(
        {
          legal_entity_id: input.legalEntityId,
          count_date: input.dateISO,
          op_id: input.opId,
          status: "draft",
          note: input.payload.note,
          payload: input.payload,
          created_by: input.createdBy,
        },
        { onConflict: "op_id" },
      );
    return !error;
  } catch {
    return false;
  }
}

/** Markerer et telleark som forkastet. */
export async function discardCountSheet(opId: string): Promise<void> {
  try {
    await client().from("rm_stock_count_sheets").update({ status: "discarded" }).eq("op_id", opId);
  } catch {
    // Utkastet er uansett borte lokalt.
  }
}
