// Henter PDF fra Tripletex for importerte leverandørfakturaer, lagrer den i storage,
// leser ut varelinjer via extract-invoice-from-pdf og kjører match-invoice-lines.
// Kjøres av cron (små porsjoner) eller manuelt per faktura fra fakturadetaljsiden.
//
// Priskontroll v2:
//  - Uthentingen får KONTROLLFAKTA fra Tripletex (sum eks./inkl. mva, leverandør, fakturanr)
//    og KJENTE VARER for leverandøren, slik at varenummer og beløp leses konsekvent.
//  - Mva-beløp som mangler på fakturahodet hentes fra bilagets posteringer (konto 27xx),
//    ellers utledes det deterministisk fra linjesummen (rm_repair_invoice_vat).
//  - Linjetype (vare/pant/frakt/gebyr …) lagres på linjen, så motoren kan utelate det som ikke er varer.
//  - Rettet: bilagsoppslaget manglet «/v2» og ga aldri hovedbokskonto.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, baseUrl, authHeader } from "../_shared/tripletex.ts";
import { parsePackageFromDescription } from "../_shared/units.ts";
import { computeLinesSum, needsReviewFromConfidence } from "../_shared/lines-sum.ts";
import { planLineExtractionFailure } from "./failure-plan.ts";
import { pickLedgerAccount, vatFromPostings } from "./ledger-account.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Body {
  legal_entity_id?: string;
  limit?: number;
  invoice_id?: string;
  retry_failed?: boolean;
}

async function authorize(
  req: Request,
  admin: ReturnType<typeof createClient>,
  legalEntityId: string,
): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authorization = req.headers.get("Authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  if (bearer && bearer === serviceKey) return true;

  const cronSecret = req.headers.get("X-Cron-Secret");
  if (cronSecret) {
    const { data, error } = await admin.rpc("verify_cron_secret", { p_secret: cronSecret });
    if (!error && data === true) return true;
  }

  if (bearer) {
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: `Bearer ${bearer}` } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (userData?.user) {
      const { data: hasAccess } = await userClient.rpc("has_ravarer_invoice_access", {
        _legal_entity_id: legalEntityId,
        _required_level: "admin",
      });
      if (hasAccess === true) return true;
    }
  }
  return false;
}

// Base64 i biter — String.fromCharCode.apply på hele PDF-en sprenger stakken.
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const LINE_KINDS = new Set(["vare", "pant", "frakt", "gebyr", "rabatt", "avrunding", "mva", "annet"]);

