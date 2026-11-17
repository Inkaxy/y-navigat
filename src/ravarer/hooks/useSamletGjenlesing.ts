// Samlet gjenlesing: React-innganger. Oppsummeringen leser bare (ingen skriving før «Start»).
import { useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/contexts/CompanyContext";
import { useAuthUserId } from "@/hooks/useAuth";
import { osloTodayISO } from "@/lib/osloDate";
import { parseAiConfigs } from "@/ravarer/lib/aiConfig";
import { buildPlan, estimateRunCost, type PlanInvoice, type RunCost, type RunPlan, type UsageRow } from "@/ravarer/lib/samletGjenlesing/plan";
import { samletRunner } from "./samletGjenlesingRunner";

const OPEN = ["imported", "needs_review", "ready"];
const PAGE = 1000;
const CHUNK = 100;

export function useSamletRunner() {
  const { company } = useCompany();
  const uid = useAuthUserId();
  const qc = useQueryClient();
  const le = company?.id ?? null;
  useEffect(() => { if (le && uid) samletRunner.attach(le, uid, qc); }, [le, uid, qc]);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key?.startsWith("nbhub.samlet-gjenlesing")) samletRunner.reload(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const snap = useSyncExternalStore(samletRunner.subscribe, samletRunner.getSnapshot);
  const mine = !!snap.ctx && snap.ctx.le === le && snap.ctx.uid === uid;
  return { ...snap, state: mine ? snap.state : null, runner: samletRunner };
}

type InvRow = {
  id: string; invoice_number: string | null; invoice_date: string | null; supplier_id: string | null; total_amount: number | null;
  status: string | null; reconciled_at: string | null; flagged_at: string | null; source_document_url: string | null;
  lines_sum_status: string | null; line_extraction_status: string | null; line_extraction_at: string | null;
  invoice_lines: { count: number }[] | null;
};

async function fetchOpenInvoices(le: string): Promise<InvRow[]> {
  const out: InvRow[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += PAGE) {
    const { data, error, count } = await supabase.from("invoices")
      .select("id, invoice_number, invoice_date, supplier_id, total_amount, status, reconciled_at, flagged_at, source_document_url, lines_sum_status, line_extraction_status, line_extraction_at, invoice_lines(count)", { count: "exact" })
      .eq("legal_entity_id", le).in("status", OPEN).is("reconciled_at", null)
      .order("id").range(from, from + PAGE - 1);
    if (error) throw new Error("Kunne ikke hente åpne fakturaer.");
    if (expected === null) expected = count ?? null;
    out.push(...((data ?? []) as InvRow[]));
    if (!data || data.length === 0 || (expected !== null && out.length >= expected)) break;
  }
  if (expected === null || out.length !== expected) throw new Error("Listen over åpne fakturaer ble ikke komplett. Prøv igjen.");
  return out;
}

async function idsWhere(table: "invoice_internal_approvals" | "invoice_line_cost_postings", ids: string[]): Promise<Set<string>> {
  const s = new Set<string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    const q = table === "invoice_internal_approvals"
      ? supabase.from(table).select("invoice_id").in("invoice_id", part).eq("status", "approved").is("revoked_at", null).limit(5000)
      : supabase.from(table).select("invoice_id").in("invoice_id", part).is("revoked_at", null).limit(20000);
    const { data, error } = await q;
    if (error) throw new Error("Kunne ikke kontrollere godkjenning og kostføring.");
    for (const r of data ?? []) if (r.invoice_id) s.add(r.invoice_id);
  }
  return s;
}

async function runInfo(le: string, todayIso: string) {
  const nowIso = new Date().toISOString();
  const [open, applied] = await Promise.all([
    supabase.from("invoice_reread_runs").select("invoice_id").eq("legal_entity_id", le).in("status", ["reading", "ready"]).gt("expires_at", nowIso).limit(5000),
    supabase.from("invoice_reread_runs").select("invoice_id, applied_at").eq("legal_entity_id", le).eq("status", "applied").gte("applied_at", `${todayIso}T00:00:00+00:00`).limit(5000),
  ]);
  if (open.error || applied.error) throw new Error("Kunne ikke hente pågående lesinger.");
  const appliedAt = new Map<string, string>();
  for (const r of applied.data ?? []) if (r.applied_at) appliedAt.set(r.invoice_id, r.applied_at);
  return { openRuns: new Set((open.data ?? []).map((r) => r.invoice_id)), appliedAt };
}

