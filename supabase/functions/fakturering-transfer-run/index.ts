// fakturering-transfer-run — transfers an invoice_run's basis records to Tripletex as DRAFT orders.
// NEVER invoices / sends anything from Tripletex — Økonomi does that step manually in Tripletex.
//
// After a successful transfer, when the customer's effective attachment mode allows it and the
// invoice_settings.attach_vedlegg toggle is on, the PDF vedlegg is uploaded to the Tripletex
// order via /v2/order/{id}/:attach so the attachment follows the invoice when Økonomi bills.
// Attachment failures NEVER change basis.status — they are recorded in attachment_error only.
//
// Accepts { run_id, only_attachments?: true } — the flag skips transfer entirely and only
// (re)uploads attachments for bases that are already transferred but not yet uploaded.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch, TripletexError, authHeader, baseUrl } from "../_shared/tripletex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Decide whether a customer's fakturagrunnlag-vedlegg should be attached. */
function attachmentEligibility(customer: any, attachVedlegg: boolean): { ok: boolean; reason?: string } {
  if (!attachVedlegg) return { ok: false, reason: "Vedlegg er slått av i innstillingene" };
  const mode = customer?.invoice_attachment as string | null | undefined;
  // Only "specified_per_week" (or unset — treated as default) gets the matrix vedlegg.
  if (mode && mode !== "specified_per_week") {
    return { ok: false, reason: `Kunden har vedleggstype «${mode}» — grunnlags-PDF er ikke aktuell` };
  }
  const method = String(customer?.invoice_method ?? "").toLowerCase();
  const isEhf = method === "ehf" || method === "ehf_bulk";
  if (isEhf && customer?.include_attachments_in_ehf === false) {
    return { ok: false, reason: "EHF-kunde med «Inkluder vedlegg i EHF» avslått" };
  }
  return { ok: true };
}

