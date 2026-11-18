// EHF-test (bestilling 18.11.2026) – REN LESENDE testfunksjon. Klar for utrulling – venter på ja fra Henrik.
//
// Hva den gjør, for ÉN faktura per kall (valgt i Råvarer › Innstillinger › Fakturalesing › EHF-test):
//   1. Sjekker at innlogget bruker er godkjenner/admin for selskapet (has_ravarer_invoice_approve).
//   2. Leser fakturaens Tripletex-ID-er fra invoices (bare SELECT).
//   3. Sender bare GET-kall til Tripletex (samme tilkobling/nøkler som i dag):
//        GET /v2/supplierInvoice/{id}?fields=…          (fakturahode, bilag, orderLines)
//        GET /v2/ledger/voucher/{voucherId}?fields=…    (ediDocument / attachment / document)
//        GET /v2/document/{docId}                       (metadata for hvert dokument som ble funnet)
//        GET /v2/document/{docId}/content               (selve filen: EHF-XML eller PDF)
//        GET /v2/incomingInvoice/{voucherId}?fields=*   (beta; kan gi strukturerte linjer)
//   4. Returnerer en logg per kall (endepunkt, HTTP-status, type, størrelse, Tripletex' feiltekst), eventuell
//      EHF-XML (uten innebygde vedlegg) og eventuelle orderLines til nettleseren. PDF-innhold sendes ikke videre.
//
// Den skriver ALDRI til fakturaer, linjer, varer eller storage. Eneste skriving er den samme som alle
// Tripletex-funksjoner gjør: getSessionToken kan fornye og bufre sesjonsnøkkelen i tripletex_credentials.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { baseUrl, authHeader, getSessionToken } from "../_shared/tripletex.ts";
import {
  containsUbl, documentIdsFrom, MAX_CONTENT_BYTES, MAX_XML_CHARS, sniffContent, stripEmbeddedBinaries,
  SUPPLIER_INVOICE_FIELDS, tripletexMessage, unwrapValue, VOUCHER_FIELDS, xmlRootName, type ContentKind,
} from "./probe.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ProbeLog {
  step: string;
  path: string;
  status: number | null;
  content_type: string | null;
  bytes: number;
  kind: ContentKind;
  note: string | null;
  tripletex_message: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, code: "ugyldig", message: "Bare POST." }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const body = (await req.json().catch(() => null)) as { legal_entity_id?: unknown; invoice_id?: unknown } | null;
  const legalEntityId = typeof body?.legal_entity_id === "string" ? body.legal_entity_id : "";
  const invoiceId = typeof body?.invoice_id === "string" ? body.invoice_id : "";
  if (!UUID.test(legalEntityId) || !UUID.test(invoiceId)) {
    return json({ ok: false, code: "ugyldig", message: "legal_entity_id og invoice_id må være gyldige ID-er." }, 400);
  }

  // Tilgang: innlogget godkjenner/admin for selskapet. Ingen cron- eller tjenestevei.
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!bearer) return json({ ok: false, code: "ikke_innlogget", message: "Ikke innlogget." }, 401);
  const userClient = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, code: "ikke_innlogget", message: "Ikke innlogget." }, 401);
  const { data: canApprove, error: rightErr } = await userClient.rpc("has_ravarer_invoice_approve", { _legal_entity_id: legalEntityId });
  if (rightErr) return json({ ok: false, code: "tilgang_ukjent", message: "Kunne ikke kontrollere tilgangen." }, 503);
  if (canApprove !== true) return json({ ok: false, code: "ingen_tilgang", message: "Bare godkjenner eller admin kan kjøre EHF-testen." }, 403);

  const { data: inv, error: invErr } = await admin
    .from("invoices")
    .select("id, legal_entity_id, invoice_number, tripletex_supplier_invoice_id, tripletex_voucher_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (invErr) return json({ ok: false, code: "lesefeil", message: "Kunne ikke lese fakturaen." }, 503);
  if (!inv || inv.legal_entity_id !== legalEntityId) return json({ ok: false, code: "ukjent_faktura", message: "Fakturaen finnes ikke i selskapet." }, 404);
  if (!inv.tripletex_supplier_invoice_id) {
    return json({ ok: false, code: "ikke_tripletex", message: "Fakturaen er ikke hentet fra Tripletex." }, 422);
  }

  let token: string;
  try {
    token = await getSessionToken(admin, legalEntityId);
  } catch (e) {
    return json({ ok: false, code: "tripletex_tilkobling", message: e instanceof Error ? e.message : "Tripletex-tilkoblingen feilet." }, 502);
  }
  let renewed = false;
  const logs: ProbeLog[] = [];

  /** Ett GET-kall. Fornyer sesjonen én gang ved 401 og venter én gang ved 429. */
  async function probe(step: string, path: string, query: Record<string, string>, accept: string) {
    const url = new URL(baseUrl() + path);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const shown = url.pathname + (url.search ? decodeURIComponent(url.search) : "");
    for (let attempt = 0; attempt < 3; attempt++) {
      let res: Response;
      try {
        res = await fetch(url.toString(), { method: "GET", headers: { Authorization: authHeader(token), Accept: accept } });
      } catch (e) {
        logs.push({ step, path: shown, status: null, content_type: null, bytes: 0, kind: "tom", note: `Nettverksfeil: ${e instanceof Error ? e.message : "ukjent"}`, tripletex_message: null });
        return null;
      }
      if (res.status === 401 && !renewed) {
        await res.body?.cancel();
        renewed = true;
        try { token = await getSessionToken(admin, legalEntityId, true); continue; } catch { /* logges under som 401 */ }
      }
      if (res.status === 429 && attempt < 2) {
        await res.body?.cancel();
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const ct = res.headers.get("content-type");
      const declared = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declared) && declared > MAX_CONTENT_BYTES) {
        await res.body?.cancel();
        logs.push({ step, path: shown, status: res.status, content_type: ct, bytes: declared, kind: "ukjent", note: "For stort til å leses i testen.", tripletex_message: null });
        return null;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const kind = sniffContent(bytes, ct);
      const text = kind === "json" || kind === "xml" || kind === "tekst" ? new TextDecoder().decode(bytes) : null;
      const message = res.ok ? null : tripletexMessage(text ?? "");
      logs.push({ step, path: shown, status: res.status, content_type: ct, bytes: bytes.length, kind, note: null, tripletex_message: message });
      return { status: res.status, ok: res.ok, kind, text, log: logs[logs.length - 1] };
    }
    return null;
  }

  async function probeJson(step: string, path: string, fieldsList: string[]): Promise<Record<string, unknown> | null> {
    for (const fields of fieldsList) {
      const r = await probe(step, path, { fields }, "application/json");
      if (!r) return null;
      if (r.ok && r.kind === "json" && r.text) {
        try { return unwrapValue(JSON.parse(r.text)); } catch { r.log.note = "Svaret var ikke gyldig JSON."; return null; }
      }
      if (r.status !== 400) return null; // bare ukjent felt-utvalg (400) prøves på nytt med enklere utvalg
      r.log.note = "Felt-utvalget ble avvist; prøver et enklere utvalg.";
    }
    return null;
  }

  const si = await probeJson("Leverandørfaktura", `/v2/supplierInvoice/${inv.tripletex_supplier_invoice_id}`, SUPPLIER_INVOICE_FIELDS);
  const siVoucher = si?.voucher && typeof si.voucher === "object" ? (si.voucher as Record<string, unknown>) : null;
  const voucherId = inv.tripletex_voucher_id ?? (siVoucher && siVoucher.id != null ? String(siVoucher.id) : null);
  const voucher = voucherId ? await probeJson("Bilag", `/v2/ledger/voucher/${voucherId}`, VOUCHER_FIELDS) : null;
  if (!voucherId) logs.push({ step: "Bilag", path: "-", status: null, content_type: null, bytes: 0, kind: "tom", note: "Fakturaen har ingen bilags-ID.", tripletex_message: null });

  let xml: { document_id: string; source: string; root: string | null; ubl: string | null; text: string; removed_embedded: number; removed_bytes: number; truncated: boolean } | null = null;
  const docs = documentIdsFrom(si, voucher).slice(0, 4);
  if (docs.length === 0) logs.push({ step: "Originaldokument", path: "-", status: null, content_type: null, bytes: 0, kind: "tom", note: "Verken fakturaen eller bilaget peker til et dokument (ediDocument/attachment).", tripletex_message: null });
  for (const d of docs) {
    await probe(`Dokument ${d.id} (metadata, ${d.source})`, `/v2/document/${d.id}`, { fields: "*" }, "application/json");
    const c = await probe(`Dokument ${d.id} (innhold, ${d.source})`, `/v2/document/${d.id}/content`, {}, "*/*");
    if (c?.ok && c.kind === "xml" && c.text && !xml) {
      const stripped = stripEmbeddedBinaries(c.text);
      const truncated = stripped.xml.length > MAX_XML_CHARS;
      xml = {
        document_id: d.id, source: d.source, root: xmlRootName(stripped.xml), ubl: containsUbl(stripped.xml),
        text: truncated ? "" : stripped.xml, removed_embedded: stripped.removed, removed_bytes: stripped.removedBytes, truncated,
      };
      c.log.note = xml.ubl ? `EHF/UBL ${xml.ubl}${stripped.removed ? ` (${stripped.removed} innebygd vedlegg fjernet)` : ""}` : `XML med rot «${xml.root ?? "ukjent"}» (ikke UBL)`;
    }
  }

  let incoming: Record<string, unknown> | null = null;
  if (voucherId) incoming = await probeJson("Inngående faktura (beta)", `/v2/incomingInvoice/${voucherId}`, ["*"]);

  const rawOrderLines = Array.isArray(si?.orderLines) ? (si!.orderLines as unknown[]) : null;
  const incomingText = incoming ? JSON.stringify(incoming) : null;

  console.log(JSON.stringify({ fn: "tripletex-ehf-test", invoice: inv.id, calls: logs.map((l) => `${l.status ?? "-"} ${l.kind} ${l.path.split("?")[0]}`), xml: xml?.ubl ?? null }));

  return json({
    ok: true,
    invoice_id: inv.id,
    tripletex: { supplier_invoice_id: inv.tripletex_supplier_invoice_id, voucher_id: voucherId },
    probes: logs,
    supplier_invoice: si
      ? { invoice_number: si.invoiceNumber ?? null, amount: si.amount ?? null, amount_excl_vat: si.amountExcludingVat ?? null, is_credit_note: si.isCreditNote ?? null, currency: si.currency ?? null }
      : null,
    xml,
    order_lines: rawOrderLines,
    incoming_invoice: incomingText && incomingText.length <= 500_000 ? incoming : null,
  });
});
