import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PakkseddelPDFLine = {
  id: string;
  line_number: number;
  product_number: string;
  product_name: string;
  quantity: number;
  sales_unit: string;
};

export type PakkseddelPDFData = {
  id: string;
  display_number: string;
  delivery_date: string;
  route_label: string | null;
  notes: string | null;
  customer: {
    name: string;
    customer_number: string;
  };
  delivery_address: {
    line1: string;
    line2: string;
    postal_code: string;
    city: string;
  };
  legal_entity: {
    legal_name: string;
    org_number: string;
    invoice_address_line1: string | null;
    invoice_postal_code: string | null;
    invoice_city: string | null;
  };
  order_numbers: string[];
  lines: PakkseddelPDFLine[];
};

export function usePakkseddelPDF(id: string | undefined) {
  return useQuery({
    enabled: !!id,
    queryKey: ["pakkseddel-pdf", id],
    queryFn: async (): Promise<PakkseddelPDFData | null> => {
      if (!id) return null;

      const { data: note, error: noteErr } = await supabase
        .from("delivery_notes")
        .select(
          "id, display_number, delivery_date, route_label, notes, legal_entity_id, customer_snapshot, delivery_address_snapshot"
        )
        .eq("id", id)
        .maybeSingle();
      if (noteErr) throw noteErr;
      if (!note) return null;

      const [{ data: lines, error: linesErr }, { data: legal, error: legalErr }, { data: linkLines, error: linkErr }] =
        await Promise.all([
          supabase
            .from("delivery_note_lines")
            .select("id, line_number, product_snapshot, quantity, sales_unit")
            .eq("delivery_note_id", id)
            .order("line_number", { ascending: true }),
          supabase
            .from("legal_entities")
            .select("legal_name, org_number, invoice_address_line1, invoice_postal_code, invoice_city")
            .eq("id", (note as any).legal_entity_id)
            .maybeSingle(),
          supabase
            .from("delivery_note_lines")
            .select("order_id, orders(order_number)")
            .eq("delivery_note_id", id),
        ]);
      if (linesErr) throw linesErr;
      if (legalErr) throw legalErr;
      if (linkErr) throw linkErr;

      const orderNumbers = Array.from(
        new Set(
          ((linkLines ?? []) as any[])
            .map((r) => r?.orders?.order_number)
            .filter((n): n is string => !!n)
        )
      ).sort();

      const cs = ((note as any).customer_snapshot ?? {}) as Record<string, unknown>;
      const addr = ((note as any).delivery_address_snapshot ?? {}) as Record<string, unknown>;

      return {
        id: (note as any).id,
        display_number: String((note as any).display_number ?? ""),
        delivery_date: (note as any).delivery_date,
        route_label: (note as any).route_label,
        notes: (note as any).notes,
        customer: {
          name: (cs["display_name"] as string) ?? (cs["name"] as string) ?? "—",
          customer_number: (cs["customer_number"] as string) ?? "—",
        },
        delivery_address: {
          line1:
            (addr["line1"] as string) ??
            (addr["address_line_1"] as string) ??
            (addr["address_line1"] as string) ??
            "",
          line2:
            (addr["line2"] as string) ??
            (addr["address_line_2"] as string) ??
            (addr["address_line2"] as string) ??
            "",
          postal_code: (addr["postal_code"] as string) ?? "",
          city: (addr["city"] as string) ?? "",
        },
        legal_entity: {
          legal_name: (legal as any)?.legal_name ?? "",
          org_number: (legal as any)?.org_number ?? "",
          invoice_address_line1: (legal as any)?.invoice_address_line1 ?? null,
          invoice_postal_code: (legal as any)?.invoice_postal_code ?? null,
          invoice_city: (legal as any)?.invoice_city ?? null,
        },
        order_numbers: orderNumbers,
        lines: ((lines ?? []) as any[]).map((l) => {
          const ps = (l.product_snapshot ?? {}) as Record<string, unknown>;
          return {
            id: l.id,
            line_number: Number(l.line_number ?? 0),
            product_number:
              (ps["display_number"] as string | number | undefined)?.toString() ??
              (ps["product_number"] as string | number | undefined)?.toString() ??
              "—",
            product_name:
              (ps["display_name"] as string) ?? (ps["name"] as string) ?? "—",
            quantity: Number(l.quantity ?? 0),
            sales_unit: l.sales_unit ?? "",
          };
        }),
      };
    },
    staleTime: 10_000,
  });
}
