// EHF/PEPPOL UBL invoice importer
// - Parses UBL 2.1 / PEPPOL BIS Billing 3.0 XML
// - Looks up supplier by org_number, auto-creates if missing
// - Creates invoice + invoice_lines, returns invoice_id

import { createClient } from "npm:@supabase/supabase-js@2";
import { parse as parseXml } from "https://deno.land/x/xml@2.1.3/mod.ts";
import { normalizeUnit } from "../_shared/units.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function pickText(node: any): string | null {
  if (node == null) return null;
  if (typeof node === "string") return node.trim() || null;
  if (typeof node === "number") return String(node);
  if (typeof node === "object") {
    if ("#text" in node) return String(node["#text"]).trim() || null;
    // Some UBL fields are { @currencyID, #text } — already handled
  }
  return null;
}

function pickNumber(node: any): number | null {
  const t = pickText(node);
  if (t == null) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function normalizeOrgNumber(s: string | null): string | null {
  if (!s) return null;
  // Strip "0192:" PEPPOL scheme prefix and non-digits
  const digits = s.replace(/^0192:/i, "").replace(/\D/g, "");
  if (digits.length === 9) return digits;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonErr("Missing Authorization", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Auth client (RLS) — used for permission-respecting reads
    const supabaseAuthed = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    // Service client — used for writes after we've validated the user has invoice_access
    const supabaseAdmin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await supabaseAuthed.auth.getUser();
    const user = userRes?.user;
    if (!user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const xmlText: string | undefined = body?.xml;
    const storagePath: string | undefined = body?.storage_path;
    if (!xmlText) return jsonErr("Missing xml", 400);

    // ---- Parse UBL ----
    let parsed: any;
    try {
      parsed = parseXml(xmlText);
    } catch (e) {
      return jsonErr(`XML-parsing feilet: ${(e as Error).message}`, 400);
    }

    const root = parsed?.Invoice ?? parsed?.["ubl:Invoice"] ?? parsed;
    if (!root) return jsonErr("Fant ikke <Invoice> root", 400);

    // Helper to read namespaced or stripped keys
    const get = (obj: any, ...names: string[]) => {
      if (!obj) return undefined;
      for (const n of names) {
        if (n in obj) return obj[n];
        const cb = `cbc:${n}`;
        const cac = `cac:${n}`;
        if (cb in obj) return obj[cb];
        if (cac in obj) return obj[cac];
      }
      return undefined;
    };

    const invoiceNumber = pickText(get(root, "ID"));
    const issueDate = pickText(get(root, "IssueDate"));
    const dueDate = pickText(get(root, "DueDate"));
    const currency = pickText(get(root, "DocumentCurrencyCode")) ?? "NOK";

    const supplierParty = get(get(root, "AccountingSupplierParty"), "Party");
    const customerParty = get(get(root, "AccountingCustomerParty"), "Party");

    const supplierName =
      pickText(get(get(supplierParty, "PartyName"), "Name")) ??
      pickText(get(get(supplierParty, "PartyLegalEntity"), "RegistrationName"));

    const supplierOrgRaw =
      pickText(get(supplierParty, "EndpointID")) ??
      pickText(get(get(supplierParty, "PartyLegalEntity"), "CompanyID")) ??
      pickText(get(get(supplierParty, "PartyIdentification"), "ID"));
    const supplierOrg = normalizeOrgNumber(supplierOrgRaw);

    const customerOrgRaw =
      pickText(get(customerParty, "EndpointID")) ??
      pickText(get(get(customerParty, "PartyLegalEntity"), "CompanyID"));
    const customerOrg = normalizeOrgNumber(customerOrgRaw);
    const customerName =
      pickText(get(get(customerParty, "PartyName"), "Name")) ??
      pickText(get(get(customerParty, "PartyLegalEntity"), "RegistrationName"));

    if (!supplierName || !supplierOrg) {
      return jsonErr(
        `Mangler leverandør-navn eller org.nr i EHF (navn=${supplierName}, org=${supplierOrgRaw})`,
        400,
      );
    }
    if (!customerOrg) {
      return jsonErr("Fant ikke kunde-org.nr i EHF", 400);
    }

    // ---- Resolve legal_entity (customer) ----
    const { data: leMatches, error: leErr } = await supabaseAdmin
      .from("legal_entities")
      .select("id, legal_name, org_number")
      .eq("org_number", customerOrg);
    if (leErr) throw leErr;
    if (!leMatches || leMatches.length === 0) {
      return jsonErr(
        `Fant ingen registrert legal entity med org.nr ${customerOrg} (${customerName ?? "?"})`,
        404,
      );
    }
    const legalEntity = leMatches[0];

    // ---- Verify user has invoice_access on this legal entity ----
    const { data: hasAccess, error: accessErr } = await supabaseAuthed.rpc(
      "has_ravarer_invoice_access",
      { _legal_entity_id: legalEntity.id, _required_level: "write" },
    );
    if (accessErr) throw accessErr;
    if (!hasAccess) {
      return jsonErr("Du har ikke skrivetilgang til fakturaer for dette selskapet", 403);
    }

    // ---- Find or auto-create supplier ----
    const { data: existingSuppliers, error: supLookupErr } = await supabaseAdmin
      .from("suppliers")
      .select("id, name, org_number")
      .eq("legal_entity_id", legalEntity.id)
      .eq("org_number", supplierOrg)
      .limit(1);
    if (supLookupErr) throw supLookupErr;

    let supplierId: string;
    let supplierCreated = false;
    if (existingSuppliers && existingSuppliers.length > 0) {
      supplierId = existingSuppliers[0].id;
    } else {
      const { data: newSupplier, error: insErr } = await supabaseAdmin
        .from("suppliers")
        .insert({
          legal_entity_id: legalEntity.id,
          name: supplierName,
          org_number: supplierOrg,
          is_active: true,
          notes: "Auto-opprettet fra EHF-import",
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      supplierId = newSupplier.id;
      supplierCreated = true;
    }

    // ---- Totals ----
    const monetary = get(root, "LegalMonetaryTotal");
    const totalNet = pickNumber(get(monetary, "LineExtensionAmount")) ?? 0;
    const totalAmount =
      pickNumber(get(monetary, "PayableAmount")) ??
      pickNumber(get(monetary, "TaxInclusiveAmount")) ??
      0;
    const totalVat = Math.max(0, totalAmount - totalNet);

    // Duplicate check
    const { data: dupes } = await supabaseAdmin
      .from("invoices")
      .select("id")
      .eq("legal_entity_id", legalEntity.id)
      .eq("supplier_id", supplierId)
      .eq("invoice_number", invoiceNumber ?? "")
      .limit(1);
    if (dupes && dupes.length > 0) {
      return jsonErr(`Faktura ${invoiceNumber} fra denne leverandøren er allerede importert`, 409);
    }

    // ---- Create invoice ----
    const { data: invoice, error: invErr } = await supabaseAdmin
      .from("invoices")
      .insert({
        legal_entity_id: legalEntity.id,
        supplier_id: supplierId,
        invoice_number: invoiceNumber ?? "(ukjent)",
        invoice_date: issueDate ?? new Date().toISOString().slice(0, 10),
        due_date: dueDate ?? null,
        currency,
        total_amount: totalAmount,
        total_vat: totalVat,
        source: "ehf",
        lines_source: "ehf_attachment",
        source_document_url: storagePath ?? null,
        status: "imported",
      })
      .select("id")
      .single();
    if (invErr) throw invErr;

    // ---- Lines ----
    const rawLines = asArray(get(root, "InvoiceLine"));
    const linesToInsert = rawLines.map((ln: any, idx: number) => {
      const item = get(ln, "Item");
      const price = get(ln, "Price");
      const desc =
        pickText(get(item, "Name")) ??
        pickText(get(item, "Description")) ??
        `Linje ${idx + 1}`;
      const qty = pickNumber(get(ln, "InvoicedQuantity")) ?? 1;
      const unitPrice = pickNumber(get(price, "PriceAmount")) ?? 0;
      const lineNet = pickNumber(get(ln, "LineExtensionAmount")) ?? qty * unitPrice;
      const supplierItemNumber =
        pickText(get(get(item, "SellersItemIdentification"), "ID")) ?? null;
      const unitCode =
        (typeof get(ln, "InvoicedQuantity") === "object"
          ? (get(ln, "InvoicedQuantity") as any)["@unitCode"]
          : null) ?? null;
      return {
        invoice_id: invoice.id,
        line_number: idx + 1,
        description: desc,
        supplier_sku: supplierItemNumber,
        quantity: qty,
        unit: normalizeUnit(unitCode) ?? unitCode,
        unit_price: unitPrice,
        total_amount: lineNet,
      };
    });

    if (linesToInsert.length > 0) {
      const { error: linesErr } = await supabaseAdmin.from("invoice_lines").insert(linesToInsert);
      if (linesErr) throw linesErr;
    }

    return new Response(
      JSON.stringify({
        invoice_id: invoice.id,
        supplier_id: supplierId,
        supplier_created: supplierCreated,
        supplier_name: supplierName,
        line_count: linesToInsert.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("import-ehf-invoice error:", e);
    return jsonErr((e as Error).message ?? "Ukjent feil", 500);
  }
});

function jsonErr(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
