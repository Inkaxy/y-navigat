import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  validateOutcomes,
  type NegotiationItemRow,
  type PreparedOutcome,
  type RecipientRow,
  type ResponseRow,
} from "./validate.ts";

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

const today = () => new Date().toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: cErr } = await userClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (cErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => null);
    const negotiation_id = typeof body?.negotiation_id === "string" ? body.negotiation_id : null;
    if (!negotiation_id || !Array.isArray(body?.outcomes)) return json({ error: "invalid_payload" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: neg, error: negErr } = await userClient
      .from("negotiations")
      .select("id, legal_entity_id, status")
      .eq("id", negotiation_id)
      .maybeSingle();
    if (negErr || !neg) return json({ error: "not_found" }, 404);

    // Skrivetilgangen må bekreftes eksplisitt — leserettighet via RLS er ikke nok.
    // Fail closed: usikker tilgang = ingen skriving.
    const { data: hasWrite, error: accessErr } = await userClient.rpc("has_ravarer_access", {
      _user_id: user.id,
      _legal_entity_id: neg.legal_entity_id,
      _min_level: "write",
    });
    if (accessErr) return json({ error: "Kunne ikke kontrollere tilgang" }, 500);
    if (hasWrite !== true) return json({ error: "Mangler skrivetilgang til råvarer" }, 403);

    // Alle ID-er valideres mot forhandlingen FØR første skriving.
    const [itemsRes, recRes, respRes] = await Promise.all([
      admin
        .from("negotiation_items")
        .select("id, negotiation_id, raw_material_id, raw_materials(base_unit)")
        .eq("negotiation_id", negotiation_id),
      admin.from("negotiation_recipients").select("id, negotiation_id, supplier_id").eq("negotiation_id", negotiation_id),
      admin.from("negotiation_responses").select("id, negotiation_item_id, recipient_id").eq("negotiation_id", negotiation_id),
    ]);
    if (itemsRes.error || recRes.error || respRes.error) {
      return json({ error: "Kunne ikke lese forhandlingen" }, 500);
    }

    type ItemRaw = { id: string; negotiation_id: string; raw_material_id: string | null; raw_materials?: { base_unit?: string | null } | null };
    const items: NegotiationItemRow[] = ((itemsRes.data ?? []) as unknown as ItemRaw[]).map((i) => ({
      id: i.id,
      negotiation_id: i.negotiation_id,
      raw_material_id: i.raw_material_id,
      base_unit: i.raw_materials?.base_unit ?? null,
    }));

    const { errors, prepared } = validateOutcomes({
      outcomes: body.outcomes,
      items,
      recipients: (recRes.data ?? []) as unknown as RecipientRow[],
      responses: (respRes.data ?? []) as unknown as ResponseRow[],
      negotiationId: negotiation_id,
    });
    if (errors.length > 0) return json({ error: errors[0], errors }, 400);

    // Råvarene og leverandørene må tilhøre SAMME selskap som forhandlingen før
    // vi skriver med service-role. Ellers kan en gyldig forhandling brukes til
    // å endre avtaler i et annet selskap.
    const rmIds = [...new Set(prepared.map((o) => o.raw_material_id).filter((v): v is string => !!v))];
    const supIds = [...new Set(prepared.map((o) => o.supplier_id).filter((v): v is string => !!v))];
    if (rmIds.length > 0) {
      const { data: rms, error: rmErr } = await admin
        .from("raw_materials")
        .select("id, legal_entity_id")
        .in("id", rmIds);
      if (rmErr) return json({ error: "Kunne ikke kontrollere råvarene" }, 500);
      const okIds = new Set((rms ?? []).filter((r) => r.legal_entity_id === neg.legal_entity_id).map((r) => r.id));
      const bad = rmIds.filter((id) => !okIds.has(id));
      if (bad.length > 0) return json({ error: "En eller flere råvarer hører til et annet selskap.", failures: bad }, 400);
    }
    if (supIds.length > 0) {
      const { data: sups, error: supErr } = await admin
        .from("suppliers")
        .select("id, legal_entity_id")
        .in("id", supIds);
      if (supErr) return json({ error: "Kunne ikke kontrollere leverandørene" }, 500);
      const okIds = new Set((sups ?? []).filter((r) => r.legal_entity_id === neg.legal_entity_id).map((r) => r.id));
      const bad = supIds.filter((id) => !okIds.has(id));
      if (bad.length > 0) return json({ error: "En eller flere leverandører hører til et annet selskap.", failures: bad }, 400);
    }

    const failures: string[] = [];

    for (const o of prepared as PreparedOutcome[]) {
      const { error: outErr } = await admin.from("negotiation_outcomes").upsert(
        {
          negotiation_id,
          negotiation_item_id: o.negotiation_item_id,
          winner_recipient_id: o.winner_recipient_id,
          winner_response_id: o.winner_response_id,
          agreed_price: o.agreed_price,
          agreed_package_size: o.agreed_package_size,
          agreed_package_unit: o.agreed_package_unit,
          set_as_primary: o.set_as_primary,
          applied_to_supplier: o.apply_to_supplier,
          notes: o.notes,
        },
        { onConflict: "negotiation_id,negotiation_item_id" },
      );
      if (outErr) {
        failures.push(`Utfallet for varelinjen kunne ikke lagres: ${outErr.message}`);
        continue;
      }

      if (!o.apply_to_supplier || !o.supplier_id || !o.raw_material_id) continue;

      // Les eksisterende avtale, slik at tomme felt ikke sletter bekreftet pakning.
      const { data: existing, error: exErr } = await admin
        .from("raw_material_suppliers")
        .select("package_size, package_unit, package_confirmed_at, package_confirmed_by, is_primary")
        .eq("raw_material_id", o.raw_material_id)
        .eq("supplier_id", o.supplier_id)
        .maybeSingle();
      if (exErr) {
        failures.push(`Kunne ikke lese leverandøravtalen: ${exErr.message}`);
        continue;
      }

      const keepPackage = o.agreed_package_size == null || o.agreed_package_unit == null;
      const row: Record<string, unknown> = {
        raw_material_id: o.raw_material_id,
        supplier_id: o.supplier_id,
        agreed_price: o.agreed_price,
        agreed_price_per_base_unit: o.agreed_price_per_base_unit,
        agreement_valid_from: today(),
      };
      // set_as_primary = false skal ALDRI frata en eksisterende primærkobling
      // statusen. Bare nye rader får en eksplisitt verdi.
      if (o.set_as_primary) row.is_primary = true;
      else if (!existing) row.is_primary = false;
      if (keepPackage) {
        if (existing?.package_size != null) row.package_size = existing.package_size;
        if (existing?.package_unit != null) row.package_unit = existing.package_unit;
        if (existing?.package_confirmed_at) {
          row.package_confirmed_at = existing.package_confirmed_at;
          row.package_confirmed_by = existing.package_confirmed_by;
        }
      } else {
        row.package_size = o.agreed_package_size;
        row.package_unit = o.agreed_package_unit;
        row.package_confirmed_at = new Date().toISOString();
        row.package_confirmed_by = user.id;
      }

      const { error: rmsErr } = await admin
        .from("raw_material_suppliers")
        .upsert(row, { onConflict: "raw_material_id,supplier_id" });
      if (rmsErr) {
        failures.push(`Kunne ikke oppdatere leverandøravtalen: ${rmsErr.message}`);
        continue;
      }

      if (o.set_as_primary) {
        const { error: primErr } = await admin
          .from("raw_materials")
          .update({ primary_supplier_id: o.supplier_id })
          .eq("id", o.raw_material_id);
        if (primErr) failures.push(`Kunne ikke sette primærleverandør: ${primErr.message}`);
      }
    }

    if (failures.length > 0) {
      // Delvis skriving: forhandlingen blir IKKE avsluttet, og tokens beholdes.
      console.error("apply-negotiation-outcome failures", failures);
      return json(
        {
          error: "Noen linjer ble ikke lagret. Forhandlingen er ikke avsluttet.",
          failures,
          applied: prepared.length - failures.length,
        },
        500,
      );
    }

    const { error: concludeErr } = await admin
      .from("negotiations")
      .update({ status: "concluded", concluded_at: new Date().toISOString() })
      .eq("id", negotiation_id);
    if (concludeErr) return json({ error: `Kunne ikke avslutte forhandlingen: ${concludeErr.message}` }, 500);

    const { error: expireErr } = await admin
      .from("negotiation_recipients")
      .update({ status: "expired", expires_at: new Date().toISOString() })
      .eq("negotiation_id", negotiation_id);
    if (expireErr) {
      return json(
        { error: `Forhandlingen er avsluttet, men lenkene til leverandørene ble ikke stengt: ${expireErr.message}` },
        500,
      );
    }

    const { error: msgErr } = await admin.from("negotiation_messages").insert({
      negotiation_id,
      event_type: "concluded",
      actor: "nbhub",
      payload: { count: prepared.length },
    });
    if (msgErr) console.error("apply-negotiation-outcome: logg", msgErr);

    return json({ success: true, applied: prepared.length });
  } catch (e) {
    console.error("apply-negotiation-outcome", e);
    return json({ error: "internal_error" }, 500);
  }
});
