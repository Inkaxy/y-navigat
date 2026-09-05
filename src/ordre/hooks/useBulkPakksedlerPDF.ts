import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { NB_LEGAL_ENTITY_ID } from "@/ordre/lib/constants";
import type { PakkseddelPDFData, PakkseddelPDFLine } from "@/ordre/hooks/usePakkseddelPDF";
import { fetchLabelNumbersByUnit, resolveLabelNumber } from "@/ordre/lib/labelNumber";

export type BulkTourGroup = {
  /** delivery_tour_id, eller null for "Uten tur" */
  tour_id: string | null;
  tour_display_name: string;
  tour_number: number | null;
  notes: PakkseddelPDFData[];
};

export type BulkPakksedlerPDFData = {
  delivery_date: string;
  scope_label: string; // "Alle turer" | "Tur 1 Morgen" | "Uten tur" | "Valgte"
  groups: BulkTourGroup[];
  total_notes: number;
  legal_entity: PakkseddelPDFData["legal_entity"];
};

export type BulkScope =
  | { kind: "date_tour"; date: string; tourId: string /* "all" | uuid | NULL_TOUR_KEY */ }
  | { kind: "ids"; date: string; ids: string[] };

const NULL_TOUR_KEY = "__null__";

type CakeInfo = { label_number: string | null; url: string | null };

function mapNote(
  note: any,
  lines: any[],
  orderNumbers: string[],
  legal: PakkseddelPDFData["legal_entity"],
  cakeByLine: Record<string, CakeInfo>,
): PakkseddelPDFData {
  const cs = (note.customer_snapshot ?? {}) as Record<string, unknown>;
  const addr = (note.delivery_address_snapshot ?? {}) as Record<string, unknown>;

  const mappedLines: PakkseddelPDFLine[] = lines.map((l) => {
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
      cake_label_number: l.order_line_id ? (cakeByLine[l.order_line_id]?.label_number ?? null) : null,
      cake_thumb_url: l.order_line_id ? (cakeByLine[l.order_line_id]?.url ?? null) : null,
    };
  });

  return {
    id: note.id,
    display_number: String(note.display_number ?? ""),
    delivery_date: note.delivery_date,
    route_label: note.route_label,
    notes: note.notes,
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
    legal_entity: legal,
    order_numbers: orderNumbers,
    lines: mappedLines,
  };
}