/** Kostnadsgrunnlag: bare synlig for plattformadministrator. Ellers ukjent – aldri 0. */
async function costBasis(): Promise<{ rows: UsageRow[] | null; activeModel: string | null; modelSource: "aktiv" | "siste" | null }> {
  let activeModel: string | null = null;
  try {
    const { data, error } = await supabase.functions.invoke("ai-config", { body: { action: "list" } });
    if (!error) activeModel = parseAiConfigs(data).find((c) => c.is_active && c.purpose === "invoice_extraction")?.model ?? null;
  } catch (e) { console.warn("[samlet-gjenlesing] modell ukjent", e); }
  const { data, error } = await supabase.from("ai_usage_log").select("model, estimated_cost_usd, success")
    .eq("purpose", "invoice_extraction").order("created_at", { ascending: false }).limit(300);
  const rows = error ? null : (data ?? []).map((r) => ({ model: r.model, estimated_cost_usd: r.estimated_cost_usd, success: r.success === true }));
  if (activeModel) return { rows, activeModel, modelSource: "aktiv" };
  const last = rows?.find((r) => r.success && r.model)?.model ?? null;
  return { rows, activeModel: last, modelSource: last ? "siste" : null };
}

export interface SamletPlan { plan: RunPlan; reconciled: number | null; cost: RunCost; modelSource: "aktiv" | "siste" | null; todayIso: string }

export function useSamletPlan(enabled: boolean) {
  const { company } = useCompany();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["samlet-gjenlesing", "plan", le],
    enabled: enabled && !!le,
    staleTime: 0,
    gcTime: 60_000,
    queryFn: async (): Promise<SamletPlan> => {
      if (!le) throw new Error("Mangler selskap.");
      const todayIso = osloTodayISO();
      const rows = await fetchOpenInvoices(le);
      const ids = rows.map((r) => r.id);
      const [approved, posted, runs, rec, cb] = await Promise.all([
        idsWhere("invoice_internal_approvals", ids),
        idsWhere("invoice_line_cost_postings", ids),
        runInfo(le, todayIso),
        supabase.from("invoices").select("id", { count: "exact", head: true }).eq("legal_entity_id", le).not("reconciled_at", "is", null),
        costBasis(),
      ]);
      const invoices: PlanInvoice[] = rows.map((r) => ({
        id: r.id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, supplier_id: r.supplier_id, total_amount: r.total_amount,
        status: r.status, reconciled_at: r.reconciled_at, flagged_at: r.flagged_at, source_document_url: r.source_document_url,
        lines_sum_status: r.lines_sum_status, line_extraction_status: r.line_extraction_status, line_extraction_at: r.line_extraction_at,
        line_count: r.invoice_lines?.[0]?.count ?? 0, approved: approved.has(r.id), costPosted: posted.has(r.id),
        openRun: runs.openRuns.has(r.id), rereadAppliedAt: runs.appliedAt.get(r.id) ?? null,
      }));
      const plan = buildPlan(invoices, todayIso);
      return { plan, reconciled: rec.error ? null : rec.count ?? null, cost: estimateRunCost(cb.rows, cb.activeModel, plan.read.length), modelSource: cb.modelSource, todayIso };
    },
  });
}

export interface SuggestionRow {
  runId: string; invoiceId: string; createdAt: string; expiresAt: string;
  invoiceNumber: string | null; invoiceDate: string | null; supplierId: string | null; totalAmount: number | null;
}

/** Ventende forslag (lesinger klare til gjennomgang) som denne brukeren eier. Uten snapshot/forslag – de hentes ved «Bruk». */
export function useRereadSuggestions(enabled: boolean) {
  const { company } = useCompany();
  const uid = useAuthUserId();
  const le = company?.id ?? null;
  return useQuery({
    queryKey: ["samlet-gjenlesing", "forslag", le, uid],
    enabled: enabled && !!le && !!uid,
    queryFn: async (): Promise<SuggestionRow[]> => {
      if (!le || !uid) return [];
      const { data, error } = await supabase.from("invoice_reread_runs").select("id, invoice_id, created_at, expires_at")
        .eq("legal_entity_id", le).eq("created_by", uid).eq("status", "ready").gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true }).limit(500);
      if (error) throw new Error("Kunne ikke hente ventende forslag.");
      const runs = data ?? [];
      const inv = new Map<string, { invoice_number: string | null; invoice_date: string | null; supplier_id: string | null; total_amount: number | null }>();
      const ids = [...new Set(runs.map((r) => r.invoice_id))];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await supabase.from("invoices").select("id, invoice_number, invoice_date, supplier_id, total_amount").in("id", ids.slice(i, i + CHUNK));
        if (r.error) throw new Error("Kunne ikke hente fakturaene til forslagene.");
        for (const x of r.data ?? []) inv.set(x.id, x);
      }
      return runs.map((r) => {
        const i = inv.get(r.invoice_id);
        return { runId: r.id, invoiceId: r.invoice_id, createdAt: r.created_at, expiresAt: r.expires_at, invoiceNumber: i?.invoice_number ?? null, invoiceDate: i?.invoice_date ?? null, supplierId: i?.supplier_id ?? null, totalAmount: i?.total_amount ?? null };
      }).sort((a, b) => (a.invoiceDate ?? "9999").localeCompare(b.invoiceDate ?? "9999") || a.invoiceId.localeCompare(b.invoiceId));
    },
  });
}
