// Importerer leverandørfakturaer fra Tripletex (/v2/supplierInvoice) til public.invoices.
// Kjøres av cron eller manuelt fra Råvarer → Leverandører.
// Henter IKKE PDF og kaller IKKE AI — det gjøres av egne funksjoner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch, TripletexError } from "../_shared/tripletex.ts";

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
  from?: string;
  to?: string;
  /** Etterhenting: hent kun denne leverandørens fakturaer. */
  supplier_id?: string;
  /** Antall måneder bakover ved etterhenting (standard 12). */
  backfill_months?: number;
}

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateStr: string, n: number) =>
  iso(new Date(new Date(`${dateStr}T00:00:00Z`).getTime() + n * DAY));
const daysBetween = (a: string, b: string) =>
  Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / DAY,
  );

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const digits = (s: unknown) => String(s ?? "").replace(/\s+/g, "");
const round2 = (n: number) => Math.round(n * 100) / 100;

const MAX_CHUNK_DAYS = 31;
const MAX_CHUNKS_PER_RUN = 3;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let logId: string | null = null;
  let legalEntityId = "";

  try {
    const body = (await req.json().catch(() => ({}))) as Body;
    legalEntityId = body.legal_entity_id ?? "";
    if (!legalEntityId) return json({ error: "legal_entity_id required" }, 400);

    if (!(await authorize(req, admin, legalEntityId))) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { data: cred } = await admin
      .from("tripletex_credentials")
      .select("*")
      .eq("legal_entity_id", legalEntityId)
      .maybeSingle();
    if (!cred || !cred.employee_token_encrypted) {
      return json({ skipped: true, reason: "Tripletex ikke konfigurert" });
    }

    // --- Etterhenting for én leverandør? ---
    // Brukes når «følg fakturalinjer» skrus på: da finnes det ingen lagrede
    // fakturahoder å vekke, så vi må hente historikken på nytt.
    const isBackfill = !!body.supplier_id;
    let ttSupplierFilterId: string | null = null;
    if (isBackfill) {
      const { data: sup } = await admin
        .from("suppliers")
        .select("id, name, tripletex_supplier_id")
        .eq("id", body.supplier_id!)
        .eq("legal_entity_id", legalEntityId)
        .maybeSingle();
      if (!sup) return json({ error: "Ukjent leverandør" }, 400);
      if (!sup.tripletex_supplier_id) {
        return json({ skipped: true, reason: "Leverandøren er ikke koblet til Tripletex" });
      }
      ttSupplierFilterId = String(sup.tripletex_supplier_id);
    }

    // --- Vindu ---
    const today = iso(new Date());
    const fallbackStart = cred.initial_import_done
      ? addDays(today, -30)
      : addDays(today, -365);
    let windowFrom: string;
    let windowTo: string;
    if (isBackfill) {
      const months = Math.max(1, Math.min(60, Number(body.backfill_months ?? 12) || 12));
      const start = new Date(`${today}T00:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() - months);
      windowFrom = iso(start);
      windowTo = addDays(today, 1);
    } else {
      windowFrom = body.from ?? cred.last_invoice_synced_date ?? fallbackStart;
      windowTo = body.to ?? addDays(today, 1);
    }
    if (windowTo <= windowFrom) windowTo = addDays(windowFrom, 1);

    // Del i biter på maks 31 dager, maks 3 biter per kjøring (alle biter ved etterhenting).
    const chunks: Array<{ from: string; to: string }> = [];
    let cursor = windowFrom;
    while (cursor < windowTo && (isBackfill || chunks.length < MAX_CHUNKS_PER_RUN)) {
      const next =
        daysBetween(cursor, windowTo) > MAX_CHUNK_DAYS ? addDays(cursor, MAX_CHUNK_DAYS) : windowTo;
      chunks.push({ from: cursor, to: next });
      cursor = next;
    }
    const harMer = cursor < windowTo;

    const { data: logRow } = await admin
      .from("tripletex_sync_log")
      .insert({
        legal_entity_id: legalEntityId,
        status: "running",
        vouchers_fetched: 0,
        vouchers_imported: 0,
        vouchers_skipped: 0,
        vouchers_failed: 0,
      })
      .select("id")
      .single();
    logId = logRow?.id ?? null;

    let sessionToken = await getSessionToken(admin, legalEntityId);

    // --- Leverandøroppslag for selskapet ---
    const { data: supRows, error: supErr } = await admin
      .from("suppliers")
      .select("id, name, org_number, tripletex_supplier_id, track_invoice_lines")
      .eq("legal_entity_id", legalEntityId);
    if (supErr) throw new Error(supErr.message);

    const byTtId = new Map<string, any>();
    const byOrg = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const r of supRows ?? []) {
      if (r.tripletex_supplier_id) byTtId.set(String(r.tripletex_supplier_id), r);
      const o = digits(r.org_number);
      if (o && !byOrg.has(o)) byOrg.set(o, r);
      const n = norm(r.name);
      if (n && !byName.has(n)) byName.set(n, r);
    }

    const FIELDS =
      "id,invoiceNumber,invoiceDate,invoiceDueDate,amount,amountExcludingVat," +
      "amountCurrency,amountExcludingVatCurrency,isCreditNote," +
      "currency(code),voucher(id,number),supplier(id,name,organizationNumber,supplierNumber)";

    async function fetchPage(from: string, to: string, offset: number) {
      const query: Record<string, unknown> = {
        invoiceDateFrom: from,
        invoiceDateTo: to,
        from: offset,
        count: 1000,
        fields: FIELDS,
      };
      // Ved etterhenting filtrerer vi på leverandør direkte i API-et.
      if (ttSupplierFilterId) query.supplierId = ttSupplierFilterId;
      try {
        return await tripletexFetch("/v2/supplierInvoice", { sessionToken, query });
      } catch (e) {
        if (e instanceof TripletexError && (e.status === 401 || e.status === 403)) {
          sessionToken = await getSessionToken(admin, legalEntityId, true);
          return await tripletexFetch("/v2/supplierInvoice", { sessionToken, query });
        }
        throw e;
      }
    }

    let fetched = 0;
    let imported = 0;
    let skipped = 0;
    let updated = 0;
    let failed = 0;
    // Fakturaer fra leverandører som ikke følges lagres ikke i det hele tatt.
    let hoppetOverIkkeFulgt = 0;
    const touchedSupplierIds = new Set<string>();
    const nowIso = new Date().toISOString();
    let lastCompletedChunkTo: string | null = null;

    for (const chunk of chunks) {
      const invoices: any[] = [];
      for (let page = 0; page < 20; page++) {
        const res = await fetchPage(chunk.from, chunk.to, page * 1000);
        const values: any[] = res?.values ?? [];
        invoices.push(...values);
        if (values.length < 1000) break;
      }
      fetched += invoices.length;

      for (const inv of invoices) {
        try {
          const ttSup = inv?.supplier ?? {};
          const ttSupId = ttSup?.id != null ? String(ttSup.id) : null;

          // 1) Finn/opprett leverandør
          let supplier: any = ttSupId ? byTtId.get(ttSupId) : undefined;
          if (!supplier && ttSup?.organizationNumber) {
            supplier = byOrg.get(digits(ttSup.organizationNumber));
          }
          if (!supplier && ttSup?.name) supplier = byName.get(norm(ttSup.name));

          if (!supplier) {
            const { data: created, error: cErr } = await admin
              .from("suppliers")
              .insert({
                legal_entity_id: legalEntityId,
                name: String(ttSup?.name ?? "").trim() || `Tripletex ${ttSupId ?? "ukjent"}`,
                org_number: ttSup?.organizationNumber
                  ? String(ttSup.organizationNumber).trim()
                  : null,
                is_active: true,
                track_invoice_lines: false,
                tripletex_supplier_id: ttSupId,
                tripletex_supplier_number:
                  ttSup?.supplierNumber != null ? String(ttSup.supplierNumber) : null,
                tripletex_synced_at: nowIso,
              })
              .select("id, name, org_number, tripletex_supplier_id, track_invoice_lines")
              .single();
            if (cErr) throw new Error(cErr.message);
            supplier = created;
            if (ttSupId) byTtId.set(ttSupId, supplier);
          }
          // 1b) Følges leverandøren? Hvis ikke: hopp over fakturaen helt.
          // Leverandøren er likevel opprettet, slik at den kan skrus på senere.
          if (!supplier.track_invoice_lines) {
            hoppetOverIkkeFulgt++;
            continue;
          }
          touchedSupplierIds.add(supplier.id);

          const ttInvoiceId = String(inv.id);

          // 2) Finnes fakturaen fra før?
          const { data: existing } = await admin
            .from("invoices")
            .select("id, line_extraction_status")
            .eq("legal_entity_id", legalEntityId)
            .eq("tripletex_supplier_invoice_id", ttInvoiceId)
            .maybeSingle();

          if (existing) {
            if (supplier.track_invoice_lines && existing.line_extraction_status === "not_requested") {
              await admin
                .from("invoices")
                .update({ line_extraction_status: "pending" })
                .eq("id", existing.id);
              updated++;
            } else {
              skipped++;
            }
            continue;
          }

          // 3) Ny rad
          // Tripletex returnerer 0 når verdien mangler; da ligger beløpet i valutafeltene.
          const rawAmount = Number(inv.amount ?? 0);
          const rawExVat = Number(inv.amountExcludingVat ?? 0);
          const usedCurrencyAmount = rawAmount === 0;
          const amount = usedCurrencyAmount ? Number(inv.amountCurrency ?? 0) : rawAmount;
          const exVat = usedCurrencyAmount
            ? Number(inv.amountExcludingVatCurrency ?? 0)
            : rawExVat;
          // Fortegn bærer ingen betydning i NBhub; is_credit_note gjør den jobben.
          const absAmount = round2(Math.abs(amount));
          const vatUnknown = exVat === 0 && amount !== 0;
          const totalVat = vatUnknown ? null : round2(Math.abs(amount - exVat));
          const invoiceNumber = String(inv.invoiceNumber ?? "").trim() || `TT-${ttInvoiceId}`;

          const { error: insErr } = await admin.from("invoices").insert({
            legal_entity_id: legalEntityId,
            supplier_id: supplier.id,
            invoice_number: invoiceNumber,
            invoice_date: inv.invoiceDate ?? null,
            due_date: inv.invoiceDueDate ?? null,
            total_amount: absAmount,
            total_vat: totalVat,
            currency: usedCurrencyAmount ? (inv?.currency?.code ?? "NOK") : "NOK",
            is_credit_note: !!inv.isCreditNote,
            status: "imported",
            source: "tripletex",
            lines_source: null,
            tripletex_supplier_invoice_id: ttInvoiceId,
            tripletex_voucher_id: inv?.voucher?.id ? String(inv.voucher.id) : null,
            tripletex_voucher_number: inv?.voucher?.number ? String(inv.voucher.number) : null,
            tripletex_supplier_id: ttSupId,
            imported_from_tripletex_at: nowIso,
            pdf_status: "none",
            line_extraction_status: "pending",
          });

          if (insErr) {
            // Unik-konflikt = en parallell kjøring rakk det først. Ikke en feil.
            if ((insErr as any).code === "23505") {
              skipped++;
              continue;
            }
            throw new Error(insErr.message);
          }
          imported++;
        } catch (_e) {
          failed++;
        }
      }

      lastCompletedChunkTo = chunk.to;
      // Manuelle kall med eksplisitt `from`, og etterhenting for én leverandør,
      // skal ikke flytte den løpende posisjonen — og den skal aldri gå bakover.
      if (
        !isBackfill && !body.from &&
        (!cred.last_invoice_synced_date || chunk.to > cred.last_invoice_synced_date)
      ) {
        cred.last_invoice_synced_date = chunk.to;
        await admin
          .from("tripletex_credentials")
          .update({ last_invoice_synced_date: chunk.to })
          .eq("legal_entity_id", legalEntityId);
      }
    }

    // --- Leverandørstatistikk ---
    for (const sid of touchedSupplierIds) {
      const { data: stats } = await admin
        .from("invoices")
        .select("invoice_date")
        .eq("legal_entity_id", legalEntityId)
        .eq("supplier_id", sid)
        .order("invoice_date", { ascending: false });
      const rows = stats ?? [];
      await admin
        .from("suppliers")
        .update({
          last_invoice_date: rows[0]?.invoice_date ?? null,
          invoice_count: rows.length,
        })
        .eq("id", sid);
    }

    const details = {
      from: windowFrom,
      to: windowTo,
      behandlet_til: lastCompletedChunkTo,
      antall_biter: chunks.length,
      har_mer: harMer,
      oppdatert: updated,
    };

    if (logId) {
      await admin
        .from("tripletex_sync_log")
        .update({
          status: "success",
          completed_at: new Date().toISOString(),
          vouchers_fetched: fetched,
          vouchers_imported: imported,
          vouchers_skipped: skipped + updated,
          vouchers_failed: failed,
          details,
        })
        .eq("id", logId);
    }

    const credPatch: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
      last_sync_status: "success",
      last_sync_error: null,
    };
    // Kun et løpende kall (uten eksplisitt vindu) kan markere førsteimporten som ferdig.
    if (!harMer && !body.from && !body.to) credPatch.initial_import_done = true;
    await admin
      .from("tripletex_credentials")
      .update(credPatch)
      .eq("legal_entity_id", legalEntityId);

    return json({
      ok: true,
      fetched,
      imported,
      skipped,
      updated,
      failed,
      from: windowFrom,
      to: windowTo,
      behandlet_til: lastCompletedChunkTo,
      antall_biter: chunks.length,
      har_mer: harMer,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (logId) {
      await admin
        .from("tripletex_sync_log")
        .update({ status: "error", completed_at: new Date().toISOString(), error_message: msg })
        .eq("id", logId);
    }
    if (legalEntityId) {
      await admin
        .from("tripletex_credentials")
        .update({
          last_sync_status: "error",
          last_sync_error: msg,
          last_synced_at: new Date().toISOString(),
        })
        .eq("legal_entity_id", legalEntityId);
    }
    return json({ error: msg }, 500);
  }
});
