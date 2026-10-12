// FORSLAG — IKKE UTRULLET. Flyttes til supabase/functions/vt-count-ocr/ først etter roots gjennomgang.
// Leser opplastede sider for NØYAKTIG én liste og lagrer bare FORSLAG. Skriver aldri tellede verdier.
// - Leasing: vt_ocr_claim gir attempt_id + lease; resultat/feil registreres bare med samme attempt_id.
// - Filbevis: serveren laster ned hver lagret side, beregner SHA-256/størrelse og sammenligner med jobben.
// - Bilder (JPEG/PNG) settes inn i PDF på serveren (pdf-lib), så det som leses er nøyaktig den lagrede filen.
// - Én avgrenset AI-kjøring per side. Feil/tidsavbrudd ⇒ «ukjent_ai_utfall», aldri automatisk ny kjøring.
// Gjenbruker ai_provider_config (formål invoice_extraction) og _shared/ai-providers + crypto uten endring.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { PDFDocument } from "npm:pdf-lib@1.17.1";
import { callAi, extractJson, type AiProvider } from "../_shared/ai-providers.ts";
import { decryptWithKey } from "../_shared/crypto.ts";
import { buildManifest, matchDocument, parseOcrPage, VT_OCR_MAX_PAGES, VT_OCR_SYSTEM_PROMPT, type ManifestLine, type OcrPage } from "./ocrCore.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface Original { path: string; sha256: string; size: number; mime: string }
interface Claim { attempt_id: string; count_id: string; list_id: string; template_revision: number; originals: Original[]; lines: ManifestLine[] }

async function sha256Hex(b: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function b64(bytes: Uint8Array): string { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); }

/** Én PDF per side, i opplastingsrekkefølge. */
async function pagesFrom(files: { o: Original; bytes: Uint8Array<ArrayBuffer> }[]): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for (const { o, bytes } of files) {
    if (o.mime === "application/pdf") {
      const src = await PDFDocument.load(bytes);
      for (const i of src.getPageIndices()) { const d = await PDFDocument.create(); const [pg] = await d.copyPages(src, [i]); d.addPage(pg); out.push(await d.save()); }
    } else {
      const d = await PDFDocument.create();
      const img = o.mime === "image/png" ? await d.embedPng(bytes) : await d.embedJpg(bytes);
      const pg = d.addPage([img.width, img.height]); pg.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height }); out.push(await d.save());
    }
    if (out.length > VT_OCR_MAX_PAGES) throw new Error("for mange sider");
  }
  return out;
}

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

  // 1) Leasing som innlogget bruker (tilgang, åpen telling/liste og status sjekkes under lås i SQL).
  const { data: claimData, error: claimErr } = await user.rpc("vt_ocr_claim", { p_job_id: jobId });
  if (claimErr) {
    const code = (claimErr as { code?: string }).code;
    return json(code === "42501" ? 403 : code === "55000" ? 409 : 400, { error: code === "55000" ? "Jobben er allerede tatt, lest eller har ukjent utfall. Ingen ny betalt lesing er startet." : "Kunne ikke starte lesingen." });
  }
  const c = claimData as Claim; const attempt = c.attempt_id;
  const fail = async (reason: string) => { await admin.rpc("vt_ocr_record_failure", { p_job_id: jobId, p_attempt_id: attempt, p_reason: reason }); return json(200, { status: "feilet", reason }); };

  // 2) Filbevis fra privat lagring.
  const files: { o: Original; bytes: Uint8Array<ArrayBuffer> }[] = [];
  for (const o of c.originals) {
    const f = await admin.storage.from("vt-count-uploads").download(o.path);
    if (f.error || !f.data) return fail("En opplastet side mangler i lagringen");
    const bytes = new Uint8Array(await f.data.arrayBuffer());
    if (bytes.length !== o.size || (await sha256Hex(bytes)) !== o.sha256) return fail("En lagret side stemmer ikke med registrert fil (SHA-256/størrelse)");
    files.push({ o, bytes });
  }
  let pdfPages: Uint8Array[];
  try { pdfPages = await pagesFrom(files); } catch { return fail(`Filene kunne ikke gjøres om til sider (maks ${VT_OCR_MAX_PAGES} sider per jobb)`); }
  const { error: pcErr } = await admin.rpc("vt_ocr_record_page_count", { p_job_id: jobId, p_attempt_id: attempt, p_pages: pdfPages.length });
  if (pcErr) return json(200, { status: "ukjent_lagring" });

  const { data: cfg } = await admin.from("ai_provider_config").select("provider, model, encrypted_api_key, azure_endpoint, azure_deployment")
    .eq("purpose", "invoice_extraction").eq("is_active", true).maybeSingle();
  if (!cfg) return fail("AI-leser er ikke konfigurert");
  let apiKey: string;
  try { apiKey = await decryptWithKey(cfg.encrypted_api_key as string, "AI_CONFIG_ENCRYPTION_KEY"); } catch { return fail("AI-nøkkelen kunne ikke leses"); }

  // 3) Én avgrenset kjøring per side. Første ukjente/ufullstendige utfall stopper jobben.
  const pages: OcrPage[] = [];
  for (let i = 0; i < pdfPages.length; i++) {
    let raw: string;
    try {
      const r = await callAi({ provider: cfg.provider as AiProvider, apiKey, model: cfg.model as string, maxTokens: 6000, temperature: 0,
        systemPrompt: VT_OCR_SYSTEM_PROMPT, userText: `Les denne siden (opplastet side ${i + 1} av ${pdfPages.length}).`, pdfBase64: b64(pdfPages[i]),
        azureEndpoint: (cfg.azure_endpoint as string | null) ?? undefined, azureDeployment: (cfg.azure_deployment as string | null) ?? undefined });
      raw = r.rawText;
    } catch {
      await admin.rpc("vt_ocr_record_unknown", { p_job_id: jobId, p_attempt_id: attempt, p_detail: `AI-kall for side ${i + 1} fikk ukjent utfall` });
      return json(200, { status: "ukjent_ai_utfall" });
    }
    try { pages.push(parseOcrPage(extractJson(raw))); }
    catch { return fail(`Lesesvaret for side ${i + 1} var ufullstendig eller hadde ugyldig form`); }
  }

  // 4) Identitetskontroll mot manifest og lagring med samme attempt_id.
  const result = matchDocument({ pages }, buildManifest(c.count_id, c.list_id, c.template_revision, c.lines));
  const { error: recErr } = await admin.rpc("vt_ocr_record_result", { p_job_id: jobId, p_attempt_id: attempt, p_document_ok: result.document_ok, p_issues: result.issues, p_proposals: result.proposals });
  if (recErr) return json(200, { status: "ukjent_lagring" });
  return json(200, { status: "klar", document_ok: result.document_ok, proposals: result.proposals.length, issues: result.issues.length });
});
