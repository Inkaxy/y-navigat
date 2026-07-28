// fakturering-transfer-run — transfers an invoice_run's basis records to Tripletex as DRAFT orders.
// NEVER invoices / sends anything from Tripletex — Økonomi does that step manually in Tripletex.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch, TripletexError } from "../_shared/tripletex.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json(401, { error: "Unauthorized" });

    const body = await req.json().catch(() => ({}));
    const runId = body?.run_id as string | undefined;
    if (!runId) return json(400, { error: "run_id required" });

    // Admin client for data access
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Load run
    const { data: run, error: runErr } = await admin
      .from("invoice_runs")
      .select("*")
      .eq("id", runId)
      .maybeSingle();
    if (runErr) throw runErr;
    if (!run) return json(404, { error: "Kjøring ikke funnet" });

    // User-scoped client for authz check
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claims, error: claimsErr } = await userClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claims?.claims?.sub) return json(401, { error: "Unauthorized" });

    const [{ data: hasWrite }, { data: hasPos }] = await Promise.all([
      userClient.rpc("has_app_write_access", { p_app_code: "faktura" }),
      userClient.rpc("has_position_in_entity", { p_entity: run.legal_entity_id }),
    ]);
    if (!hasWrite || !hasPos) return json(403, { error: "Mangler tilgang til Fakturering for dette selskapet" });

    // Load settings + candidate basis rows
    const { data: settings } = await admin
      .from("invoice_settings")
      .select("*")
      .eq("legal_entity_id", run.legal_entity_id)
      .maybeSingle();
    const vatAccountMap: Record<string, string> = settings?.vat_account_map ?? {};
    const tripletexMeta: Record<string, any> = settings?.tripletex_meta ?? {};

    const { data: bases, error: basesErr } = await admin
      .from("invoice_basis")
      .select("*")
      .eq("run_id", runId)
      .in("status", ["pending", "error"])
      .eq("do_transfer", true)
      .order("basis_number", { ascending: true });
    if (basesErr) throw basesErr;

    if (!bases || bases.length === 0) {
      return json(200, { ok: true, transferred: 0, failed: 0, message: "Ingen grunnlag å overføre" });
    }

    const sessionToken = await getSessionToken(admin, run.legal_entity_id);

    // Build VAT-type cache per run
    // Collect rates used across all basis lines
    const basisIds = bases.map((b: any) => b.id);
    const { data: allLines } = await admin
      .from("invoice_basis_lines")
      .select("basis_id, vat_rate")
      .in("basis_id", basisIds);
    const usedRates = new Set<number>();
    (allLines ?? []).forEach((l: any) => usedRates.add(Number(l.vat_rate)));

    const vatTypeCache: Record<string, number> = tripletexMeta.vat_type_ids ?? {};
    const missingRates = [...usedRates].filter((r) => !vatTypeCache[String(r)]);
    if (missingRates.length > 0) {
      const vt = await tripletexFetch("/v2/ledger/vatType", {
        sessionToken,
        query: { count: 200, fields: "id,name,percentage,vatCode,type" },
      });
      const list: any[] = vt?.values ?? [];
      for (const rate of missingRates) {
        // Prefer OUTGOING type with matching percentage; fall back to first match.
        const candidates = list.filter((v) => Number(v.percentage) === Number(rate));
        const outgoing = candidates.find((v) => String(v.type || "").toUpperCase().includes("OUT"));
        const chosen = outgoing ?? candidates[0];
        if (chosen?.id) vatTypeCache[String(rate)] = Number(chosen.id);
      }
      await admin
        .from("invoice_settings")
        .update({ tripletex_meta: { ...tripletexMeta, vat_type_ids: vatTypeCache } })
        .eq("legal_entity_id", run.legal_entity_id);
    }

    let transferred = 0;
    let failed = 0;

    for (const basis of bases) {
      try {
        // 1) Ensure customer
        const { data: customer, error: custErr } = await admin
          .from("customers")
          .select("id, customer_number, tripletex_customer_id, display_name, organization_number, invoice_email, primary_contact_email, is_private_person")
          .eq("id", basis.customer_id)
          .maybeSingle();
        if (custErr) throw custErr;
        if (!customer) throw new Error("Kunde ikke funnet");

        let tripletexCustomerId = customer.tripletex_customer_id as number | null;

        if (!tripletexCustomerId) {
          // Try lookup by customerNumber
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
          await admin
            .from("customers")
            .update({ tripletex_customer_id: tripletexCustomerId })
            .eq("id", customer.id);
        }

        // 2) Ensure order (idempotent)
        let orderId = basis.tripletex_order_id as number | null;
        let orderNumber = basis.tripletex_order_number ?? null;
        if (orderId) {
          // Fetch existing order + lines
          const existing = await tripletexFetch(`/v2/order/${orderId}`, {
            sessionToken, query: { fields: "id,number,orderLines(id)" },
          }).catch(() => null);
          const existingLines: any[] = existing?.value?.orderLines ?? [];
          if (existingLines.length > 0) {
            // Try deleting the order so we can rebuild cleanly
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
          await admin
            .from("invoice_basis")
            .update({ tripletex_order_id: orderId, tripletex_order_number: orderNumber })
            .eq("id", basis.id);
        }

        // 3) Lines
        const { data: lines, error: linesErr } = await admin
          .from("invoice_basis_lines")
          .select("*")
          .eq("basis_id", basis.id)
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
          const accountNumber = vatAccountMap[String(Number(line.vat_rate))];
          if (accountNumber) {
            // Best-effort: include account by number (Tripletex may ignore if not supported)
            linePayload.account = { number: accountNumber };
          }
          await tripletexFetch("/v2/orderline", {
            sessionToken, method: "POST", body: linePayload,
          });
        }

        // 4) Mark success + flip orders & delivery notes
        await admin
          .from("invoice_basis")
          .update({
            status: "transferred",
            transferred_at: new Date().toISOString(),
            transfer_error: null,
          })
          .eq("id", basis.id);

        const { data: basisOrders } = await admin
          .from("invoice_basis_orders")
          .select("order_id")
          .eq("basis_id", basis.id);
        const orderIds = (basisOrders ?? []).map((r: any) => r.order_id);

        if (orderIds.length > 0) {
          const { data: prevOrders } = await admin
            .from("orders")
            .select("id, status")
            .in("id", orderIds);
          await admin.from("orders").update({ status: "invoiced" }).in("id", orderIds);
          const historyRows = (prevOrders ?? []).map((o: any) => ({
            order_id: o.id,
            from_status: o.status,
            to_status: "invoiced",
            changed_by: claims.claims.sub,
            notes: `Overført til Tripletex (grunnlag ${basis.basis_number})`,
            metadata: { basis_id: basis.id, tripletex_order_id: orderId, tripletex_order_number: orderNumber },
          }));
          if (historyRows.length > 0) await admin.from("order_status_history").insert(historyRows);

          // Delivery notes that consist only of these orders → invoiced
          const { data: noteLinks } = await admin
            .from("delivery_note_lines")
            .select("delivery_note_id, order_id")
            .in("order_id", orderIds);
          const noteIds = [...new Set((noteLinks ?? []).map((r: any) => r.delivery_note_id))];
          for (const noteId of noteIds) {
            const { data: allNoteLinks } = await admin
              .from("delivery_note_lines")
              .select("order_id")
              .eq("delivery_note_id", noteId);
            const allOrdersOnNote = (allNoteLinks ?? []).map((r: any) => r.order_id);
            const allInvoiced = allOrdersOnNote.every((oid: string) => orderIds.includes(oid));
            if (allInvoiced) {
              await admin.from("delivery_notes").update({ status: "invoiced" }).eq("id", noteId);
            }
          }
        }

        await admin.from("audit_log").insert({
          action: "invoice_basis_transferred",
          entity_type: "invoice_basis",
          entity_id: basis.id,
          entity_display_reference: basis.basis_number,
          legal_entity_id: run.legal_entity_id,
          user_id: claims.claims.sub,
          source_app: "faktura",
          changes: { tripletex_order_id: orderId, tripletex_order_number: orderNumber, run_id: runId },
        });

        transferred++;
      } catch (e) {
        failed++;
        const msg = e instanceof TripletexError
          ? (e.validationMessages.length ? e.validationMessages.join("; ") : e.message)
          : (e instanceof Error ? e.message : String(e));
        await admin
          .from("invoice_basis")
          .update({ status: "error", transfer_error: msg.slice(0, 1000) })
          .eq("id", basis.id);
        await admin.from("audit_log").insert({
          action: "invoice_basis_transfer_failed",
          entity_type: "invoice_basis",
          entity_id: basis.id,
          entity_display_reference: basis.basis_number,
          legal_entity_id: run.legal_entity_id,
          user_id: claims.claims.sub,
          source_app: "faktura",
          reason: msg.slice(0, 500),
        });
      }
    }

    // 5) Update run counters
    const { data: allBases } = await admin
      .from("invoice_basis")
      .select("status")
      .eq("run_id", runId);
    const counts = { transferred: 0, failed: 0, skipped: 0, excluded: 0, pending: 0, invoiced: 0 };
    for (const b of allBases ?? []) {
      const s = (b as any).status as keyof typeof counts;
      if (s in counts) counts[s]++;
    }
    const runStatus = counts.failed > 0 ? "completed_with_errors" : "completed";
    await admin
      .from("invoice_runs")
      .update({
        status: runStatus,
        completed_at: new Date().toISOString(),
        transferred_count: counts.transferred + counts.invoiced,
        failed_count: counts.failed,
        skipped_count: counts.skipped,
      })
      .eq("id", runId);

    return json(200, { ok: true, transferred, failed, run_status: runStatus });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fakturering-transfer-run error", msg);
    return json(500, { error: msg });
  }
});
