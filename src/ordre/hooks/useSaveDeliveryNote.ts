import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type EditableLine = {
  /** Eksisterende dn-line id, eller null for nye */
  id: string | null;
  product_id: string;
  product_snapshot: Record<string, unknown>;
  quantity: number;
  sales_unit: string;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  notes: string | null;
  /** Sett ved eksisterende rader; nye rader får null og kobles til DN-ens primær-ordre */
  order_line_id: string | null;
  order_id: string | null;
};

export type SaveDeliveryNoteInput = {
  deliveryNoteId: string;
  lines: EditableLine[];
  /** Eksisterende DN-line-ids som finnes på serveren — vi sletter alt som ikke er med i `lines` */
  originalLineIds: string[];
  /** Order-id å hekte nye linjer på (typisk den eneste/første ordren bak DN-en) */
  fallbackOrderId: string | null;
  notes: string | null;
};

function round(n: number, d = 2) {
  const m = Math.pow(10, d);
  return Math.round(n * m) / m;
}

function computeLine(l: EditableLine) {
  const gross = l.quantity * l.unit_price;
  const subtotal = round(gross * (1 - (l.discount_percent || 0) / 100), 2);
  const vat = round(subtotal * (l.vat_rate / 100), 2);
  const total = round(subtotal + vat, 2);
  return { subtotal, vat, total };
}

