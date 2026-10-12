// FORSLAG — IKKE UTRULLET. Flyttes til supabase/functions/vt-count-report-email/ først etter roots gjennomgang.
// Handlinger:
//  - "preview": koherent øyeblikksbilde (én SQL-setning) → CSV + PDF + versjons-hash. Vedleggene returneres for forhåndsvisning.
//  - "status":  SKRIVEBESKYTTET oppslag av lagret operasjon. Sender aldri.
//  - "send":    sjekker lagret operasjon FØRST. Finnes den: «reservert» fullføres med LAGREDE vedlegg; alt annet returneres
//               uendret. Finnes den ikke: nytt øyeblikksbilde, hash må være lik forhåndsvisningen, reservasjon lagrer
//               øyeblikksbilde + nøyaktige vedlegg, så én sending. Graph 202 = akseptert av tjenesten, ikke levert.
// Avsender er den allerede godkjente Microsoft 365-postboksen (microsoft_oauth_tokens.account_email), samme som
// eksisterende sendinger. getGraphAccessToken gjenbrukes uendret; microsoft-graph-send røres ikke.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGraphAccessToken } from "../_shared/graph-mail.ts";
import type { VtReportData } from "../_shared/vtReport.ts";
import { attachmentBase, attachmentHash, b64, buildGraphMessage, buildReportCsv, buildReportPdf, classifyGraph, defaultSubject, isFinal, summarizeLines, validateMail } from "./reportCore.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Admin = ReturnType<typeof createClient>;

async function senderMailbox(admin: Admin): Promise<string | null> {
  if (!Deno.env.get("MICROSOFT_GRAPH_TENANT_ID") || !Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID") || !Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET")) return null;
  const { data } = await admin.from("microsoft_oauth_tokens").select("account_email").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const m = (data as { account_email?: unknown } | null)?.account_email;
  return typeof m === "string" && m.includes("@") ? m : null;
}

async function sendStored(admin: Admin, opId: string): Promise<Response> {
  const claim = await admin.rpc("vt_report_mail_claim", { p_op_id: opId });
  if (claim.error) return json(200, { state: "reservert", detail: "Sendingen kunne ikke startes. Den er fortsatt bare reservert — ingenting er sendt." });
  const c = claim.data as { claimed: boolean; state: string; recipient?: string; subject?: string; message?: string; csv?: string; pdf_b64?: string; attachment_base?: string; final?: boolean; sender?: string };
  if (!c.claimed) return json(200, { state: c.state, replayed: true });
  let status: number | null = null; let detail: string | null = null;
  try {
    const token = await getGraphAccessToken(admin);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(String(c.sender))}/sendMail`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildGraphMessage({ recipient: String(c.recipient), subject: String(c.subject), message: String(c.message) }, c.final === true, String(c.csv), String(c.pdf_b64), String(c.attachment_base))),
    });
    status = res.status; if (status !== 202) detail = `Microsoft svarte ${status}`; await res.body?.cancel();
  } catch (e) {
    if (e instanceof Error && /konfigurert|koblet/.test(e.message)) { status = 400; detail = "Microsoft 365 er ikke konfigurert"; }
    else detail = "Nettverksfeil eller tidsavbrudd — ukjent om e-posten ble sendt";
  }
  const state = classifyGraph(status);
  const fin = await admin.rpc("vt_report_mail_finish", { p_op_id: opId, p_state: state, p_detail: detail });
  return json(200, { state: fin.error ? "ukjent" : state, detail });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Bare POST" });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { error: "Ikke innlogget" });
  let b: Record<string, unknown>; try { const v = await req.json(); if (typeof v !== "object" || v === null) throw 0; b = v as Record<string, unknown>; } catch { return json(400, { error: "Ugyldig forespørsel" }); }
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Lagret operasjon først — både for status og send.
  if (b.action === "status" || b.action === "send") {
    if (typeof b.op_id !== "string" || !UUID.test(b.op_id)) return json(400, { error: "op_id mangler" });
    const st = await user.rpc("vt_report_mail_status", { p_op_id: b.op_id });
    if (st.error) return json((st.error as { code?: string }).code === "42501" ? 403 : 500, { error: "Kunne ikke lese sendingen." });
    const found = st.data as { found: boolean; state?: string; detail?: string | null } | null;
    if (b.action === "status") return json(200, found?.found ? { found: true, state: found.state, detail: found.detail ?? null } : { found: false });
    if (found?.found) return found.state === "reservert" ? sendStored(admin, b.op_id) : json(200, { state: found.state, detail: found.detail ?? null, replayed: true });
  }

  const countId = b.count_id;
  if (typeof countId !== "string" || !UUID.test(countId)) return json(400, { error: "count_id mangler" });
  // generatedAt settes av SQL til dataversjonen (siste endring), så samme data gir samme vedlegg/hash.
  // Koherent øyeblikksbilde med BRUKERENS tilgang (RLS + _vt_require i SQL), ingen radgrense.
  const snap = await user.rpc("vt_report_snapshot", { p_count_id: countId });
  if (snap.error) return json((snap.error as { code?: string }).code === "42501" ? 403 : 409, { error: "Kunne ikke lese rapporten." });
  const data = snap.data as VtReportData;
  const csv = buildReportCsv(data); const pdfB64 = b64(buildReportPdf(data)); const hash = await attachmentHash(csv, pdfB64);
  const sender = await senderMailbox(admin);

  if (b.action === "preview") {
    return json(200, { hash, count_revision: data.count.revision, final: isFinal(data.count), default_subject: defaultSubject(data), attachment_base: attachmentBase(data),
      csv, pdf_b64: pdfB64, totals: summarizeLines(data.lines), mail_configured: sender != null });
  }
  if (b.action !== "send") return json(400, { error: "Ukjent handling" });
  const mail = { recipient: String(b.recipient ?? ""), subject: String(b.subject ?? ""), message: String(b.message ?? "") };
  const bad = validateMail(mail); if (bad) return json(400, { error: bad });
  if (b.hash !== hash) return json(409, { error: "Rapporten er endret siden forhåndsvisningen. Åpne forhåndsvisningen på nytt." });
  if (!sender) return json(503, { error: "Microsoft 365-avsender er ikke koblet til." });
  const r = await user.rpc("vt_report_mail_reserve", { p_op_id: b.op_id, p_count_id: countId, p_count_revision: data.count.revision, p_report_hash: hash,
    p_recipient: mail.recipient.trim(), p_subject: mail.subject.trim(), p_message: mail.message, p_snapshot: data, p_csv: csv, p_pdf_b64: pdfB64,
    p_attachment_base: attachmentBase(data), p_final: isFinal(data.count), p_sender: sender });
  if (r.error) return json((r.error as { code?: string }).code === "42501" ? 403 : 409, { error: "Kunne ikke reservere sendingen. Ingenting er sendt." });
  return sendStored(admin, String(b.op_id));
});
