// Sender originalfakturaen (PDF) som vedlegg via Microsoft Graph fra fast avsender.
// Forespørsel: { invoice_id, to, message? }. Krever innlogget bruker med fakturatilgang.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { getGraphAccessToken } from "../_shared/graph-mail.ts";

const SENDER = "Henrik@nottero-bakeri.no";
const MAX_BYTES = 3 * 1024 * 1024; // Graph sendMail tåler ca. 3 MB vedlegg i én forespørsel.
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, code: "metode" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth)) return json(401, { ok: false, code: "not_authenticated" });
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, service);
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json(401, { ok: false, code: "not_authenticated" });

  const body = await req.json().catch(() => null) as { invoice_id?: unknown; to?: unknown; message?: unknown } | null;
  const invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id : "";
  const to = typeof body?.to === "string" ? body.to.trim() : "";
  const message = typeof body?.message === "string" ? body.message.slice(0, 4000) : "";
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) return json(400, { ok: false, code: "ugyldig_faktura" });
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to) || to.length > 254) return json(400, { ok: false, code: "ugyldig_mottaker" });

  // Lest som brukeren: RLS avgjør om fakturaen er synlig.
  const { data: inv, error: invErr } = await user.from("invoices")
    .select("id, legal_entity_id, invoice_number, invoice_date, source_document_url, suppliers(name)").eq("id", invoiceId).maybeSingle();
  if (invErr) return json(500, { ok: false, code: "lesefeil" });
  if (!inv) return json(404, { ok: false, code: "ikke_funnet" });
  const { data: access } = await user.rpc("has_ravarer_invoice_access", { _legal_entity_id: inv.legal_entity_id, _required_level: "read" });
  if (access !== true) return json(403, { ok: false, code: "ingen_tilgang" });
  if (!inv.source_document_url) return json(409, { ok: false, code: "mangler_original" });

  const { data: file, error: dlErr } = await admin.storage.from("invoice-pdfs").download(inv.source_document_url);
  if (dlErr || !file) return json(502, { ok: false, code: "nedlasting_feilet" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > MAX_BYTES) return json(413, { ok: false, code: "for_stor" });

  const supplier = (inv.suppliers as { name?: string } | null)?.name ?? "";
  const subject = `Faktura ${inv.invoice_number}${supplier ? ` – ${supplier}` : ""}`;
  const html = `<p>${esc(message || "Vedlagt følger faktura.").replace(/\n/g, "<br/>")}</p><p style="font-size:12px;color:#6b6b6b">Faktura ${esc(String(inv.invoice_number))}${supplier ? ` fra ${esc(supplier)}` : ""}, datert ${esc(String(inv.invoice_date ?? ""))}.</p>`;

  try {
    const token = await getGraphAccessToken(admin);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(SENDER)}/sendMail`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: html },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: [{ "@odata.type": "#microsoft.graph.fileAttachment", name: `Faktura-${String(inv.invoice_number).replace(/[^\w.-]+/g, "_")}.pdf`, contentType: "application/pdf", contentBytes: b64(bytes) }],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      console.error("graph sendMail", res.status, (await res.text()).slice(0, 300));
      return json(502, { ok: false, code: "sending_avvist" });
    }
  } catch (e) {
    console.error("graph", e instanceof Error ? e.message : "ukjent");
    return json(502, { ok: false, code: "ukjent_utfall" });
  }
  console.log("invoice mail sent", { invoice: invoiceId, by: u.user.id });
  return json(200, { ok: true, sender: SENDER });
});
