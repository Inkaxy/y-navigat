// FORSLAG — IKKE UTRULLET. Flyttes til supabase/functions/vt-count-ocr/ først etter roots gjennomgang.
// Leser én opplastet telleliste for NØYAKTIG én liste og lagrer bare FORSLAG. Skriver aldri tellede verdier.
// Gjenbruker eksisterende AI-oppsett (ai_provider_config, formål invoice_extraction) og felles callAi/crypto
// uten å endre dem. Én betalt kjøring per jobb: tidsavbrudd/ukjent utfall blir «ukjent_ai_utfall» og kjøres
// ikke på nytt automatisk.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { callAi, extractJson, type AiProvider } from "../_shared/ai-providers.ts";
import { decryptWithKey } from "../_shared/crypto.ts";
import { buildManifest, matchDocument, parseOcrOutput, VT_OCR_SYSTEM_PROMPT, type ManifestLine } from "./ocrCore.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Bare POST" });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { error: "Ikke innlogget" });
  let body: unknown; try { body = await req.json(); } catch { return json(400, { error: "Ugyldig forespørsel" }); }
  const jobId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).job_id : null;
  if (typeof jobId !== "string" || !UUID.test(jobId)) return json(400, { error: "job_id mangler" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 1) Reserver jobben som innlogget bruker (tilgang, firma, status opprettet→behandler sjekkes i SQL).
  const { data: claim, error: claimErr } = await user.rpc("vt_ocr_claim", { p_job_id: jobId });
  if (claimErr) {
    const code = (claimErr as { code?: string }).code;
    return json(code === "42501" ? 403 : code === "55000" ? 409 : 400, { error: code === "55000" ? "Jobben er allerede behandlet eller har ukjent utfall. Ingen ny betalt lesing er startet." : "Kunne ikke starte lesingen." });
  }
  const c = claim as { count_id: string; list_id: string; template_revision: number; pdf_path: string; lines: ManifestLine[] };

  // 2) Fil fra privat lagring (sti bestemt av serveren, ikke klienten).
  const file = await admin.storage.from("vt-count-uploads").download(c.pdf_path);
  if (file.error || !file.data) { await admin.rpc("vt_ocr_record_failure", { p_job_id: jobId, p_reason: "Filen kunne ikke leses fra lagring" }); return json(200, { status: "feilet" }); }
  const bytes = new Uint8Array(await file.data.arrayBuffer());
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);

  const { data: cfg } = await admin.from("ai_provider_config").select("provider, model, encrypted_api_key, azure_endpoint, azure_deployment")
    .eq("purpose", "invoice_extraction").eq("is_active", true).maybeSingle();
  if (!cfg) { await admin.rpc("vt_ocr_record_failure", { p_job_id: jobId, p_reason: "AI-leser er ikke konfigurert" }); return json(200, { status: "feilet" }); }

  // 3) Én kjøring. Prompten inneholder INGEN forventede ID-er.
  let raw: string;
  try {
    const apiKey = await decryptWithKey(cfg.encrypted_api_key as string, "AI_CONFIG_ENCRYPTION_KEY");
    const r = await callAi({ provider: cfg.provider as AiProvider, apiKey, model: cfg.model as string, maxTokens: 8000, temperature: 0,
      systemPrompt: VT_OCR_SYSTEM_PROMPT, userText: "Les alle sidene i vedlagt PDF.", pdfBase64: btoa(bin),
      azureEndpoint: (cfg.azure_endpoint as string | null) ?? undefined, azureDeployment: (cfg.azure_deployment as string | null) ?? undefined });
    raw = r.rawText;
  } catch {
    await admin.rpc("vt_ocr_record_unknown", { p_job_id: jobId });
    return json(200, { status: "ukjent_ai_utfall" });
  }

  // 4) Streng tolkning + identitetskontroll mot manifest.
  let result;
  try {
    const manifest = buildManifest(c.count_id, c.list_id, c.template_revision, c.lines);
    result = matchDocument(parseOcrOutput(extractJson(raw)), manifest);
  } catch {
    await admin.rpc("vt_ocr_record_failure", { p_job_id: jobId, p_reason: "Lesesvaret hadde ugyldig form" });
    return json(200, { status: "feilet" });
  }
  const { error: recErr } = await admin.rpc("vt_ocr_record_result", { p_job_id: jobId, p_document_ok: result.document_ok, p_issues: result.issues, p_proposals: result.proposals });
  if (recErr) return json(200, { status: "ukjent_lagring" });
  return json(200, { status: "klar", document_ok: result.document_ok, proposals: result.proposals.length, issues: result.issues.length });
});
