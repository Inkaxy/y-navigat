// Importerer leverandørfakturaer fra Tripletex (/v2/supplierInvoice) til public.invoices.
// Kjøres av cron eller manuelt fra Råvarer → Leverandører.
// Henter IKKE PDF og kaller IKKE AI — det gjøres av egne funksjoner.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch, TripletexError } from "../_shared/tripletex.ts";
import {
  nextCursor,
  pagesTruncated,
  planExistingUpdate,
  statusSummary,
  syncStatus,
  type ChunkResult,
} from "./syncState.ts";

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
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;
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
    } else if (body.from || body.to) {
      windowFrom = body.from ?? cred.last_invoice_synced_date ?? fallbackStart;
      windowTo = body.to ?? addDays(today, 1);
      if (windowTo <= windowFrom) windowTo = addDays(windowFrom, 1);
    } else {
      // Løpende kjøring: klamp cursor til i dag (aldri framtid) og ta 7 dagers overlapp.
      const rawCursor = cred.last_invoice_synced_date ?? fallbackStart;
      const clamped = rawCursor > today ? today : rawCursor;
      windowFrom = addDays(clamped, -7);
      windowTo = addDays(today, 1);
    }


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
        count: PAGE_SIZE,
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
    const chunkResults: ChunkResult[] = [];
    const failedSamples: string[] = [];
    const conflicts: { invoice_id: string; invoice_number: string; fields: unknown[] }[] = [];


    for (const chunk of chunks) {
      const invoices: any[] = [];
      let pagesRead = 0;
      let lastPageSize = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const res = await fetchPage(chunk.from, chunk.to, page * PAGE_SIZE);
        const values: any[] = res?.values ?? [];
        invoices.push(...values);
        pagesRead = page + 1;
        lastPageSize = values.length;
        if (values.length < PAGE_SIZE) break;
      }
      const truncated = pagesTruncated(pagesRead, MAX_PAGES, lastPageSize, PAGE_SIZE);
      const failedBefore = failed;
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
            .select(
              "id, line_extraction_status, invoice_date, total_amount, is_credit_note, " +
                "tripletex_voucher_id, tripletex_voucher_number, tripletex_supplier_id",
            )
            .eq("legal_entity_id", legalEntityId)
            .eq("tripletex_supplier_invoice_id", ttInvoiceId)
            .maybeSingle();

          if (existing) {
            // Eksisterende faktura får oppdaterte Tripletex-referanser, men beløp,
            // dato og kreditnota-flagg røres aldri — manuell matching og avstemming
            // skal ikke nullstilles. Avvik rapporteres som konflikt i stedet.
            const ttAmountRaw = Number(inv.amount ?? 0) || Number(inv.amountCurrency ?? 0);
            const plan = planExistingUpdate(existing as any, {
              invoice_date: inv.invoiceDate ?? null,
              total_amount: Number.isFinite(ttAmountRaw) ? ttAmountRaw : null,
              is_credit_note: !!inv.isCreditNote,
              tripletex_voucher_id: inv?.voucher?.id ? String(inv.voucher.id) : null,
              tripletex_voucher_number: inv?.voucher?.number ? String(inv.voucher.number) : null,
              tripletex_supplier_id: ttSupId,
            }, { trackLines: !!supplier.track_invoice_lines });

            if (Object.keys(plan.patch).length > 0) {
              const { error: updErr } = await admin.from("invoices").update(plan.patch).eq("id", existing.id);
              if (updErr) throw new Error(updErr.message);
              updated++;
            } else {
              skipped++;
            }
            if (plan.conflicts.length > 0) {
              conflicts.push({ invoice_id: existing.id, invoice_number: String(inv.invoiceNumber ?? ""), fields: plan.conflicts });
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
        } catch (e) {
          failed++;
          const msg = e instanceof Error ? e.message : String(e);
          if (failedSamples.length < 5) failedSamples.push(msg);
          console.error("tripletex-sync-invoices: faktura feilet", msg);
        }
      }

      chunkResults.push({
        from: chunk.from,
        to: chunk.to,
        failed: failed - failedBefore,
        truncated,
      });
      if (failed === failedBefore && !truncated) lastCompletedChunkTo = chunk.to;
    }

    // Cursor flyttes bare til og med SISTE fullførte bit. En bit med feil eller
    // ufullstendig henting hentes på nytt neste kjøring.
    const cursorTo = nextCursor(chunkResults, cred.last_invoice_synced_date ?? null, today, {
      isBackfill,
      hasExplicitFrom: !!body.from,
    });
    if (cursorTo) {
      cred.last_invoice_synced_date = cursorTo;
      await admin
        .from("tripletex_credentials")
        .update({ last_invoice_synced_date: cursorTo })
        .eq("legal_entity_id", legalEntityId);
    }

    // --- Leverandørstatistikk ---
    for (const sid of touchedSupplierIds) {
      // Antall telles med exact count, ikke ved å laste ned radene (upaginert
      // select stoppet på 1000 og ga for lavt antall).
      const { count } = await admin
        .from("invoices")
        .select("id", { count: "exact", head: true })
        .eq("legal_entity_id", legalEntityId)
        .eq("supplier_id", sid);
      const { data: latest } = await admin
        .from("invoices")
        .select("invoice_date")
        .eq("legal_entity_id", legalEntityId)
        .eq("supplier_id", sid)
        .order("invoice_date", { ascending: false })
        .limit(1);
      await admin
        .from("suppliers")
        .update({
          last_invoice_date: latest?.[0]?.invoice_date ?? null,
          invoice_count: count ?? 0,
        })
        .eq("id", sid);
    }


    const status = syncStatus(chunkResults);
    const summary = statusSummary(chunkResults);
    const ufullstendig = chunkResults.some((c) => c.truncated);

    const details = {
      from: windowFrom,
      to: windowTo,
      behandlet_til: lastCompletedChunkTo,
      antall_biter: chunks.length,
      har_mer: harMer || ufullstendig,
      ufullstendig_henting: ufullstendig,
      oppdatert: updated,
      hoppet_over_ikke_fulgt: hoppetOverIkkeFulgt,
      etterhenting: isBackfill ? body.supplier_id : null,
      biter: chunkResults,
      feil_eksempler: failedSamples,
      konflikter: conflicts,
    };

    if (logId) {
      await admin
        .from("tripletex_sync_log")
        .update({
          // «success» kun når ingenting feilet og hentingen var komplett.
          status,
          completed_at: new Date().toISOString(),
          vouchers_fetched: fetched,
          vouchers_imported: imported,
          vouchers_skipped: skipped + updated,
          vouchers_failed: failed,
          error_message: summary,
          details,
        })
        .eq("id", logId);
    }

    const credPatch: Record<string, unknown> = {
      last_synced_at: new Date().toISOString(),
      last_sync_status: status,
      last_sync_error: summary,
    };
    // Kun en fullstendig, feilfri løpende kjøring kan markere førsteimporten som ferdig.
    if (!isBackfill && !harMer && !ufullstendig && failed === 0 && !body.from && !body.to) {
      credPatch.initial_import_done = true;
    }
    await admin
      .from("tripletex_credentials")
      .update(credPatch)
      .eq("legal_entity_id", legalEntityId);

    return json({
      ok: status !== "error",
      status,
      melding: summary,
      fetched,
      imported,
      skipped,
      updated,
      failed,
      ufullstendig_henting: ufullstendig,
      konflikter: conflicts.length,
      hoppet_over_ikke_fulgt: hoppetOverIkkeFulgt,
      etterhenting: isBackfill,
      from: windowFrom,
      to: windowTo,
      behandlet_til: lastCompletedChunkTo,
      antall_biter: chunks.length,
      har_mer: harMer || ufullstendig,
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
