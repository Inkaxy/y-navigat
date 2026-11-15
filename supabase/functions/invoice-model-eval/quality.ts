// Hjelpere for kvalitetstesten i invoice-model-eval: nøkkelsjekk per lagret oppsett, nøkkel fra valgt
// oppsett, fasit fra godkjente lagrede linjer og oppdelt lesing. Skriver ALDRI til faktura/linjer/oppsett.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { decryptWithKey } from "../_shared/crypto.ts";
import { isCatalogModel } from "../_shared/aiModelCatalog.ts";
import { classifyAiFailure } from "../_shared/aiFailure.ts";
import { EVAL_FASIT } from "../_shared/evalFasit.ts";
import { fasitRowsFromVerified, type FasitRow, type FasitScoreV2 } from "../_shared/qualityTest.ts";
import { probeConfig, type AiConfigRow } from "./readerCopies.ts";
import type { QualityTestInvoice } from "../_shared/qualityTestSet.ts";

type Client = SupabaseClient;
const CFG_COLS = "id, provider, model, is_active, updated_at, encrypted_api_key, max_tokens, temperature, azure_endpoint, azure_deployment";
type CfgRow = AiConfigRow & { is_active: boolean; updated_at: string };

export interface EvalCredential { configId: string | null; provider: "openai" | "anthropic"; model: string; apiKey: string; temperature: number }

/** Gratis tilgangssjekk (ingen tokens) for HVERT lagret oppsett for fakturalesing. Nøkkelen returneres aldri. */
export async function checkInvoiceConfigs(admin: Client) {
  const { data, error } = await admin.from("ai_provider_config").select(CFG_COLS).eq("purpose", "invoice_extraction").order("is_active", { ascending: false }).order("updated_at", { ascending: false });
  if (error) return null;
  const rows = (data ?? []) as CfgRow[];
  return Promise.all(rows.map(async (c) => {
    const r = c.encrypted_api_key ? await probeConfig(c) : classifyAiFailure("decrypt", c.provider);
    return {
      config_id: c.id, provider: c.provider, model: c.model, is_active: c.is_active, updated_at: c.updated_at,
      status: r === "ok" ? "ok" : r == null ? "ikke_kontrollert" : r.kind,
      message: r === "ok" ? "Nøkkelen og modellen svarer" : r == null ? "Kan ikke sjekkes uten et ekte kall" : r.message,
    };
  }));
}

/** Nøkkel og modell fra ett bestemt lagret oppsett (bare fakturalesing, bare OpenAI/Anthropic i katalogen). */
export async function loadConfigCredential(admin: Client, configId: string): Promise<EvalCredential | { code: string; message: string; status: number }> {
  const { data, error } = await admin.from("ai_provider_config").select(CFG_COLS).eq("id", configId).eq("purpose", "invoice_extraction").maybeSingle();
  if (error) return { code: "config_unknown", message: "Kunne ikke lese AI-oppsettet", status: 503 };
  const c = data as CfgRow | null;
  if (!c) return { code: "config_missing", message: "Oppsettet finnes ikke for fakturalesing", status: 404 };
  if ((c.provider !== "openai" && c.provider !== "anthropic") || !isCatalogModel(c.provider, c.model)) {
    return { code: "invalid_model", message: "Oppsettet bruker en leverandør eller modell som ikke kan sammenlignes", status: 400 };
  }
  try {
    const apiKey = await decryptWithKey(c.encrypted_api_key, "AI_CONFIG_ENCRYPTION_KEY");
    return { configId: c.id, provider: c.provider, model: c.model, apiKey, temperature: Number(c.temperature ?? 0.1) };
  } catch {
    return { code: "no_credential", message: "Nøkkelen i oppsettet kunne ikke leses", status: 422 };
  }
}

/**
 * Fasit for en testfaktura. Dokumentkontrollert fasit (evalFasit) går foran. Rollen «fasit» bruker lagrede
 * linjer bare når fakturaen fortsatt er avstemt med lines_sum_status = ok; ellers «ikke_gyldig».
 */
export async function loadQualityFasit(userClient: Client, entry: QualityTestInvoice): Promise<{ status: "ok" | "ikke_gyldig" | "ingen" | "ukjent"; rows: FasitRow[]; source: FasitScoreV2["source"] | null }> {
  const verified = EVAL_FASIT[entry.invoice_id];
  if (verified) return { status: "ok", rows: fasitRowsFromVerified(verified), source: "dokumentkontrollert" };
  if (entry.role !== "fasit") return { status: "ingen", rows: [], source: null };
  const { data: inv, error: invErr } = await userClient.from("invoices").select("status, lines_sum_status").eq("id", entry.invoice_id).maybeSingle();
  if (invErr) return { status: "ukjent", rows: [], source: null };
  if (!inv || inv.status !== "reconciled" || inv.lines_sum_status !== "ok") return { status: "ikke_gyldig", rows: [], source: null };
  const { data, error } = await userClient.from("invoice_lines")
    .select("supplier_sku, description, line_kind, quantity, unit_price, total_amount, excluded_at, line_number")
    .eq("invoice_id", entry.invoice_id).order("line_number", { ascending: true }).limit(500);
  if (error) return { status: "ukjent", rows: [], source: null };
  const n = (v: unknown) => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((r) => r.excluded_at == null).map((r) => ({
    sku: typeof r.supplier_sku === "string" ? r.supplier_sku : null, description: typeof r.description === "string" ? r.description : null,
    line_kind: typeof r.line_kind === "string" ? r.line_kind : null, quantity: n(r.quantity), unit_price: n(r.unit_price), total_amount: n(r.total_amount),
  }));
  return rows.length ? { status: "ok", rows, source: "godkjent_lagret" } : { status: "ikke_gyldig", rows: [], source: null };
}