export function useSaveDeliveryNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: SaveDeliveryNoteInput) => {
      const { deliveryNoteId, lines, originalLineIds, fallbackOrderId, notes } = input;

      const keptIds = new Set(lines.filter((l) => l.id).map((l) => l.id as string));
      const toDelete = originalLineIds.filter((id) => !keptIds.has(id));

      // Pre-compute totals
      let subtotal_excl_vat = 0;
      let total_vat = 0;
      let total_incl_vat = 0;
      const computed = lines.map((l) => {
        const c = computeLine(l);
        subtotal_excl_vat = round(subtotal_excl_vat + c.subtotal, 2);
        total_vat = round(total_vat + c.vat, 2);
        total_incl_vat = round(total_incl_vat + c.total, 2);
        return c;
      });

      // 1) Slett DN-linjer som er fjernet (og tilhørende order_lines)
      if (toDelete.length > 0) {
        const { data: orphanOL, error: selErr } = await supabase
          .from("delivery_note_lines")
          .select("order_line_id")
          .in("id", toDelete);
        if (selErr) throw selErr;
        const olIds = (orphanOL ?? [])
          .map((r: any) => r.order_line_id)
          .filter((x: string | null): x is string => !!x);
        const { error: dErr } = await supabase
          .from("delivery_note_lines")
          .delete()
          .in("id", toDelete);
        if (dErr) throw dErr;
        if (olIds.length > 0) {
          const { error: dOlErr } = await supabase.from("order_lines").delete().in("id", olIds);
          if (dOlErr) throw dOlErr;
        }
      }

      // 2) Split into existing-update vs new-insert
      const existing: Array<{ l: EditableLine; c: ReturnType<typeof computeLine>; idx: number }> = [];
      const fresh: Array<{ l: EditableLine; c: ReturnType<typeof computeLine>; idx: number }> = [];
      lines.forEach((l, idx) => {
        const entry = { l, c: computed[idx], idx };
        if (l.id) existing.push(entry);
        else fresh.push(entry);
      });

      // Ingen pakkseddellinje uten ordrekobling — slike linjer ville aldri blitt fakturert.
      const orphanNew = fresh.filter((f) => !(f.l.order_id ?? fallbackOrderId));
      if (orphanNew.length > 0) {
        throw new Error(
          "Nye linjer mangler ordrekobling og kan ikke lagres på pakkseddelen. Koble linjen til en ordre først.",
        );
      }

      // 2a) Fase 1 av re-nummerering: flytt eksisterende linjer til midlertidige,
      // høye linjenumre slik at endelige numre ikke kolliderer mot UNIQUE-indeksen.
      for (let i = 0; i < existing.length; i++) {
        const { l } = existing[i];
        const { error } = await supabase
          .from("delivery_note_lines")
          .update({ line_number: 100000 + i } as any)
          .eq("id", l.id as string);
        if (error) throw error;
      }

      // 2b) Fase 2: oppdater alle felter inkl. endelig linjenummer
      for (const { l, c, idx } of existing) {
        const line_number = idx + 1;
        const { error } = await supabase
          .from("delivery_note_lines")
          .update({
            line_number,
            quantity: l.quantity,
            unit_price: l.unit_price,
            discount_percent: l.discount_percent,
            vat_rate: l.vat_rate,
            line_subtotal_excl_vat: c.subtotal,
            line_vat: c.vat,
            line_total_incl_vat: c.total,
            notes: l.notes,
            product_snapshot: l.product_snapshot as any,
            sales_unit: l.sales_unit,
          } as any)
          .eq("id", l.id as string);
        if (error) throw error;

        if (l.order_line_id) {
          const { error: olErr } = await supabase
            .from("order_lines")
            .update({
              quantity: l.quantity,
              unit_price: l.unit_price,
              discount_percent: l.discount_percent,
              vat_rate: l.vat_rate,
              line_subtotal_excl_vat: c.subtotal,
              line_vat: c.vat,
              line_total_incl_vat: c.total,
              notes: l.notes,
              product_snapshot: l.product_snapshot as any,
              sales_unit: l.sales_unit,
            })
            .eq("id", l.order_line_id);
          if (olErr) throw olErr;
        }
      }

      // 3) Nye linjer: batch-insert order_lines per ordre, så batch-insert DN-lines
      if (fresh.length > 0) {
        // Grupper etter target order_id
        const byOrder = new Map<string, typeof fresh>();
        for (const f of fresh) {
          const oid = (f.l.order_id ?? fallbackOrderId) as string;
          if (!byOrder.has(oid)) byOrder.set(oid, []);
          byOrder.get(oid)!.push(f);
        }

        // Hent max line_number for hver ordre
        const orderIdsForInsert = [...byOrder.keys()];
        const nextNoByOrder = new Map<string, number>();
        for (const oid of orderIdsForInsert) {
          const { data, error } = await supabase
            .from("order_lines")
            .select("line_number")
            .eq("order_id", oid)
            .order("line_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          nextNoByOrder.set(oid, ((data as any)?.line_number ?? 0) + 1);
        }

        // Bygg order_lines insert-payloads og hold rekkefølge for å mappe id-er tilbake
        const orderLineInserts: any[] = [];
        const insertRefs: Array<{ entry: typeof fresh[number]; order_id: string }> = [];
        for (const [oid, items] of byOrder) {
          let n = nextNoByOrder.get(oid)!;
          for (const f of items) {
            orderLineInserts.push({
              order_id: oid,
              line_number: n++,
              product_id: f.l.product_id,
              product_snapshot: f.l.product_snapshot as any,
              quantity: f.l.quantity,
              sales_unit: f.l.sales_unit,
              unit_price: f.l.unit_price,
              discount_percent: f.l.discount_percent,
              vat_rate: f.l.vat_rate,
              line_subtotal_excl_vat: f.c.subtotal,
              line_vat: f.c.vat,
              line_total_incl_vat: f.c.total,
              notes: f.l.notes,
            });
            insertRefs.push({ entry: f, order_id: oid });
          }
        }

        let createdOlIds: (string | null)[] = [];
        if (orderLineInserts.length > 0) {
          const { data: newOLs, error: oiErr } = await supabase
            .from("order_lines")
            .insert(orderLineInserts as any)
            .select("id");
          if (oiErr) throw oiErr;
          createdOlIds = ((newOLs ?? []) as any[]).map((r) => r.id);
        }

        const dnInserts: any[] = insertRefs.map((ref, i) => {
          const { entry, order_id } = ref;
          return {
            delivery_note_id: deliveryNoteId,
            line_number: entry.idx + 1,
            product_id: entry.l.product_id,
            product_snapshot: entry.l.product_snapshot as any,
            quantity: entry.l.quantity,
            sales_unit: entry.l.sales_unit,
            unit_price: entry.l.unit_price,
            discount_percent: entry.l.discount_percent,
            vat_rate: entry.l.vat_rate,
            line_subtotal_excl_vat: entry.c.subtotal,
            line_vat: entry.c.vat,
            line_total_incl_vat: entry.c.total,
            notes: entry.l.notes,
            order_line_id: createdOlIds[i] ?? null,
            order_id,
          };
        });

        if (dnInserts.length > 0) {
          const { error: iErr } = await supabase
            .from("delivery_note_lines")
            .insert(dnInserts as any);
          if (iErr) throw iErr;
        }
      }

      // 4) DN-totaler
      const { error: dnUpdErr } = await supabase
        .from("delivery_notes")
        .update({ subtotal_excl_vat, total_vat, total_incl_vat, notes })
        .eq("id", deliveryNoteId);
      if (dnUpdErr) throw dnUpdErr;

      // 5) Oppdater totaler på berørte ordre — parallelt
      const orderIds = Array.from(
        new Set(lines.map((l) => l.order_id ?? fallbackOrderId).filter((x): x is string => !!x))
      );
      await Promise.all(
        orderIds.map(async (oid) => {
          const { data: ols } = await supabase
            .from("order_lines")
            .select("line_subtotal_excl_vat, line_vat, line_total_incl_vat")
            .eq("order_id", oid);
          const sums = (ols ?? []).reduce(
            (acc: any, r: any) => ({
              s: acc.s + Number(r.line_subtotal_excl_vat ?? 0),
              v: acc.v + Number(r.line_vat ?? 0),
              t: acc.t + Number(r.line_total_incl_vat ?? 0),
            }),
            { s: 0, v: 0, t: 0 }
          );
          await supabase
            .from("orders")
            .update({
              subtotal_excl_vat: round(sums.s, 2),
              total_vat: round(sums.v, 2),
              total_incl_vat: round(sums.t, 2),
            })
            .eq("id", oid);
        })
      );

      return { subtotal_excl_vat, total_vat, total_incl_vat };
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["delivery-note-detail", vars.deliveryNoteId] });
      qc.invalidateQueries({ queryKey: ["delivery-notes-list"] });
      qc.invalidateQueries({ queryKey: ["pakkseddel-pdf", vars.deliveryNoteId] });
      qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
}
