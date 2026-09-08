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

/** Henter et åpent telleark for dagen, eller null. */
export async function fetchOpenCountSheet(
  legalEntityId: string,
  dateISO: string,
): Promise<CountSheetRow | null> {
  try {
    const { data, error } = await client()
      .from("rm_stock_count_sheets")
      .select("id, op_id, status, note, payload, updated_at")
      .eq("legal_entity_id", legalEntityId)
      .eq("count_date", dateISO)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (error) {
      if (isMissingTable(error.message)) return null;
      throw new Error(error.message);
    }
    const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    const open = rows.find(r => r.status === "draft");
    if (!open) return null;
    return {
      id: String(open.id),
      op_id: String(open.op_id),
      status: "draft",
      note: typeof open.note === "string" ? open.note : null,
      payload: toPayload(open.payload),
      updated_at: String(open.updated_at ?? ""),
    };
  } catch (e) {
    // Et utilgjengelig telleark skal aldri hindre at tellesiden åpner.
    if (e instanceof Error && isMissingTable(e.message)) return null;
    return null;
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