/** Ensure vedlegg PDF is generated. Returns updated basis row. */
async function ensureAttachmentGenerated(admin: any, authHeaderVal: string, basisId: string): Promise<any> {
  const { data: basis } = await admin
    .from("invoice_basis")
    .select("id, attachment_path, attachment_error")
    .eq("id", basisId)
    .maybeSingle();
  if (basis?.attachment_path) return basis;

  // Invoke generate-vedlegg via direct HTTP (deno-safe).
  const url = `${SUPABASE_URL}/functions/v1/fakturering-generate-vedlegg`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: authHeaderVal,
      apikey: SERVICE_ROLE,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ basis_id: basisId }),
  });
  const txt = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Kunne ikke generere vedlegg: ${txt.slice(0, 300) || res.status}`);

  const { data: after } = await admin
    .from("invoice_basis")
    .select("id, attachment_path, attachment_error")
    .eq("id", basisId)
    .maybeSingle();
  return after;
}

async function uploadAttachmentToTripletex(admin: any, sessionToken: string, orderId: number, basis: any): Promise<void> {
  // Download PDF from private bucket
  const { data: signed, error: signErr } = await admin
    .storage.from("invoice-attachments")
    .createSignedUrl(basis.attachment_path, 120);
  if (signErr || !signed?.signedUrl) throw new Error(`Kunne ikke hente vedlegg: ${signErr?.message ?? "ingen signed url"}`);
  const pdfRes = await fetch(signed.signedUrl);
  if (!pdfRes.ok) throw new Error(`Nedlasting av vedlegg feilet: ${pdfRes.status}`);
  const pdfBytes = new Uint8Array(await pdfRes.arrayBuffer());

  const form = new FormData();
  form.append("file", new Blob([pdfBytes], { type: "application/pdf" }), `${basis.basis_number}-vedlegg.pdf`);

  // Tripletex swagger: POST /v2/order/{id}/:attach — multipart. The addToInvoiceMode
  // query param is not always available across API versions; try with, fall back without.
  const tryUpload = async (withMode: boolean) => {
    const u = new URL(baseUrl() + `/v2/order/${orderId}/:attach`);
    if (withMode) u.searchParams.set("addToInvoiceMode", "APPEND_ORIGINAL");
    const res = await fetch(u.toString(), {
      method: "POST",
      headers: { Authorization: authHeader(sessionToken) },
      body: form,
    });
    return { ok: res.ok, status: res.status, text: await res.text().catch(() => "") };
  };
  let r = await tryUpload(true);
  if (!r.ok && (r.status === 400 || r.status === 404)) {
    r = await tryUpload(false);
  }
  if (!r.ok) throw new Error(`Tripletex vedleggs-opplasting feilet (${r.status}): ${r.text.slice(0, 300)}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeaderVal = req.headers.get("Authorization");
    if (!authHeaderVal?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const runId = body?.run_id as string | undefined;
    const onlyAttachments = body?.only_attachments === true;
    if (!runId) return json(400, { error: "run_id required" });

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: run, error: runErr } = await admin
      .from("invoice_runs").select("*").eq("id", runId).maybeSingle();
    if (runErr) throw runErr;
    if (!run) return json(404, { error: "Kjøring ikke funnet" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeaderVal } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user?.id) return json(401, { error: "Unauthorized" });
    const userId = userData.user.id;

    const [{ data: hasWrite }, { data: hasPos }] = await Promise.all([
      userClient.rpc("has_app_write_access", { p_app_code: "faktura" }),
      userClient.rpc("has_position_in_entity", { p_legal_entity_id: run.legal_entity_id }),
    ]);
    if (!hasWrite || !hasPos) return json(403, { error: "Mangler tilgang til Fakturering for dette selskapet" });

    const { data: settings } = await admin
      .from("invoice_settings").select("*").eq("legal_entity_id", run.legal_entity_id).maybeSingle();
    const vatAccountMap: Record<string, string> = settings?.vat_account_map ?? {};
    const tripletexMeta: Record<string, any> = settings?.tripletex_meta ?? {};
    const attachVedlegg = settings?.attach_vedlegg !== false;

    const sessionToken = await getSessionToken(admin, run.legal_entity_id);

    // -----------------------------------------------------------------------
    // MODE A: only_attachments — skip transfer, upload/refresh vedlegg only.
    // -----------------------------------------------------------------------
    if (onlyAttachments) {
      const { data: bases } = await admin
        .from("invoice_basis")
        .select("*, customer:customer_id(id, invoice_method, invoice_attachment, include_attachments_in_ehf)")
        .eq("run_id", runId)
        .not("tripletex_order_id", "is", null)
        .is("attachment_uploaded_at", null);
      let uploaded = 0, failed = 0, skipped = 0;
      for (const basis of (bases ?? []) as any[]) {
        const elig = attachmentEligibility(basis.customer, attachVedlegg);
        if (!elig.ok) {
          await admin.from("invoice_basis").update({ attachment_error: elig.reason }).eq("id", basis.id);
          skipped++;
          continue;
        }
        try {
          const b2 = await ensureAttachmentGenerated(admin, authHeaderVal, basis.id);
          if (!b2?.attachment_path) throw new Error(b2?.attachment_error || "Vedlegg mangler");
          await uploadAttachmentToTripletex(admin, sessionToken, Number(basis.tripletex_order_id), { ...basis, attachment_path: b2.attachment_path });
          await admin.from("invoice_basis").update({
            attachment_uploaded_at: new Date().toISOString(),
            attachment_error: null,
          }).eq("id", basis.id);
          uploaded++;
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          await admin.from("invoice_basis").update({ attachment_error: msg.slice(0, 1000) }).eq("id", basis.id);
        }
      }
      return json(200, { ok: true, only_attachments: true, uploaded, failed, skipped });
    }

    // -----------------------------------------------------------------------
    // MODE B: full transfer.
    // -----------------------------------------------------------------------
    await admin.from("invoice_runs").update({ status: "running" }).eq("id", runId);

    const { data: bases, error: basesErr } = await admin
      .from("invoice_basis")
      .select("*, customer:customer_id(id, customer_number, tripletex_customer_id, display_name, organization_number, invoice_email, primary_contact_email, is_private_person, invoice_method, invoice_attachment, include_attachments_in_ehf)")
      .eq("run_id", runId)
      .in("status", ["pending", "error"])
      .eq("do_transfer", true)
      .order("basis_number", { ascending: true });
    if (basesErr) throw basesErr;

    if (!bases || bases.length === 0) {
      // Finalise counters even for no-ops.
      await admin.from("invoice_runs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", runId);
      return json(200, { ok: true, transferred: 0, failed: 0, message: "Ingen grunnlag å overføre" });
    }

    // Build VAT-type cache per run
    const basisIds = bases.map((b: any) => b.id);
    const { data: allLines } = await admin
      .from("invoice_basis_lines").select("basis_id, vat_rate").in("basis_id", basisIds);
    const usedRates = new Set<number>();
    (allLines ?? []).forEach((l: any) => usedRates.add(Number(l.vat_rate)));

    const vatTypeCache: Record<string, number> = tripletexMeta.vat_type_ids ?? {};
    const missingRates = [...usedRates].filter((r) => !vatTypeCache[String(r)]);
    if (missingRates.length > 0) {
      const vt = await tripletexFetch("/v2/ledger/vatType", {
        sessionToken, query: { count: 200, fields: "id,name,percentage,vatCode,type" },
      });
      const list: any[] = vt?.values ?? [];
      for (const rate of missingRates) {
        const candidates = list.filter((v) => Number(v.percentage) === Number(rate));
        const outgoing = candidates.find((v) => String(v.type || "").toUpperCase().includes("OUT"));
        const chosen = outgoing ?? candidates[0];
        if (chosen?.id) vatTypeCache[String(rate)] = Number(chosen.id);
      }
      await admin.from("invoice_settings")
        .update({ tripletex_meta: { ...tripletexMeta, vat_type_ids: vatTypeCache } })
        .eq("legal_entity_id", run.legal_entity_id);
    }

    let transferred = 0;
    let failed = 0;

    for (const basis of bases as any[]) {
      const customer = basis.customer;
      try {
        if (!customer) throw new Error("Kunde ikke funnet");

        let tripletexCustomerId = customer.tripletex_customer_id as number | null;

        if (!tripletexCustomerId) {
          const numeric = Number(String(customer.customer_number).replace(/\D/g, ""));
          if (Number.isFinite(numeric) && numeric > 0) {
            const found = await tripletexFetch("/v2/customer", {
              sessionToken,
              query: { customerAccountNumber: numeric, fields: "id,customerNumber,name" },
            });
            const hit = (found?.values ?? [])[0];
            if (hit?.id) tripletexCustomerId = Number(hit.id);
          }
          if (!tripletexCustomerId) {
            const email = customer.invoice_email || customer.primary_contact_email || null;
            if (!customer.organization_number && !email) {
              throw new Error("Kunde mangler org.nr/e-post — kan ikke opprettes i Tripletex");
            }
            const payload: any = {
              name: customer.display_name,
              customerNumber: Number.isFinite(numeric) ? numeric : undefined,
              organizationNumber: customer.organization_number || undefined,
              email: email || undefined,
              invoiceEmail: email || undefined,
              isCustomer: true,
              isPrivateIndividual: !!customer.is_private_person,
            };
            const created = await tripletexFetch("/v2/customer", {
              sessionToken, method: "POST", body: payload,
            });
            tripletexCustomerId = Number(created?.value?.id);
            if (!tripletexCustomerId) throw new Error("Tripletex returnerte ingen kunde-id");
          }
          await admin.from("customers")
            .update({ tripletex_customer_id: tripletexCustomerId })
            .eq("id", customer.id);
        }

        // Ensure order (idempotent)
        let orderId = basis.tripletex_order_id as number | null;
        let orderNumber = basis.tripletex_order_number ?? null;
        if (orderId) {
          const existing = await tripletexFetch(`/v2/order/${orderId}`, {
            sessionToken, query: { fields: "id,number,orderLines(id)" },
          }).catch(() => null);
          const existingLines: any[] = existing?.value?.orderLines ?? [];
          if (existingLines.length > 0) {
            try {
              await tripletexFetch(`/v2/order/${orderId}`, { sessionToken, method: "DELETE" });
              orderId = null;
              orderNumber = null;
            } catch (e) {
              throw new Error(`Ordren finnes i Tripletex med linjer og kan ikke slettes — rydd manuelt (ordre-id ${orderId}). ${(e as Error).message}`);
            }
          }
        }

        if (!orderId) {
          const orderPayload: any = {
            customer: { id: tripletexCustomerId },
            orderDate: run.run_date,
            deliveryDate: run.run_date,
            isPrioritizeAmountsIncludingVat: false,
            invoicesDueIn: basis.payment_terms_days ?? settings?.default_due_days ?? 14,
            invoicesDueInType: "DAYS",
            invoiceComment: `NBHub fakturagrunnlag ${basis.basis_number}`,
          };
          const createdOrder = await tripletexFetch("/v2/order", {
            sessionToken, method: "POST", body: orderPayload,
          });
          orderId = Number(createdOrder?.value?.id);
          orderNumber = createdOrder?.value?.number ?? null;
          if (!orderId) throw new Error("Tripletex returnerte ingen ordre-id");
          await admin.from("invoice_basis")
            .update({ tripletex_order_id: orderId, tripletex_order_number: orderNumber })
            .eq("id", basis.id);
        }

        // Lines
        const { data: lines, error: linesErr } = await admin
          .from("invoice_basis_lines").select("*").eq("basis_id", basis.id)
          .order("line_number", { ascending: true });
        if (linesErr) throw linesErr;

        for (const line of lines ?? []) {
          const vatTypeId = vatTypeCache[String(Number(line.vat_rate))];
          if (!vatTypeId) throw new Error(`Fant ikke Tripletex-mva-type for sats ${line.vat_rate}%`);
          const qty = Number(line.quantity);
          const excl = Number(line.line_excl_vat);
          const unitPrice = qty !== 0 ? excl / qty : excl;
          const linePayload: any = {
            order: { id: orderId },
            description: line.description,
            count: qty !== 0 ? qty : 1,
            unitPriceExcludingVatCurrency: unitPrice,
            vatType: { id: vatTypeId },
          };
          // `account` er utelatt med vilje — inntektskonto styres av mva-typen/produktet
          // i Tripletex. vat_account_map beholdes som dokumentasjon.
          void vatAccountMap;
          await tripletexFetch("/v2/orderline", { sessionToken, method: "POST", body: linePayload });
        }

        // Mark success + flip orders & delivery notes
        await admin.from("invoice_basis").update({
          status: "transferred",
          transferred_at: new Date().toISOString(),
          transfer_error: null,
        }).eq("id", basis.id);

        const { data: basisOrders } = await admin
          .from("invoice_basis_orders").select("order_id").eq("basis_id", basis.id);
        const orderIds = (basisOrders ?? []).map((r: any) => r.order_id);
        if (orderIds.length > 0) {
          const { data: prevOrders } = await admin
            .from("orders").select("id, status").in("id", orderIds);
          await admin.from("orders").update({ status: "invoiced" }).in("id", orderIds);
          const historyRows = (prevOrders ?? []).map((o: any) => ({
            order_id: o.id,
            from_status: o.status,
            to_status: "invoiced",
            changed_by: userId,
            notes: `Overført til Tripletex (grunnlag ${basis.basis_number})`,
            metadata: { basis_id: basis.id, tripletex_order_id: orderId, tripletex_order_number: orderNumber },
          }));
          if (historyRows.length > 0) await admin.from("order_status_history").insert(historyRows);

          const { data: noteLinks } = await admin
            .from("delivery_note_lines").select("delivery_note_id, order_id").in("order_id", orderIds);
          const noteIds = [...new Set((noteLinks ?? []).map((r: any) => r.delivery_note_id))];
          for (const noteId of noteIds) {
            const { data: allNoteLinks } = await admin
              .from("delivery_note_lines").select("order_id").eq("delivery_note_id", noteId);
            const allOrdersOnNote = (allNoteLinks ?? []).map((r: any) => r.order_id);
            const allInvoiced = allOrdersOnNote.every((oid: string) => orderIds.includes(oid));
            if (allInvoiced) {
              const { error: dnErr } = await admin
                .from("delivery_notes").update({ status: "invoiced" }).eq("id", noteId);
              if (dnErr) {
                console.error(`Kunne ikke flagge pakkseddel ${noteId} som fakturert:`, dnErr.message);
              }
            }
          }
        }

        await admin.from("audit_log").insert({
          action: "invoice_basis_transferred",
          entity_type: "invoice_basis",
          entity_id: basis.id,
          entity_display_reference: basis.basis_number,
          legal_entity_id: run.legal_entity_id,
          user_id: userId,
          source_app: "faktura",
          changes: { tripletex_order_id: orderId, tripletex_order_number: orderNumber, run_id: runId },
        });

        // Attachment upload — never fails the transfer.
        const elig = attachmentEligibility(customer, attachVedlegg);
        if (elig.ok) {
          try {
            const b2 = await ensureAttachmentGenerated(admin, authHeaderVal, basis.id);
            if (!b2?.attachment_path) throw new Error(b2?.attachment_error || "Vedlegg mangler");
            await uploadAttachmentToTripletex(admin, sessionToken, Number(orderId), {
              basis_number: basis.basis_number,
              attachment_path: b2.attachment_path,
            });
            await admin.from("invoice_basis").update({
              attachment_uploaded_at: new Date().toISOString(),
              attachment_error: null,
            }).eq("id", basis.id);
          } catch (attachErr) {
            const msg = attachErr instanceof Error ? attachErr.message : String(attachErr);
            await admin.from("invoice_basis").update({ attachment_error: msg.slice(0, 1000) }).eq("id", basis.id);
          }
        } else {
          await admin.from("invoice_basis").update({ attachment_error: elig.reason ?? null }).eq("id", basis.id);
        }

        transferred++;
      } catch (e) {
        failed++;
        const msg = e instanceof TripletexError
          ? (e.validationMessages.length ? e.validationMessages.join("; ") : e.message)
          : (e instanceof Error ? e.message : String(e));
        await admin.from("invoice_basis")
          .update({ status: "error", transfer_error: msg.slice(0, 1000) })
          .eq("id", basis.id);
        await admin.from("audit_log").insert({
          action: "invoice_basis_transfer_failed",
          entity_type: "invoice_basis",
          entity_id: basis.id,
          entity_display_reference: basis.basis_number,
          legal_entity_id: run.legal_entity_id,
          user_id: userId,
          source_app: "faktura",
          reason: msg.slice(0, 500),
        });
      }
    }

    const { data: allBases } = await admin
      .from("invoice_basis").select("status").eq("run_id", runId);
    const counts = { transferred: 0, failed: 0, skipped: 0, excluded: 0, pending: 0, invoiced: 0 };
    for (const b of allBases ?? []) {
      const s = (b as any).status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    const runStatus = counts.failed > 0 ? "completed_with_errors" : "completed";
    await admin.from("invoice_runs").update({
      status: runStatus,
      completed_at: new Date().toISOString(),
      transferred_count: counts.transferred + counts.invoiced,
      failed_count: counts.failed,
      skipped_count: counts.skipped,
    }).eq("id", runId);

    return json(200, { ok: true, transferred, failed, run_status: runStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fakturering-transfer-run error", msg);
    return json(500, { error: msg });
  }
});
