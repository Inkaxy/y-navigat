import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/supabasePaging";
import { osloDateISOPlusDays } from "@/lib/osloDate";
import { useRavarer } from "@/ravarer/context/RavarerContext";

export type MovementStatus = { status: "ok"; types: string[]; quantity: number } | { status: "none" } | { status: "unknown" };

export interface MissingQuantityLine {
  id: string;
  invoice_id: string;
  invoice_number: string;
  invoice_date: string;
  invoice_status: string;
  description: string | null;
  raw_material_name: string;
  quantity: number | null;
  unit: string | null;
  movement: MovementStatus;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/**
 * Diagnostikk: lagerførte videresalgsvarer, fakturadato siste 90 dager, samme selskap,
 * `base_quantity IS NULL`. Hele utvalget hentes sidevis. Bevegelse leses separat via
 * `source_table='invoice_lines'` + `source_id=linje`; feil gir «ukjent», aldri «ingen».
 * Ingen skriving, ingen kø-/tellerendring.
 */
export async function fetchMissingQuantityLines(legalEntityId: string): Promise<MissingQuantityLine[]> {
  type Rm = { id: string; name: string };
  const rms = await fetchAllRows<Rm>((from, to) =>
    supabase
      .from("raw_materials")
      .select("id, name")
      .eq("legal_entity_id", legalEntityId)
      .eq("is_resale_item", true)
      .eq("stock_tracking", true)
      .order("id")
      .range(from, to) as PageResult<Rm>,
  );
  const nameById = new Map(rms.map(r => [r.id, r.name]));
  const ids = Array.from(nameById.keys());
  if (ids.length === 0) return [];
  const since = osloDateISOPlusDays(-90);
  type Line = {
    id: string; invoice_id: string; description: string | null; quantity: number | null; unit: string | null; raw_material_id: string;
    invoice: { invoice_number: string; invoice_date: string; status: string } | null;
  };
  const lines: Line[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const part = await fetchAllRows<Line>((from, to) =>
      supabase
        .from("invoice_lines")
        .select("id, invoice_id, description, quantity, unit, raw_material_id, invoice:invoices!inner(invoice_number, invoice_date, status, legal_entity_id)")
        .in("raw_material_id", chunk)
        .is("base_quantity", null)
        .gte("invoice.invoice_date", since)
        .eq("invoice.legal_entity_id", legalEntityId)
        .order("id")
        .range(from, to) as PageResult<Line>,
    );
    lines.push(...part);
  }
  let movements: Map<string, { types: string[]; quantity: number }> | null = new Map();
  try {
    const lineIds = lines.map(l => l.id);
    for (let i = 0; i < lineIds.length; i += 300) {
      type M = { source_id: string | null; movement_type: string; quantity_base: number | null };
      const rows = await fetchAllRows<M>((from, to) =>
        supabase
          .from("stock_movements")
          .select("source_id, movement_type, quantity_base")
          .eq("source_table", "invoice_lines")
          .in("source_id", lineIds.slice(i, i + 300))
          .order("source_id")
          .range(from, to) as PageResult<M>,
      );
      for (const m of rows) {
        if (!m.source_id) continue;
        const cur = movements.get(m.source_id) ?? { types: [], quantity: 0 };
        if (!cur.types.includes(m.movement_type)) cur.types.push(m.movement_type);
        cur.quantity += Number(m.quantity_base) || 0;
        movements.set(m.source_id, cur);
      }
    }
  } catch (e) {
    console.warn("[mengde-diagnostikk] bevegelsesoppslag feilet", e);
    movements = null;
  }
  return lines
    .map(l => {
      const m = movements?.get(l.id);
      const movement: MovementStatus = movements == null ? { status: "unknown" } : m ? { status: "ok", ...m } : { status: "none" };
      return {
        id: l.id,
        invoice_id: l.invoice_id,
        invoice_number: l.invoice?.invoice_number ?? "",
        invoice_date: l.invoice?.invoice_date ?? "",
        invoice_status: l.invoice?.status ?? "",
        description: l.description,
        raw_material_name: nameById.get(l.raw_material_id) ?? "Ukjent vare",
        quantity: l.quantity == null ? null : Number(l.quantity),
        unit: l.unit,
        movement,
      };
    })
    .sort((a, b) => b.invoice_date.localeCompare(a.invoice_date) || a.id.localeCompare(b.id));
}

export function useMissingQuantityDiagnostic() {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["priskontroll-mengde-diagnostikk", legalEntityId, "mengde"],
    enabled: !!legalEntityId,
    queryFn: () => fetchMissingQuantityLines(legalEntityId as string),
  });
}
