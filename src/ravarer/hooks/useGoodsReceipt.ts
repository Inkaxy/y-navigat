import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRavarer } from "@/ravarer/context/RavarerContext";
import { toast } from "sonner";
import { invalidateRawMaterial } from "@/ravarer/lib/invalidate";
import { fetchAllRowsExact } from "@/lib/countedPaging";
import {
  parseReceiveResult,
  ReceiveOutcomeUnknownError,
  type MovementEvidence,
  type ReceiptLineFacts,
  type ReceiptRecord,
  type ReceiveOutcome,
} from "@/ravarer/lib/receiptStatus";


export interface ReceiptInvoiceRow {
  id: string;
  invoice_number: string;
  invoice_date: string;
  status: string;
  is_credit_note: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
  total_amount: number | null;
  /** Lagerførte linjer med bekreftet mottak (`rm_goods_receipts`). */
  confirmed_lines: number;
  /** Lagerførte linjer med lagerbevegelse, men uten bekreftet mottak. */
  movement_only_lines: number;
  /** Lagerførte linjer uten mottak og uten bevegelse. */
  open_lines: number;
  /** Linjer som gjelder varer uten lagerføring. */
  untracked_lines: number;
  total_lines: number;
  /** Mottaks- eller bevegelsesoppslaget feilet; tellerne over er da ufullstendige. */
  evidence_error: boolean;
}

export interface ReceiptLine extends ReceiptLineFacts {
  id: string;
  line_number: number | null;
  description: string | null;
  total_amount: number | null;
  raw_material_name: string | null;
}

interface InvoiceFilters {
  fromDate: string;
  toDate: string;
  supplierId?: string | null;
}

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null; count?: number | null }>;

/** Henter mottak for linjene; feil gir `null` (ukjent), aldri tomt. */
async function fetchReceipts(lineIds: string[]): Promise<Map<string, ReceiptRecord> | null> {
  const out = new Map<string, ReceiptRecord>();
  try {
    for (let i = 0; i < lineIds.length; i += 300) {
      const chunk = lineIds.slice(i, i + 300);
      type Row = { id: string; invoice_line_id: string; quantity_base: number; received_at: string; lot_id: string | null };
      const rows = await fetchAllRowsExact<Row>((from, to) =>
        supabase
          .from("rm_goods_receipts")
          .select("id, invoice_line_id, quantity_base, received_at, lot_id", { count: "exact" })
          .in("invoice_line_id", chunk)
          .order("invoice_line_id")
          .order("id")
          .range(from, to) as PageResult<Row>,
      );
      rows.forEach(r => out.set(r.invoice_line_id, { quantity_base: Number(r.quantity_base), received_at: r.received_at, lot_id: r.lot_id }));
    }
    return out;
  } catch (e) {
    console.warn("[varemottak] mottaksoppslag feilet", e);
    return null;
  }
}

/** Henter purchase/return-bevegelser mot linjene; feil gir `null` (ukjent). */
async function fetchMovements(lineIds: string[]): Promise<Map<string, MovementEvidence> | null> {
  const out = new Map<string, MovementEvidence>();
  try {
    for (let i = 0; i < lineIds.length; i += 300) {
      const chunk = lineIds.slice(i, i + 300);
      type Row = { id: string; source_id: string | null; quantity_base: number | null; movement_type: string };
      const rows = await fetchAllRowsExact<Row>((from, to) =>
        supabase
          .from("stock_movements")
          .select("id, source_id, quantity_base, movement_type", { count: "exact" })
          .eq("source_table", "invoice_lines")
          .in("movement_type", ["purchase", "return"])
          .in("source_id", chunk)
          .order("source_id")
          .order("id")
          .range(from, to) as PageResult<Row>,
      );
      for (const m of rows) {
        if (!m.source_id) continue;
        const cur = out.get(m.source_id) ?? { quantity_base: 0, types: [] };
        cur.quantity_base += Number(m.quantity_base) || 0;
        if (!cur.types.includes(m.movement_type)) cur.types.push(m.movement_type);
        out.set(m.source_id, cur);
      }
    }
    return out;
  } catch (e) {
    console.warn("[varemottak] bevegelsesoppslag feilet", e);
    return null;
  }
}