/** Kjente varer hos leverandøren: koblingens varenummer/navn + bekreftede alias. */
async function knownItemsForSupplier(
  admin: ReturnType<typeof createClient>,
  supplierId: string,
): Promise<Array<{ sku: string | null; name: string | null }>> {
  const { data: rms } = await admin
    .from("raw_material_suppliers")
    .select("id, supplier_sku, supplier_product_name, raw_materials(name)")
    .eq("supplier_id", supplierId)
    .limit(200);
  const rows = (rms ?? []) as any[];
  const ids = rows.map((r) => r.id);
  const bySku = new Map<string, string>();
  for (const r of rows) {
    const sku = r.supplier_sku ? String(r.supplier_sku).trim() : null;
    const name = r.supplier_product_name ?? r.raw_materials?.name ?? null;
    if (sku) bySku.set(sku, name ?? "");
  }
  if (ids.length) {
    const { data: aliases } = await admin
      .from("raw_material_supplier_aliases")
      .select("raw_material_supplier_id, alias_type, alias_value")
      .in("raw_material_supplier_id", ids)
      .eq("status", "confirmed")
      .limit(400);
    const nameByRms = new Map<string, string>();
    for (const r of rows) nameByRms.set(r.id, r.supplier_product_name ?? r.raw_materials?.name ?? "");
    for (const a of (aliases ?? []) as any[]) {
      if (a.alias_type !== "supplier_sku") continue;
      const sku = String(a.alias_value ?? "").trim();
      if (sku && !bySku.has(sku)) bySku.set(sku, nameByRms.get(a.raw_material_supplier_id) ?? "");
    }
  }
  return [...bySku.entries()].slice(0, 150).map(([sku, name]) => ({ sku, name: name || null }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    const legalEntityId = body.legal_entity_id ?? "";
    if (!legalEntityId) return json({ error: "legal_entity_id required" }, 400);
    if (!(await authorize(req, admin, legalEntityId))) {
      return json({ error: "Unauthorized" }, 401);
    }

    // retry_failed er en no-op: kø-RPC-en avgjør selv hvilke fakturaer som kan claimes.
    const limit = Math.max(1, Math.min(50, Number(body.limit ?? 20)));

    const { data: invoices, error: invErr } = await admin.rpc("rm_claim_invoice_line_extraction", {
      p_legal_entity_id: legalEntityId,
      p_limit: limit,
      p_invoice_id: body.invoice_id ?? null,
    });
    if (invErr) throw new Error(invErr.message);

    let behandlet = 0;
    let vellykket = 0;
    let feilet = 0;
    const detaljer: Array<Record<string, unknown>> = [];

    if ((invoices ?? []).length > 0) {
      const sessionToken = await getSessionToken(admin, legalEntityId);
      const knownCache = new Map<string, Array<{ sku: string | null; name: string | null }>>();

      for (const inv of invoices ?? []) {
        behandlet++;
        const ttId = inv.tripletex_supplier_invoice_id as string;
        try {
          // 0) Fakturahode med leverandør (kontrollfakta til uthentingen)
          const { data: head } = await admin
            .from("invoices")
            .select("id, supplier_id, invoice_number, total_amount, total_vat, currency, suppliers(name)")
            .eq("id", inv.id)
            .maybeSingle();
          const supplierId = (head as any)?.supplier_id as string | null;
          const supplierName = (head as any)?.suppliers?.name ?? null;
          let totalAmount = num((head as any)?.total_amount ?? inv.total_amount);
          let totalVat = num((head as any)?.total_vat ?? inv.total_vat);

          // 1) Hent PDF
          const url = `${baseUrl()}/v2/supplierInvoice/${ttId}/pdf`;
          const res = await fetch(url, {
            headers: { Authorization: authHeader(sessionToken), Accept: "application/octet-stream" },
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw Object.assign(new Error(`Tripletex ${res.status}: ${text.slice(0, 300)}`), {
              pdfFail: true,
            });
          }
          const buf = await res.arrayBuffer();
          if (!buf || buf.byteLength === 0) {
            throw Object.assign(new Error("Tom PDF fra Tripletex"), { pdfFail: true });
          }

          // 2) Lagre i storage
          const path = `${legalEntityId}/tripletex/${ttId}.pdf`;
          const { error: upErr } = await admin.storage
            .from("invoice-pdfs")
            .upload(path, new Uint8Array(buf), { upsert: true, contentType: "application/pdf" });
          if (upErr) throw Object.assign(new Error(upErr.message), { pdfFail: true });

          await admin
            .from("invoices")
            .update({ source_document_url: path, pdf_status: "stored" })
            .eq("id", inv.id);

          // 2b) Bilagets posteringer: hovedbokskonto og — når mva mangler — inngående mva.
          //     Feil her skal ikke velte fakturaen.
          let ledgerAccount: string | null = null;
          let vatInferred = false;
          try {
            const vRes = await fetch(
              `${baseUrl()}/v2/supplierInvoice/${ttId}?fields=voucher(postings(account(number),amountGross,amount))`,
              { headers: { Authorization: authHeader(sessionToken), Accept: "application/json" } },
            );
            if (vRes.ok) {
              const vJson = await vRes.json().catch(() => null);
              const postings = vJson?.value?.voucher?.postings;
              ledgerAccount = pickLedgerAccount(postings);
              if (totalVat == null) {
                const vat = vatFromPostings(postings);
                if (vat != null && totalAmount != null && vat < Math.abs(totalAmount)) {
                  totalVat = vat;
                  vatInferred = true;
                  await admin.from("invoices").update({ total_vat: vat, vat_inferred: true }).eq("id", inv.id);
                }
              }
            } else {
              await vRes.text().catch(() => "");
            }
          } catch (_e) {
            ledgerAccount = null;
          }

          // 3) Ekstraher linjer via AI, med kontrollfakta og kjente varer
          let known: Array<{ sku: string | null; name: string | null }> = [];
          if (supplierId) {
            if (!knownCache.has(supplierId)) knownCache.set(supplierId, await knownItemsForSupplier(admin, supplierId));
            known = knownCache.get(supplierId) ?? [];
          }
          const expectedExcl = totalAmount != null && totalVat != null ? Number((totalAmount - totalVat).toFixed(2)) : null;
          const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/extract-invoice-from-pdf`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              legal_entity_id: legalEntityId,
              pdf_base64: toBase64(buf),
              expected_total_excl_vat: expectedExcl,
              expected_total_incl_vat: totalAmount,
              expected_vat: totalVat,
              supplier_name: supplierName,
              invoice_number: (head as any)?.invoice_number ?? inv.invoice_number ?? null,
              known_items: known,
              max_attempts: 2,
            }),
          });
          const extractJsonBody = await extractRes.json().catch(() => ({}));
          if (!extractRes.ok) {
            throw new Error(
              `Uthenting feilet: ${extractJsonBody?.error ?? extractRes.status}`,
            );
          }

          const rawLines = Array.isArray(extractJsonBody?.extracted?.lines)
            ? extractJsonBody.extracted.lines
            : [];
          const rows = rawLines
            .filter((l: any) => (l?.description ?? "") !== "" || num(l?.total_amount) !== null)
            .map((l: any, i: number) => {
              // Pakningsfeltene kommer fra uthentingen. Mangler de, tolker vi beskrivelsen
              // («36X90G») slik at package_size × count_per_package = total pakningsstørrelse.
              let packageSize = num(l?.package_size);
              let packageUnit = (l?.package_unit ?? null) as string | null;
              let countPerPackage = num(l?.count_per_package);
              if (packageSize == null || !packageUnit) {
                const parsed = parsePackageFromDescription(l?.description);
                if (parsed) {
                  packageSize = parsed.size;
                  packageUnit = parsed.unit;
                  countPerPackage = parsed.count ?? 1;
                }
              }
              const kind = typeof l?.line_kind === "string" && LINE_KINDS.has(l.line_kind) ? l.line_kind : null;
              return {
                invoice_id: inv.id,
                line_number: i + 1,
                supplier_sku: l?.sku ?? null,
                description: l?.description ?? null,
                quantity: num(l?.quantity),
                unit: l?.unit ?? null,
                unit_price: num(l?.unit_price),
                total_amount: num(l?.total_amount),
                vat_rate: num(l?.vat_rate),
                package_size: packageSize,
                package_unit: packageUnit,
                count_per_package: countPerPackage,
                line_kind: kind,
                ledger_account: ledgerAccount,
              };
            });

          // confidence ligger på toppnivå i svaret, ikke inni `extracted`.
          const confidence = num(extractJsonBody?.confidence);
          const lowConfidence = needsReviewFromConfidence(confidence);

          if (rows.length === 0) {
            await admin
              .from("invoices")
              .update({
                extraction_confidence: confidence,
                ...computeLinesSum({ lineTotals: [], totalAmount, totalVat }),
                lines_source: null,
                line_extraction_status: "done",
                line_extraction_at: new Date().toISOString(),
                line_extraction_error: "PDF-en ga ingen lesbare linjer",
              })
              .eq("id", inv.id);
            vellykket++;
            detaljer.push({ invoice_id: inv.id, lines: 0 });
            continue;
          }

          const { error: linesErr } = await admin.from("invoice_lines").insert(rows);
          if (linesErr) throw new Error(linesErr.message);

          // Sumkontroll: linjene er eks. mva, fakturaens totalbeløp inkl. mva.
          let sumCheck = computeLinesSum({
            lineTotals: rows.map((r: any) => r.total_amount),
            totalAmount,
            totalVat,
          });

          await admin
            .from("invoices")
            .update({
              lines_source: "pdf_extracted",
              line_extraction_status: "done",
              line_extraction_at: new Date().toISOString(),
              line_extraction_error: null,
              extraction_confidence: confidence,
              ...sumCheck,
              // Usikker uthenting skal ikke gli gjennom som ferdig importert.
              ...(lowConfidence && inv.status === "imported" ? { status: "needs_review" } : {}),
            })
            .eq("id", inv.id);

          // 4) Mva-mønster uten mva-beløp, eller mva-skalerte linjer som uthentingen ikke fanget:
          //    deterministisk reparasjon i basen (ingen gjetting — bare eksakte 1/1,15- og 1/1,25-forhold).
          let repaired: unknown = null;
          if (sumCheck.lines_sum_status === "mismatch" || (totalVat == null && sumCheck.lines_sum_status !== "no_total")) {
            const { data: rep } = await admin.rpc("rm_repair_invoice_vat", { p_invoice_id: inv.id });
            repaired = rep ?? null;
            if ((rep as any)?.ok) {
              const { data: after } = await admin
                .from("invoices")
                .select("lines_sum_status, lines_sum_variance_pct, lines_sum_excl_vat")
                .eq("id", inv.id)
                .maybeSingle();
              if (after) sumCheck = { ...sumCheck, ...(after as any) };
            }
          }
          vellykket++;
          detaljer.push({
            invoice_id: inv.id,
            lines: rows.length,
            sum_status: sumCheck.lines_sum_status,
            confidence,
            attempts: extractJsonBody?.attempts ?? null,
            vat_from_postings: vatInferred,
            repaired,
            warnings: extractJsonBody?.warnings ?? [],
          });

          // 5) Matching — feil her skal ikke velte fakturaen
          try {
            const matchRes = await fetch(`${SUPABASE_URL}/functions/v1/match-invoice-lines`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${SERVICE_KEY}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ invoice_id: inv.id }),
            });
            if (!matchRes.ok) {
              const mj = await matchRes.json().catch(() => ({}));
              throw new Error(String(mj?.error ?? matchRes.status));
            }
          } catch (me) {
            await admin
              .from("invoices")
              .update({
                line_extraction_error: `Linjer hentet, men matching feilet: ${
                  me instanceof Error ? me.message : String(me)
                }`,
              })
              .eq("id", inv.id);
          }
        } catch (e) {
          feilet++;
          const msg = e instanceof Error ? e.message : String(e);
          const { patch } = planLineExtractionFailure({
            attempts: Number((inv as any).line_extraction_attempts ?? 0),
            message: msg,
            status: (inv as any).status ?? null,
            pdfFail: !!(e as any)?.pdfFail,
          });
          await admin.from("invoices").update(patch).eq("id", inv.id);
          detaljer.push({ invoice_id: inv.id, error: msg });
        }
      }
    }

    // «gjenstaar» = pending med forsøk igjen (attempts < maks) — utmattede fakturaer
    // er «failed»/«needs_review» og skal ikke telles som noe cronen kan ta senere.
    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("legal_entity_id", legalEntityId)
      .eq("line_extraction_status", "pending")
      .lt("line_extraction_attempts", 3);

    return json({ ok: true, behandlet, vellykket, feilet, gjenstaar: count ?? 0, detaljer });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

