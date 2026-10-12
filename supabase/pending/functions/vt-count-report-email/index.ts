// FORSLAG — IKKE UTRULLET. Flyttes til supabase/functions/vt-count-report-email/ først etter roots gjennomgang.
// action "preview": bygger rapport fra lagrede frosne verdier og returnerer versjons-hash (ingen sending).
// action "send": reserverer operasjon (op-id, hash, mottaker) i SQL, sender ÉN gang via Microsoft Graph med
// CSV+PDF-vedlegg. Graph 202 = akseptert av e-posttjenesten, ikke levert. Nett-/tidsfeil = «ukjent»,
// sendes ALDRI automatisk på nytt. Gjenbruker felles getGraphAccessToken (krypterte token) uten å endre den.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGraphAccessToken } from "../_shared/graph-mail.ts";
import { buildGraphMessage, buildReportCsv, buildSimplePdf, classifyGraph, defaultSubject, reportTotals, sha256Hex, validateMail,
  type ReportCount, type ReportLine, type ReportList } from "./reportCore.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_COLS = "id, count_list_id, sort_order, snap_name, snap_sku, snap_location_name, snap_base_unit, snap_price_per_base, snap_price_source, snap_price_reason, state, counted_base, revision";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Bare POST" });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return json(401, { error: "Ikke innlogget" });
  let b: Record<string, unknown>; try { const v = await req.json(); if (typeof v !== "object" || v === null) throw 0; b = v as Record<string, unknown>; } catch { return json(400, { error: "Ugyldig forespørsel" }); }
  const countId = b.count_id;
  if (typeof countId !== "string" || !UUID.test(countId)) return json(400, { error: "count_id mangler" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Data leses med BRUKERENS klient: RLS avgjør firma/tilgang. Ingen vilkårlig datatilgang via service.
  const c = await user.from("vt_counts").select("id, name, planned_date, status, revision, valuation_mode, valuation_date").eq("id", countId).maybeSingle();
  if (c.error || !c.data) return json(404, { error: "Fant ikke tellingen" });
  const count = c.data as ReportCount;
  if (count.status === "planlagt") return json(409, { error: "Tellingen er ikke startet" });
  const lists = await user.from("vt_count_lists").select("id, name, department, status, sort_order").eq("count_id", countId).order("sort_order").limit(500);
  const lines = await user.from("vt_count_lines").select(LINE_COLS, { count: "exact" }).eq("count_id", countId).order("id").range(0, 9999);
  if (lists.error || lines.error || (lines.count ?? -1) !== (lines.data?.length ?? -2)) return json(500, { error: "Kunne ikke lese hele rapporten" });
  const csv = buildReportCsv(count, lists.data as ReportList[], lines.data as ReportLine[]);
  const hash = await sha256Hex(csv);
  const totals = reportTotals(lines.data as ReportLine[]);
  const base = `varetelling-${count.planned_date}-r${count.revision}`;

  if (b.action === "preview") {
    return json(200, { hash, count_revision: count.revision, final: count.status === "avsluttet", default_subject: defaultSubject(count), attachments: [`${base}.csv`, `${base}.pdf`], totals,
      mail_configured: !!(Deno.env.get("MICROSOFT_GRAPH_TENANT_ID") && Deno.env.get("MICROSOFT_GRAPH_CLIENT_ID") && Deno.env.get("MICROSOFT_GRAPH_CLIENT_SECRET") && Deno.env.get("VT_REPORT_MAIL_FROM")) });
  }
  if (b.action !== "send") return json(400, { error: "Ukjent handling" });
  const mail = { recipient: String(b.recipient ?? ""), subject: String(b.subject ?? ""), message: String(b.message ?? "") };
  const bad = validateMail(mail); if (bad) return json(400, { error: bad });
  if (typeof b.op_id !== "string" || !UUID.test(b.op_id)) return json(400, { error: "op_id mangler" });
  if (b.hash !== hash || b.count_revision !== count.revision) return json(409, { error: "Rapporten er endret siden forhåndsvisningen. Åpne forhåndsvisningen på nytt." });
  const from = Deno.env.get("VT_REPORT_MAIL_FROM");
  if (!from) return json(503, { error: "Avsenderadresse for tellerapporter er ikke konfigurert." });

  // Reserver (bruker-JWT: tilgangssjekk, idempotent på op-id+innhold).
  const r = await user.rpc("vt_report_mail_reserve", { p_op_id: b.op_id, p_count_id: countId, p_count_revision: count.revision, p_report_hash: hash,
    p_recipient: mail.recipient.trim(), p_subject: mail.subject.trim(), p_message: mail.message });
  if (r.error) return json((r.error as { code?: string }).code === "42501" ? 403 : 409, { error: "Kunne ikke reservere sendingen." });
  // Ta sendingen (service): bare «reservert» kan sendes. Allerede sendt/ukjent returneres uendret — aldri ny sending.
  const claim = await admin.rpc("vt_report_mail_claim", { p_op_id: b.op_id });
  if (claim.error) return json(200, { state: "ukjent" });
  const claimed = claim.data as { claimed: boolean; state: string };
  if (!claimed.claimed) return json(200, { state: claimed.state, replayed: true });

  let status: number | null = null; let detail: string | null = null;
  try {
    const token = await getGraphAccessToken(admin);
    const pdf = buildSimplePdf(defaultSubject(count), csv.split("\r\n").filter(Boolean).map(l => l.replace(/;/g, "  ")));
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildGraphMessage(mail, count, totals, csv, pdf, base)),
    });
    status = res.status; if (status !== 202) detail = `Graph ${status}`; await res.body?.cancel();
  } catch (e) {
    detail = e instanceof Error && /konfigurert|koblet/.test(e.message) ? "Microsoft 365 er ikke konfigurert" : "Nettverksfeil eller tidsavbrudd";
    if (detail.startsWith("Microsoft")) status = 400; // konfigurasjon: sikkert ikke sendt
  }
  const state = classifyGraph(status);
  await admin.rpc("vt_report_mail_finish", { p_op_id: b.op_id, p_state: state, p_detail: detail });
  return json(200, { state, detail });
});