export function useBulkPakksedlerPDF(scope: BulkScope | null) {
  return useQuery({
    enabled: !!scope,
    queryKey: ["bulk-pakksedler-pdf", scope],
    queryFn: async (): Promise<BulkPakksedlerPDFData | null> => {
      if (!scope) return null;

      // 1) Hent legal entity (samme for alle på NB)
      const { data: legalRow, error: legalErr } = await supabase
        .from("legal_entities")
        .select("legal_name, org_number, invoice_address_line1, invoice_postal_code, invoice_city")
        .eq("id", NB_LEGAL_ENTITY_ID)
        .maybeSingle();
      if (legalErr) throw legalErr;
      const legal: PakkseddelPDFData["legal_entity"] = {
        legal_name: (legalRow as any)?.legal_name ?? "",
        org_number: (legalRow as any)?.org_number ?? "",
        invoice_address_line1: (legalRow as any)?.invoice_address_line1 ?? null,
        invoice_postal_code: (legalRow as any)?.invoice_postal_code ?? null,
        invoice_city: (legalRow as any)?.invoice_city ?? null,
      };

      // 2) Hent delivery_notes for scope
      let notesQuery = supabase
        .from("delivery_notes")
        .select(
          "id, display_number, delivery_date, route_label, notes, delivery_tour_id, customer_snapshot, delivery_address_snapshot",
        )
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .neq("status", "cancelled")
        // Returpakksedler skrives ut fra Retur-fanen, ikke i bulk.
        .eq("is_return", false);

      if (scope.kind === "date_tour") {
        notesQuery = notesQuery.eq("delivery_date", scope.date);
        if (scope.tourId === NULL_TOUR_KEY) {
          notesQuery = notesQuery.is("delivery_tour_id", null);
        } else if (scope.tourId !== "all") {
          notesQuery = notesQuery.eq("delivery_tour_id", scope.tourId);
        }
      } else {
        notesQuery = notesQuery.in("id", scope.ids);
      }

      const { data: notes, error: notesErr } = await notesQuery;
      if (notesErr) throw notesErr;
      if (!notes || notes.length === 0) {
        return {
          delivery_date: scope.date,
          scope_label: "Ingen pakksedler",
          groups: [],
          total_notes: 0,
          legal_entity: legal,
        };
      }

      const noteIds = notes.map((n: any) => n.id);

      // 3) Hent linjer + ordre-koblinger i én batch hver
      const [{ data: allLines, error: linesErr }, { data: allLinks, error: linksErr }, { data: tours, error: toursErr }] =
        await Promise.all([
          supabase
            .from("delivery_note_lines")
            .select("id, delivery_note_id, line_number, product_snapshot, quantity, sales_unit, order_line_id")
            .in("delivery_note_id", noteIds)
            .order("line_number", { ascending: true }),
          supabase
            .from("delivery_note_lines")
            .select("delivery_note_id, order_id, orders(order_number)")
            .in("delivery_note_id", noteIds),
          supabase
            .from("delivery_tours")
            .select("id, tour_number, display_name")
            .eq("legal_entity_id", NB_LEGAL_ENTITY_ID),
        ]);
      if (linesErr) throw linesErr;
      if (linksErr) throw linksErr;
      if (toursErr) throw toursErr;

      // Kakebilder + etikettnummer — samme oppslag som enkeltpakkseddelen.
      const orderLineIds = ((allLines ?? []) as any[])
        .map((l) => l.order_line_id)
        .filter(Boolean) as string[];
      const cakeByLine: Record<string, CakeInfo> = {};
      if (orderLineIds.length > 0) {
        const { data: cakeRows, error: cakeErr } = await supabase
          .from("cake_images")
          .select("order_line_id, label_unit_id, label_number, edited_path, original_path")
          .in("order_line_id", orderLineIds);
        if (cakeErr) throw cakeErr;
        const rows = (cakeRows ?? []) as any[];
        const numberByUnit = await fetchLabelNumbersByUnit(rows);
        const paths = rows.map((r) => r.edited_path || r.original_path).filter(Boolean);
        const { data: signed } = paths.length
          ? await supabase.storage.from("cake-images").createSignedUrls(paths, 60 * 30)
          : { data: [] as any[] };
        const urlMap = Object.fromEntries((signed ?? []).map((sg: any) => [sg.path, sg.signedUrl]));
        for (const r of rows) {
          cakeByLine[r.order_line_id as string] = {
            label_number: resolveLabelNumber(r, numberByUnit),
            url: urlMap[r.edited_path || r.original_path] ?? null,
          };
        }
      }

      const linesByNote = new Map<string, any[]>();
      for (const l of allLines ?? []) {
        const arr = linesByNote.get((l as any).delivery_note_id) ?? [];
        arr.push(l);
        linesByNote.set((l as any).delivery_note_id, arr);
      }

      const orderNumbersByNote = new Map<string, Set<string>>();
      for (const r of (allLinks ?? []) as any[]) {
        const num = r?.orders?.order_number;
        if (!num) continue;
        const set = orderNumbersByNote.get(r.delivery_note_id) ?? new Set();
        set.add(num);
        orderNumbersByNote.set(r.delivery_note_id, set);
      }

      const tourMeta = new Map<string, { tour_number: number; display_name: string }>();
      for (const t of tours ?? []) {
        tourMeta.set((t as any).id, {
          tour_number: (t as any).tour_number,
          display_name: (t as any).display_name,
        });
      }

      // 4) Bygg PDF-data per pakkseddel
      const mapped: PakkseddelPDFData[] = (notes as any[]).map((n) => {
        const lines = linesByNote.get(n.id) ?? [];
        const orderNumbers = Array.from(orderNumbersByNote.get(n.id) ?? []).sort();
        return mapNote(n, lines, orderNumbers, legal, cakeByLine);
      });

      // 5) Grupper per delivery_tour_id (NULL = Uten tur)
      const groupMap = new Map<string | null, PakkseddelPDFData[]>();
      for (const note of mapped) {
        const tourId = ((notes as any[]).find((n) => n.id === note.id)?.delivery_tour_id ?? null) as
          | string
          | null;
        const arr = groupMap.get(tourId) ?? [];
        arr.push(note);
        groupMap.set(tourId, arr);
      }

      // 6) Sorter innen hver gruppe alfabetisk på kundenavn (norsk)
      const collator = new Intl.Collator("nb-NO", { sensitivity: "base" });
      for (const arr of groupMap.values()) {
        arr.sort((a, b) => collator.compare(a.customer.name, b.customer.name));
      }

      // 7) Bygg sortert grupper-array: turer på tour_number, "Uten tur" sist
      const groups: BulkTourGroup[] = [];
      const nonNullKeys = Array.from(groupMap.keys()).filter((k): k is string => k !== null);
      nonNullKeys.sort((a, b) => {
        const ta = tourMeta.get(a)?.tour_number ?? 999;
        const tb = tourMeta.get(b)?.tour_number ?? 999;
        return ta - tb;
      });
      for (const tourId of nonNullKeys) {
        const meta = tourMeta.get(tourId);
        groups.push({
          tour_id: tourId,
          tour_number: meta?.tour_number ?? null,
          tour_display_name: meta?.display_name ?? "Ukjent tur",
          notes: groupMap.get(tourId) ?? [],
        });
      }
      if (groupMap.has(null)) {
        groups.push({
          tour_id: null,
          tour_number: null,
          tour_display_name: "Uten tur",
          notes: groupMap.get(null) ?? [],
        });
      }

      // 8) Bygg scope-label
      let scopeLabel = "Alle turer";
      if (scope.kind === "date_tour") {
        if (scope.tourId === "all") scopeLabel = "Alle turer";
        else if (scope.tourId === NULL_TOUR_KEY) scopeLabel = "Uten tur";
        else {
          const meta = tourMeta.get(scope.tourId);
          scopeLabel = meta ? `Tur ${meta.tour_number} ${meta.display_name}` : "Valgt tur";
        }
      } else {
        scopeLabel = `${scope.ids.length} valgte`;
      }

      const dateOut = scope.kind === "date_tour" ? scope.date : (notes as any[])[0]?.delivery_date ?? "";

      return {
        delivery_date: dateOut,
        scope_label: scopeLabel,
        groups,
        total_notes: mapped.length,
        legal_entity: legal,
      };
    },
    staleTime: 10_000,
  });
}
