// Kobler en LEVERANDØRVARE (leverandør + varenummer, ev. navn) til en råvare — eller
// oppretter en ny råvare, eller merker den som «ikke vare» — og regner om alle
// berørte fakturaer med én gang.
//
// Alt som skrives skjer i databasefunksjonen `rm_link_supplier_item`, som kalles
// SOM DEN INNLOGGEDE BRUKEREN (tilgang, lås og revisjonsspor der). Denne funksjonen
// orkestrerer bare: koble → kjør matchemotoren per faktura → rapporter nøyaktig
// hva som ble gjort og hva som fortsatt står åpent.
//
// Input (JSON):
//   legal_entity_id, supplier_id, item_key ("sku:<norm>" eller "name:<norm>")
//   raw_material_id?            – eksisterende råvare
//   new_raw_material?           – { name, base_unit, category?, item_type?, sku?, declaration_name? }
//   package?                    – { package_size?, package_unit?, base_units_per_package?, confirm? }
//   set_primary?, not_raw_material?, reason?, line_ids?
//
// Svar: { ok, mode, raw_material_id, raw_material_supplier_id, created_raw_material,
//         lines_updated, invoices: [{ invoice_id, status, requires_review_count, auto_reconcile, rematched, error? }],
//         still_open_lines, failures }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type AnyRec = Record<string, unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Du må være pålogget" }, 401);
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user?.id) return json({ error: "Påloggingen er utløpt — logg inn på nytt" }, 401);

    const body = (await req.json().catch(() => ({}))) as AnyRec;
    const legalEntityId = String(body.legal_entity_id ?? "");
    const supplierId = String(body.supplier_id ?? "");
    const itemKey = String(body.item_key ?? "");
    if (!legalEntityId || !supplierId || !itemKey) {
      return json({ error: "legal_entity_id, supplier_id og item_key er påkrevd" }, 400);
    }
    // Linjeutvalg: utelatt = alle åpne linjer for varen (bakoverkompatibelt). Eksplisitt tomt avvises —
    // et tomt fryst utvalg skal aldri bli «alle». Bare gyldige UUID-er, maks 2000.
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let requestedLineIds: string[] | null = null;
    if (body.line_ids !== undefined && body.line_ids !== null) {
      if (!Array.isArray(body.line_ids) || body.line_ids.length === 0) {
        return json({ error: "Linjeutvalget er tomt. Oppdater varekortet og prøv igjen." }, 400);
      }
      if (body.line_ids.length > 2000 || !body.line_ids.every((x) => typeof x === "string" && UUID.test(x))) {
        return json({ error: "Ugyldig linjeutvalg" }, 400);
      }
      requestedLineIds = Array.from(new Set(body.line_ids as string[]));
    }

    // Fryst utvalg: linjer som er løst siden forhåndsvisningen (eller tilhører et annet selskap/leverandør)
    // hoppes over og rapporteres — de skal ikke overskrives av en utdatert beslutning.
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    let staleLineIds: string[] = [];
    if (requestedLineIds) {
      const { data: cur, error: curErr } = await admin.from("invoice_lines")
        .select("id, requires_review, invoices!inner(legal_entity_id, supplier_id)")
        .in("id", requestedLineIds);
      if (curErr) return json({ error: "Kunne ikke kontrollere linjeutvalget" }, 500);
      const stillOpen = new Set(((cur ?? []) as AnyRec[]).filter((l) => {
        const inv = (l.invoices ?? {}) as AnyRec;
        return l.requires_review === true && String(inv.legal_entity_id) === legalEntityId && String(inv.supplier_id) === supplierId;
      }).map((l) => String(l.id)));
      staleLineIds = requestedLineIds.filter((id) => !stillOpen.has(id));
      requestedLineIds = requestedLineIds.filter((id) => stillOpen.has(id));
      if (requestedLineIds.length === 0) {
        return json({ ok: true, mode: body.not_raw_material === true ? "ikke_vare" : "koblet", raw_material_id: null, raw_material_supplier_id: null,
          created_raw_material: false, lines_updated: 0, invoices: [], still_open_lines: 0, failures: [], skipped_line_ids: staleLineIds });
      }
    }

    const { data: linkRes, error: linkErr } = await userClient.rpc("rm_link_supplier_item", {
      p_legal_entity_id: legalEntityId,
      p_supplier_id: supplierId,
      p_item_key: itemKey,
      p_raw_material_id: body.raw_material_id ?? null,
      p_new_raw_material: body.new_raw_material ?? null,
      p_package: body.package ?? null,
      p_set_primary: body.set_primary === true,
      p_not_raw_material: body.not_raw_material === true,
      p_reason: body.reason ?? null,
      p_line_ids: requestedLineIds,
    });
    if (linkErr) {
      const status = /tilgang|forbidden/i.test(linkErr.message) ? 403 : /pålogging|innlogget/i.test(linkErr.message) ? 401 : 400;
      return json({ error: linkErr.message }, status);
    }
    const link = (linkRes ?? {}) as AnyRec;
    if (link.ok !== true) {
      const REASONS: Record<string, string> = {
        leverandor_finnes_ikke: "Leverandøren finnes ikke i dette selskapet",
        ugyldig_varenokkel: "Ugyldig varenøkkel",
        ny_vare_mangler_navn_eller_grunnenhet: "Ny råvare må ha navn og grunnenhet",
        mangler_ravare: "Velg en råvare, eller opprett en ny",
        ravare_i_annet_selskap: "Råvaren tilhører et annet selskap",
      };
      const reason = String(link.reason ?? "");
      return json({ ok: false, ...link, error: REASONS[reason] ?? `Koblingen ble avvist (${reason || "ukjent årsak"})` }, 400);
    }

    // Regn om hver berørt faktura med motoren (tjenestekall). Feil her gjør ikke
    // koblingen ugyldig — linjene står som «må beregnes på nytt» til neste kjøring.
    const invoiceIds = Array.isArray(link.invoice_ids) ? (link.invoice_ids as string[]) : [];
    // Ved fryst utvalg regnes bare de faktisk endrede linjene om — nye linjer som kom etter
    // forhåndsvisningen røres ikke av denne operasjonen (de får den lagrede koblingen ved sin egen matching).
    const changedIds = Array.isArray(link.line_ids) ? (link.line_ids as string[]) : [];
    const linesByInvoice = new Map<string, string[]>();
    if (requestedLineIds && changedIds.length) {
      const { data: cl, error: clErr } = await admin.from("invoice_lines").select("id, invoice_id").in("id", changedIds);
      if (clErr) return json({ error: "Kunne ikke lese endrede linjer" }, 500);
      for (const l of (cl ?? []) as AnyRec[]) {
        const k = String(l.invoice_id);
        linesByInvoice.set(k, [...(linesByInvoice.get(k) ?? []), String(l.id)]);
      }
    }
    // Omregning med tidsbudsjett og begrenset samtidighet: plattformen avbryter etter 150 s, og da
    // mistet brukeren hele svaret selv om koblingen var lagret. Fakturaer som ikke rekkes, rapporteres
    // som ikke omregnet (linjene står som «må beregnes på nytt» til neste kjøring) — koblingen er uendret.
    const startedAt = Date.now();
    const BUDGET_MS = 90_000;
    const PER_CALL_MS = 45_000;
    const CONCURRENCY = 4;
    const invoices: AnyRec[] = invoiceIds.map((id) => ({ invoice_id: id }));
    let next = 0;
    const worker = async () => {
      while (next < invoiceIds.length) {
        const idx = next++;
        const inv = invoices[idx];
        const invoiceId = invoiceIds[idx];
        const scoped = requestedLineIds ? linesByInvoice.get(invoiceId) ?? [] : null;
        if (scoped && scoped.length === 0) { Object.assign(inv, { rematched: false, skipped: "ingen_endrede_linjer" }); continue; }
        const left = BUDGET_MS - (Date.now() - startedAt);
        if (left < 5_000) { Object.assign(inv, { rematched: false, error: "Omregningen rakk ikke denne fakturaen — den regnes om ved neste kjøring" }); continue; }
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/match-invoice-lines`, {
            method: "POST",
            headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify(scoped ? { invoice_id: invoiceId, line_ids: scoped } : { invoice_id: invoiceId }),
            signal: AbortSignal.timeout(Math.min(PER_CALL_MS, left)),
          });
          const mj = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(String((mj as AnyRec)?.error ?? res.status));
          Object.assign(inv, { rematched: true, auto_reconcile: (mj as AnyRec)?.auto_reconcile ?? null });
        } catch (e) {
          const timedOut = e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError");
          // Et avbrutt kall kan fortsatt fullføres på serveren — utfallet er ukjent, ikke «feilet».
          Object.assign(inv, { rematched: false, error: timedOut ? "Omregningen tok for lang tid — utfallet kontrolleres ved neste kjøring" : (e instanceof Error ? e.message : String(e)) });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, invoiceIds.length) }, worker));

    // Tilstand etterpå: status per faktura og åpne linjer for varen.
    if (invoiceIds.length) {
      const { data: invRows } = await admin
        .from("invoices")
        .select("id, status, reconciled_mode, invoice_number")
        .in("id", invoiceIds);
      const byId = new Map((invRows ?? []).map((r: AnyRec) => [String(r.id), r]));
      const lineIds = Array.isArray(link.line_ids) ? (link.line_ids as string[]) : [];
      const { data: lineRows } = lineIds.length
        ? await admin.from("invoice_lines").select("id, invoice_id, requires_review, review_reason").in("id", lineIds)
        : { data: [] as AnyRec[] };
      for (const inv of invoices) {
        const row = byId.get(String(inv.invoice_id));
        inv.status = row?.status ?? null;
        inv.reconciled_mode = row?.reconciled_mode ?? null;
        inv.invoice_number = row?.invoice_number ?? null;
        const mine = (lineRows ?? []).filter((l: AnyRec) => String(l.invoice_id) === String(inv.invoice_id));
        inv.requires_review_count = mine.filter((l: AnyRec) => l.requires_review === true).length;
        inv.review_reasons = Array.from(new Set(mine.flatMap((l: AnyRec) => String(l.review_reason ?? "").split(",").filter(Boolean))));
      }
    }
    const stillOpen = invoices.reduce((s, i) => s + Number(i.requires_review_count ?? 0), 0);

    return json({
      ok: true,
      mode: link.mode,
      raw_material_id: link.raw_material_id ?? null,
      raw_material_supplier_id: link.raw_material_supplier_id ?? null,
      created_raw_material: link.created_raw_material === true,
      lines_updated: Number(link.lines_updated ?? 0),
      invoices,
      still_open_lines: stillOpen,
      failures: link.failures ?? [],
      // Linjer i det frysta utvalget som ikke ble endret (løst, låst, ført eller på avstemt/flagget faktura).
      skipped_line_ids: requestedLineIds ? [...staleLineIds, ...requestedLineIds.filter((id) => !changedIds.includes(id))] : [],
    });
  } catch (e) {
    console.error("link-supplier-item error", e);
    return json({ error: (e as Error).message }, 500);
  }
});