/** Fakturaer i perioden med mottaksstatus per faktura. Hele perioden hentes (sidevis), aldri stille avkortet. */
export function useReceiptInvoices(filters: InvoiceFilters) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["receipt-invoices", legalEntityId, filters.fromDate, filters.toDate, filters.supplierId ?? null],
    enabled: !!legalEntityId,
    queryFn: async (): Promise<ReceiptInvoiceRow[]> => {
      type Inv = {
        id: string; invoice_number: string; invoice_date: string; status: string; is_credit_note: boolean | null;
        supplier_id: string | null; total_amount: number | null; suppliers: { name: string } | null;
      };
      const invoices = await fetchAllRowsExact<Inv>((from, to) => {
        let q = supabase
          .from("invoices")
          .select("id, invoice_number, invoice_date, status, is_credit_note, supplier_id, total_amount, suppliers(name)", { count: "exact" })
          .eq("legal_entity_id", legalEntityId as string)
          .in("status", ["ready", "reconciled"])
          .gte("invoice_date", filters.fromDate)
          .lte("invoice_date", filters.toDate);
        if (filters.supplierId) q = q.eq("supplier_id", filters.supplierId);
        return q.order("invoice_date", { ascending: false }).order("id").range(from, to) as PageResult<Inv>;
      });
      const ids = invoices.map(i => i.id);
      if (ids.length === 0) return [];

      type CountLine = { id: string; invoice_id: string; raw_materials: { stock_tracking: boolean } | null };
      const lines: CountLine[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const part = await fetchAllRowsExact<CountLine>((from, to) =>
          supabase
            .from("invoice_lines")
            .select("id, invoice_id, raw_materials(stock_tracking)", { count: "exact" })
            .in("invoice_id", chunk)
            .order("id")
            .range(from, to) as PageResult<CountLine>,
        );
        lines.push(...part);
      }
      const trackedIds = lines.filter(l => l.raw_materials?.stock_tracking).map(l => l.id);
      const [receipts, movements] = await Promise.all([fetchReceipts(trackedIds), fetchMovements(trackedIds)]);

      const byInvoice = new Map<string, CountLine[]>();
      lines.forEach(l => byInvoice.set(l.invoice_id, [...(byInvoice.get(l.invoice_id) ?? []), l]));
      return invoices.map(inv => {
        const mine = byInvoice.get(inv.id) ?? [];
        let confirmed = 0;
        let movementOnly = 0;
        let open = 0;
        let untracked = 0;
        for (const l of mine) {
          if (!l.raw_materials?.stock_tracking) untracked++;
          else if (receipts?.has(l.id)) confirmed++;
          else if (movements?.has(l.id)) movementOnly++;
          else open++;
        }
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          invoice_date: inv.invoice_date,
          status: inv.status,
          is_credit_note: inv.is_credit_note === true,
          supplier_id: inv.supplier_id,
          supplier_name: inv.suppliers?.name ?? null,
          total_amount: inv.total_amount == null ? null : Number(inv.total_amount),
          confirmed_lines: confirmed,
          movement_only_lines: movementOnly,
          open_lines: open,
          untracked_lines: untracked,
          total_lines: mine.length,
          evidence_error: receipts == null || movements == null,
        };
      });
    },
  });
}

/** Linjene på én faktura med bekreftet mottak og lagerbevegelse hver for seg. */
export function useReceiptLines(invoiceId: string | undefined) {
  const { legalEntityId } = useRavarer();
  return useQuery({
    queryKey: ["receipt-lines", invoiceId, legalEntityId],
    enabled: !!invoiceId && !!legalEntityId,
    queryFn: async (): Promise<ReceiptLine[]> => {
      const { data: inv, error: invErr } = await supabase
        .from("invoices")
        .select("id, is_credit_note")
        .eq("id", invoiceId as string)
        .eq("legal_entity_id", legalEntityId as string)
        .maybeSingle();
      if (invErr) throw invErr;
      if (!inv) throw new Error("Fakturaen finnes ikke i dette selskapet.");
      type RawLine = {
        id: string; line_number: number | null; description: string | null; quantity: number | null; unit: string | null;
        base_quantity: number | null; total_amount: number | null; raw_material_id: string | null; requires_review: boolean | null;
        match_confidence: string | null; raw_materials: { id: string; name: string; base_unit: string; stock_tracking: boolean } | null;
      };
      const rows = await fetchAllRowsExact<RawLine>((from, to) =>
        supabase
          .from("invoice_lines")
          .select("id, line_number, description, quantity, unit, base_quantity, total_amount, raw_material_id, requires_review, match_confidence, raw_materials(id, name, base_unit, stock_tracking)", { count: "exact" })
          .eq("invoice_id", invoiceId as string)
          .order("line_number")
          .order("id")
          .range(from, to) as PageResult<RawLine>,
      );
      const ids = rows.map(r => r.id);
      const [receipts, movements] = ids.length ? await Promise.all([fetchReceipts(ids), fetchMovements(ids)]) : [new Map(), new Map()];
      return rows.map(r => ({
        id: r.id,
        line_number: r.line_number,
        description: r.description,
        quantity: r.quantity == null ? null : Number(r.quantity),
        unit: r.unit,
        base_quantity: r.base_quantity == null ? null : Number(r.base_quantity),
        total_amount: r.total_amount == null ? null : Number(r.total_amount),
        raw_material_id: r.raw_material_id,
        raw_material_name: r.raw_materials?.name ?? null,
        base_unit: r.raw_materials?.base_unit ?? null,
        stock_tracking: !!r.raw_materials?.stock_tracking,
        requires_review: r.requires_review === true,
        not_applicable: r.match_confidence === "not_applicable",
        is_credit_note: inv.is_credit_note === true,
        receipt: receipts == null ? { status: "error" } : { status: "ok", value: receipts.get(r.id) ?? null },
        movement: movements == null ? { status: "error" } : { status: "ok", value: movements.get(r.id) ?? null },
      }));
    },
  });
}

