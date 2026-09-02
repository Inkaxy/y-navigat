import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { showError } from "@/lib/userError";
import { NBE_LEGAL_ENTITY_ID } from "@/rapporter/lib/constants";
import { logAudit } from "@/rapporter/lib/audit";
import type { NgReportRow } from "@/rapporter/lib/ngFormat";

const SALES_STATUSES = ["delivered", "invoiced"];

export type NgCustomer = { id: string; display_name: string; gln: string | null };
export type NgSortimentProduct = { product_id: string; display_name: string; gtin: string | null };
export type NgOutsideProduct = { product_id: string; vare_navn: string; belop: number };

export type NgSupplier = { gln: string | null; ng_supplier_name: string | null; display_name: string };

export function useNgSupplier() {
  return useQuery({
    queryKey: ["rapporter", "ng-supplier"],
    queryFn: async (): Promise<NgSupplier | null> => {
      const { data, error } = await supabase
        .from("legal_entities")
        .select("gln, ng_supplier_name, display_name")
        .eq("id", NBE_LEGAL_ENTITY_ID)
        .maybeSingle();
      if (error) throw error;
      return data as NgSupplier | null;
    },
  });
}

/** Kunder merket «Inngår i NG-rapport». */
export function useNgCustomers() {
  return useQuery({
    queryKey: ["rapporter", "ng-customers"],
    queryFn: async (): Promise<NgCustomer[]> => {
      const { data, error } = await supabase
        .from("customers")
        .select("id, display_name, gln")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("ng_reportable", true)
        .order("display_name");
      if (error) throw error;
      return (data ?? []) as NgCustomer[];
    },
  });
}

/** Medlemmene i statistikkgruppen «NG-sortiment». */
export function useNgSortiment() {
  return useQuery({
    queryKey: ["rapporter", "ng-sortiment"],
    queryFn: async (): Promise<NgSortimentProduct[]> => {
      const { data: group, error: gErr } = await supabase
        .from("statistic_groups")
        .select("id")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("display_name", "NG-sortiment")
        .maybeSingle();
      if (gErr) throw gErr;
      if (!group) return [];
      const { data, error } = await supabase
        .from("statistic_group_members")
        .select("product_id, products(display_name, gtin)")
        .eq("group_id", group.id);
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{
        product_id: string;
        products: { display_name: string; gtin: string | null } | null;
      }>).map((m) => ({
        product_id: m.product_id,
        display_name: m.products?.display_name ?? "(ukjent)",
        gtin: m.products?.gtin ?? null,
      }));
    },
  });
}

/** Rapportrader for perioden. */
export function useNgReport(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ["rapporter", "ng-report", periodStart, periodEnd],
    queryFn: async (): Promise<NgReportRow[]> => {
      const { data, error } = await supabase.rpc("generate_ng_report", {
        p_legal_entity_id: NBE_LEGAL_ENTITY_ID,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw error;
      return ((data ?? []) as NgReportRow[]).map((r) => ({
        ...r,
        kjop_belop: Number(r.kjop_belop ?? 0),
        kjop_antall: Number(r.kjop_antall ?? 0),
      }));
    },
  });
}

/** Solgte varer til NG-kunder som IKKE ligger i NG-sortiment. */
export function useNgOutside(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ["rapporter", "ng-outside", periodStart, periodEnd],
    queryFn: async (): Promise<NgOutsideProduct[]> => {
      const { data, error } = await supabase.rpc("generate_ng_report_outside", {
        p_legal_entity_id: NBE_LEGAL_ENTITY_ID,
        p_period_start: periodStart,
        p_period_end: periodEnd,
      });
      if (error) throw error;
      return ((data ?? []) as Array<{ product_id: string; vare_navn: string; belop: number | string }>).map((r) => ({
        product_id: r.product_id,
        vare_navn: r.vare_navn,
        belop: Number(r.belop ?? 0),
      }));
    },
  });
}

