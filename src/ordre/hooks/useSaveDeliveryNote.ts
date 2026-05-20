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

      // 1) Slett DN-linjer som er fjernet (og tilhørende order_lines for kobling)
      if (toDelete.length > 0) {
        const { data: orphanOL } = await supabase
          .from("delivery_note_lines")
          .select("order_line_id")
          .in("id", toDelete);
        const olIds = (orphanOL ?? [])
          .map((r: any) => r.order_line_id)
          .filter((x: string | null): x is string => !!x);

        const { error: dErr } = await supabase
          .from("delivery_note_lines")
          .delete()
          .in("id", toDelete);
        if (dErr) throw dErr;

        if (olIds.length > 0) {
          await supabase.from("order_lines").delete().in("id", olIds);
        }
      }

      let subtotal_excl_vat = 0;
      let total_vat = 0;
      let total_incl_vat = 0;

      // 2) Upsert hver linje, og skriv tilbake til order_lines
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        const line_number = i + 1;
        const c = computeLine(l);
        subtotal_excl_vat = round(subtotal_excl_vat + c.subtotal, 2);
        total_vat = round(total_vat + c.vat, 2);
        total_incl_vat = round(total_incl_vat + c.total, 2);

        // a) Skriv tilbake til underliggende order_line (eller opprett en ny)
        let order_line_id = l.order_line_id;
        let order_id = l.order_id ?? fallbackOrderId;

        if (order_line_id) {
          const { error: ouErr } = await supabase
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
              product_snapshot: l.product_snapshot,
              sales_unit: l.sales_unit,
            })
            .eq("id", order_line_id);
          if (ouErr) throw ouErr;
        } else if (order_id) {
          // Ny linje — opprett tilhørende order_line for fakturagrunnlag
          const { data: maxRow } = await supabase
            .from("order_lines")
            .select("line_number")
            .eq("order_id", order_id)
            .order("line_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          const nextLineNo = ((maxRow as any)?.line_number ?? 0) + 1;
          const { data: newOL, error: oiErr } = await supabase
            .from("order_lines")
            .insert({
              order_id,
              line_number: nextLineNo,
              product_id: l.product_id,
              product_snapshot: l.product_snapshot as any,
              quantity: l.quantity,
              sales_unit: l.sales_unit,
              unit_price: l.unit_price,
              discount_percent: l.discount_percent,
              vat_rate: l.vat_rate,
              line_subtotal_excl_vat: c.subtotal,
              line_vat: c.vat,
              line_total_incl_vat: c.total,
              notes: l.notes,
            } as any)
            .select("id")
            .single();
          if (oiErr) throw oiErr;
          order_line_id = (newOL as any).id;
        }

        // b) Upsert DN-line
        if (l.id) {
          const { error: uErr } = await supabase
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
              product_snapshot: l.product_snapshot,
              sales_unit: l.sales_unit,
            })
            .eq("id", l.id);
          if (uErr) throw uErr;
        } else {
          const { error: iErr } = await supabase
            .from("delivery_note_lines")
            .insert({
              delivery_note_id: deliveryNoteId,
              line_number,
              product_id: l.product_id,
              product_snapshot: l.product_snapshot,
              quantity: l.quantity,
              sales_unit: l.sales_unit,
              unit_price: l.unit_price,
              discount_percent: l.discount_percent,
              vat_rate: l.vat_rate,
              line_subtotal_excl_vat: c.subtotal,
              line_vat: c.vat,
              line_total_incl_vat: c.total,
              notes: l.notes,
              order_line_id,
              order_id,
            });
          if (iErr) throw iErr;
        }
      }

      // 3) Oppdater totaler + notes på DN
      const { error: dnErr } = await supabase
        .from("delivery_notes")
        .update({
          subtotal_excl_vat,
          total_vat,
          total_incl_vat,
          notes,
        })
        .eq("id", deliveryNoteId);
      if (dnErr) throw dnErr;

      // 4) Oppdater også totaler på berørte ordre
      const orderIds = Array.from(
        new Set(lines.map((l) => l.order_id ?? fallbackOrderId).filter((x): x is string => !!x))
      );
      for (const oid of orderIds) {
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
      }

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