export interface ReceiptMovementInput {
  raw_material_id: string;
  /** Positiv = mottok mer, negativ = mottok mindre. Svinn sendes som positivt tall med kind 'waste'. */
  quantity_base: number;
  kind: "adjustment" | "waste" | "purchase";
  note: string;
  occurred_at?: string;
}

/** Skriver en mottaksbevegelse (avvik, svinn eller manuelt mottak). */
export function useReceiptMovement() {
  const qc = useQueryClient();
  const { legalEntityId, user } = useRavarer();
  return useMutation({
    mutationFn: async (input: ReceiptMovementInput) => {
      const quantity = input.kind === "waste" ? -Math.abs(input.quantity_base) : input.quantity_base;
      const { error } = await supabase.from("stock_movements").insert({
        legal_entity_id: legalEntityId,
        raw_material_id: input.raw_material_id,
        movement_type: input.kind,
        quantity_base: quantity,
        note: input.note,
        occurred_at: input.occurred_at ?? new Date().toISOString(),
        source_table: "manual",
        source_id: crypto.randomUUID(),
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      invalidateRawMaterial(qc, vars.raw_material_id);
      toast.success("Bevegelse registrert");
    },
    onError: (e: unknown) => toast.error(`Kunne ikke registrere: ${e instanceof Error ? e.message : String(e)}`),
  });
}

export interface ReceiveLineInput {
  invoice_line_id: string;
  invoice_id: string;
  /** Visning/invalidering; serveren leser råvare og mengde selv. */
  raw_material_id: string;
  invoice_number: string;
  /** Partinummer fra pakken, hvis leverandøren oppgir det. Aldri gjettet fra fakturaen. */
  lot_number?: string | null;
  /** Best før-dato (åååå-mm-dd). */
  best_before?: string | null;
}

/**
 * Bekrefter mottak av én fakturalinje via `rm_receive_invoice_line`. Serveren er
 * mengdeautoritet, knytter mottak/parti til en eventuell eksisterende bevegelse
 * og fører aldri en ekstra. Klienten skriver ingen bevegelse etter kallet.
 * Transportfeil/uventet svar er ukjent utfall: status hentes på nytt.
 */
export function useReceiveInvoiceLine() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ReceiveLineInput): Promise<ReceiveOutcome> => {
      let res: { data: unknown; error: { message?: string; code?: string } | null };
      try {
        res = await supabase.rpc("rm_receive_invoice_line", {
          p_line_id: input.invoice_line_id,
          p_lot_number: input.lot_number ?? undefined,
          p_best_before: input.best_before ?? undefined,
          p_note: `Mottak faktura ${input.invoice_number}`,
        });
      } catch (e) {
        console.warn("[varemottak] nettfeil", e);
        throw new ReceiveOutcomeUnknownError();
      }
      if (res.error) {
        // Bare kjente databasekoder beviser avvist (rullet tilbake) transaksjon; transport/gateway er ukjent.
        if (!res.error.code || !/^(P0|22|23|42|28)/.test(res.error.code)) throw new ReceiveOutcomeUnknownError();
        throw new Error(res.error.message || "Mottaket ble avvist.");
      }
      return parseReceiveResult(res.data);
    },
    onSettled: async (_res, _err, vars) => {
      // Etter hvert forsøk (også ukjent) leses autoritativ mottaksstatus på nytt. Panelet holder
      // ukjent utfall frosset til en vellykket lesing etter forsøket — avventing alene frigjør ikke.
      invalidateRawMaterial(qc, vars.raw_material_id);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["receipt-lines", vars.invoice_id] }),
        qc.invalidateQueries({ queryKey: ["receipt-invoices"] }),
        qc.invalidateQueries({ queryKey: ["priskontroll-mengde-diagnostikk"] }),
      ]);
    },
    onSuccess: res => {
      if (res.kind === "not_stock") toast.info("Varen er ikke lagerført — ingenting ble ført på lager.");
      else if (res.kind === "already") toast.success("Linja var allerede mottatt — ingenting ble ført på nytt.");
      else toast.success("Mottak bekreftet");
    },
    onError: (e: unknown) => toast.error(e instanceof ReceiveOutcomeUnknownError ? e.message : `Kunne ikke motta: ${e instanceof Error ? e.message : "ukjent feil"}`),
  });
}
