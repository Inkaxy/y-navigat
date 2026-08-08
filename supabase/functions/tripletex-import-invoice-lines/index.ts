// Henter PDF fra Tripletex for importerte leverandørfakturaer, lagrer den i storage,
// leser ut varelinjer via extract-invoice-from-pdf og kjører match-invoice-lines.
// Kjøres av cron (små porsjoner) eller manuelt per faktura fra fakturadetaljsiden.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, baseUrl, authHeader } from "../_shared/tripletex.ts";
import { parsePackageFromDescription } from "../_shared/units.ts";
import { computeLinesSum, needsReviewFromConfidence } from "../_shared/lines-sum.ts";

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

    const limit = body.invoice_id ? 1 : Math.max(1, Math.min(50, Number(body.limit ?? 5)));

    let q = admin
      .from("invoices")
      .select("id, tripletex_supplier_invoice_id, invoice_number, total_amount, total_vat, status")
      .eq("legal_entity_id", legalEntityId)
      .not("tripletex_supplier_invoice_id", "is", null)
      .order("invoice_date", { ascending: false })
      .limit(limit);
    if (body.invoice_id) q = q.eq("id", body.invoice_id);
    else if (body.retry_failed) q = q.in("line_extraction_status", ["pending", "failed"]);
    else q = q.eq("line_extraction_status", "pending");

    const { data: invoices, error: invErr } = await q;
    if (invErr) throw new Error(invErr.message);

    let behandlet = 0;
    let vellykket = 0;
    let feilet = 0;

    if ((invoices ?? []).length > 0) {
      const sessionToken = await getSessionToken(admin, legalEntityId);

      for (const inv of invoices ?? []) {
        behandlet++;
        const ttId = inv.tripletex_supplier_invoice_id as string;
        try {
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

          // 3) Ekstraher linjer via AI
          const extractRes = await fetch(`${SUPABASE_URL}/functions/v1/extract-invoice-from-pdf`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${SERVICE_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ legal_entity_id: legalEntityId, pdf_base64: toBase64(buf) }),
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
              };
            });

          const confidence = num(extractJsonBody?.extracted?.confidence);
          const lowConfidence = needsReviewFromConfidence(confidence);

          if (rows.length === 0) {
            await admin
              .from("invoices")
              .update({
                extraction_confidence: confidence,
                ...computeLinesSum({
                  lineTotals: [],
                  totalAmount: inv.total_amount as number | null,
                  totalVat: inv.total_vat as number | null,
                }),
                lines_source: null,
                line_extraction_status: "done",
                line_extraction_at: new Date().toISOString(),
                line_extraction_error: "PDF-en ga ingen lesbare linjer",
              })
              .eq("id", inv.id);
            vellykket++;
            continue;
          }

          const { error: linesErr } = await admin.from("invoice_lines").insert(rows);
          if (linesErr) throw new Error(linesErr.message);

          // Sumkontroll: linjene er eks. mva, fakturaens totalbeløp inkl. mva.
          const sumCheck = computeLinesSum({
            lineTotals: rows.map((r: any) => r.total_amount),
            totalAmount: inv.total_amount as number | null,
            totalVat: inv.total_vat as number | null,
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
          vellykket++;

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
          const patch: Record<string, unknown> = {
            line_extraction_status: "failed",
            line_extraction_error: msg,
            line_extraction_at: new Date().toISOString(),
          };
          if ((e as any)?.pdfFail) patch.pdf_status = "failed";
          await admin.from("invoices").update(patch).eq("id", inv.id);
        }
      }
    }

    const { count } = await admin
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("legal_entity_id", legalEntityId)
      .eq("line_extraction_status", "pending");

    return json({ ok: true, behandlet, vellykket, feilet, gjenstaar: count ?? 0 });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