/** Kunde-IDer med salg (ordre i status-settet) i perioden. */
export function useNgCustomersWithSales(periodStart: string, periodEnd: string) {
  return useQuery({
    queryKey: ["rapporter", "ng-customers-with-sales", periodStart, periodEnd],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("orders")
        .select("customer_id")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .gte("delivery_date", periodStart)
        .lte("delivery_date", periodEnd)
        .in("status", SALES_STATUSES)
        .limit(5000);
      if (error) throw error;
      return new Set((data ?? []).map((o) => o.customer_id as string).filter(Boolean));
    },
  });
}

/** Legger produkter inn i NG-sortiment. */
export function useAddToSortiment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (products: { id: string; name: string }[]) => {
      const { data: group, error: gErr } = await supabase
        .from("statistic_groups")
        .select("id")
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .eq("display_name", "NG-sortiment")
        .maybeSingle();
      if (gErr) throw gErr;
      if (!group) throw new Error("Fant ikke statistikkgruppen «NG-sortiment».");
      const { error } = await supabase
        .from("statistic_group_members")
        .insert(products.map((p) => ({ group_id: group.id, product_id: p.id })));
      if (error) throw error;
      for (const p of products) {
        await logAudit({
          action: "member_added",
          entity_type: "statistic_group_member",
          entity_id: p.id,
          entity_display_reference: `NG-sortiment · ${p.name}`,
        });
      }
    },
    onSuccess: (_d, vars) => {
      toast.success(`${vars.length} vare(r) lagt i NG-sortiment`);
      qc.invalidateQueries({ queryKey: ["rapporter"] });
    },
    onError: (e) => showError("ng-sortiment-add", e, "Kunne ikke legge varen i NG-sortiment"),
  });
}

export type ArchiveInput = {
  fileName: string;
  content: string;
  periodStart: string;
  periodEnd: string;
  rowCount: number;
  customerCount: number;
  productCount: number;
  totalAmount: number;
  keptOutside: { product_id: string; vare_navn: string; belop: number }[];
};

/** Laster opp fila til storage og arkiverer kjøringen i report_runs. */
export function useArchiveNgRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ArchiveInput) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? null;
      const yyyymm = `${input.periodStart.slice(0, 4)}-${input.periodStart.slice(5, 7)}`;
      const path = `${NBE_LEGAL_ENTITY_ID}/${yyyymm}/${input.fileName}`;

      const blob = new Blob([input.content], { type: "text/csv;charset=utf-8" });
      const { error: upErr } = await supabase.storage
        .from("ng-eksport")
        .upload(path, blob, { contentType: "text/csv;charset=utf-8", upsert: false });
      if (upErr) throw upErr;

      const { error } = await supabase.from("report_runs").insert({
        legal_entity_id: NBE_LEGAL_ENTITY_ID,
        report_type: "ng_direktelevert",
        period_start: input.periodStart,
        period_end: input.periodEnd,
        row_count: input.rowCount,
        customer_count: input.customerCount,
        product_count: input.productCount,
        total_amount: input.totalAmount,
        file_name: input.fileName,
        file_path: path,
        details: {
          kept_outside: input.keptOutside,
          decided_by: userId,
          decided_at: new Date().toISOString(),
        } as never,
        generated_by: userId,
      });
      if (error) throw error;
      return path;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["rapporter", "report-runs"] });
    },
    onError: (e) => showError("ng-archive", e, "Kunne ikke arkivere rapporten"),
  });
}

export type ReportRun = {
  id: string;
  report_type: string;
  period_start: string;
  period_end: string;
  row_count: number;
  customer_count: number;
  product_count: number;
  total_amount: number;
  file_name: string;
  file_path: string | null;
  created_at: string;
  generated_by: string | null;
};

export function useReportRuns() {
  return useQuery({
    queryKey: ["rapporter", "report-runs"],
    queryFn: async (): Promise<ReportRun[]> => {
      const { data, error } = await supabase
        .from("report_runs")
        .select(
          "id, report_type, period_start, period_end, row_count, customer_count, product_count, total_amount, file_name, file_path, created_at, generated_by",
        )
        .eq("legal_entity_id", NBE_LEGAL_ENTITY_ID)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as ReportRun[];
    },
  });
}
