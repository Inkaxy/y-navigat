import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, baseUrl, authHeader } from "../_shared/tripletex.ts";

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

interface TtSupplier {
  id: number;
  name?: string | null;
  organizationNumber?: string | null;
  supplierNumber?: string | number | null;
  isInactive?: boolean | null;
  email?: string | null;
  phoneNumber?: string | null;
}

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const digits = (s: unknown) => String(s ?? "").replace(/\s+/g, "");
const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Missing authorization" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authorization } } },
    );

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "Invalid session" }, 401);

    const body = (await req.json().catch(() => ({}))) as { legal_entity_id?: string };
    const legalEntityId = body?.legal_entity_id;
    if (!legalEntityId) return json({ error: "legal_entity_id is required" }, 400);

    const { data: hasAccess, error: accessErr } = await userClient.rpc(
      "has_ravarer_invoice_access",
      { _legal_entity_id: legalEntityId, _required_level: "admin" },
    );
    if (accessErr || !hasAccess) return json({ error: "Forbidden" }, 403);

    const sessionToken = await getSessionToken(admin, legalEntityId);
    const base = baseUrl();

    // --- Hent alle leverandører fra Tripletex (paginert) ---
    const ttSuppliers: TtSupplier[] = [];
    const pageSize = 1000;
    let from = 0;
    for (let page = 0; page < 20; page++) {
      const url =
        `${base}/v2/supplier?from=${from}&count=${pageSize}` +
        `&fields=id,name,organizationNumber,supplierNumber,isInactive,email,phoneNumber`;
      const res = await fetch(url, {
        headers: { Authorization: authHeader(sessionToken), Accept: "application/json" },
      });
      const text = await res.text();
      if (!res.ok) return json({ error: `Tripletex ${res.status}: ${text.slice(0, 400)}` }, 500);
      const parsed = JSON.parse(text);
      const values: TtSupplier[] = parsed?.values ?? [];
      ttSuppliers.push(...values);
      const total = Number(parsed?.fullResultSize ?? ttSuppliers.length);
      from += pageSize;
      if (values.length === 0 || ttSuppliers.length >= total) break;
    }

    // --- Eksisterende leverandører for selskapet ---
    const { data: existing, error: exErr } = await admin
      .from("suppliers")
      .select(
        "id, name, org_number, contact_email, contact_phone, tripletex_supplier_id, tripletex_supplier_number, tripletex_is_inactive",
      )
      .eq("legal_entity_id", legalEntityId);
    if (exErr) return json({ error: exErr.message }, 500);

    const rows = (existing ?? []) as any[];
    const byTtId = new Map<string, any>();
    const byOrg = new Map<string, any>();
    const byName = new Map<string, any>();
    for (const r of rows) {
      if (r.tripletex_supplier_id) byTtId.set(String(r.tripletex_supplier_id), r);
      if (!empty(r.org_number)) {
        const k = digits(r.org_number);
        if (k && !byOrg.has(k)) byOrg.set(k, r);
      }
      const n = norm(r.name);
      if (n && !byName.has(n)) byName.set(n, r);
    }

    let opprettet = 0;
    let oppdatert = 0;
    let uendret = 0;
    const nowIso = new Date().toISOString();

    for (const tt of ttSuppliers) {
      const ttId = String(tt.id);
      let match = byTtId.get(ttId);
      if (!match && !empty(tt.organizationNumber)) {
        match = byOrg.get(digits(tt.organizationNumber));
      }
      if (!match) match = byName.get(norm(tt.name));

      if (match) {
        const patch: Record<string, unknown> = {
          tripletex_supplier_id: ttId,
          tripletex_supplier_number: tt.supplierNumber != null ? String(tt.supplierNumber) : null,
          tripletex_is_inactive: !!tt.isInactive,
          tripletex_synced_at: nowIso,
        };
        // Fyll kun tomme felter — aldri overskriv brukerens data.
        if (empty(match.org_number) && !empty(tt.organizationNumber)) {
          patch.org_number = String(tt.organizationNumber).trim();
        }
        if (empty(match.contact_email) && !empty(tt.email)) {
          patch.contact_email = String(tt.email).trim();
        }
        if (empty(match.contact_phone) && !empty(tt.phoneNumber)) {
          patch.contact_phone = String(tt.phoneNumber).trim();
        }

        const changed =
          String(match.tripletex_supplier_id ?? "") !== ttId ||
          String(match.tripletex_supplier_number ?? "") !==
            String(patch.tripletex_supplier_number ?? "") ||
          !!match.tripletex_is_inactive !== !!tt.isInactive ||
          "org_number" in patch ||
          "contact_email" in patch ||
          "contact_phone" in patch;

        const { error: upErr } = await admin.from("suppliers").update(patch).eq("id", match.id);
        if (upErr) return json({ error: upErr.message }, 500);

        // Unngå at samme rad matches på nytt av en annen Tripletex-leverandør.
        byTtId.set(ttId, match);
        if (changed) oppdatert++;
        else uendret++;
      } else {
        const { data: inserted, error: insErr } = await admin
          .from("suppliers")
          .insert({
            legal_entity_id: legalEntityId,
            name: (tt.name ?? "").trim() || `Tripletex ${ttId}`,
            org_number: empty(tt.organizationNumber) ? null : String(tt.organizationNumber).trim(),
            contact_email: empty(tt.email) ? null : String(tt.email).trim(),
            contact_phone: empty(tt.phoneNumber) ? null : String(tt.phoneNumber).trim(),
            is_active: !tt.isInactive,
            track_invoice_lines: false,
            tripletex_supplier_id: ttId,
            tripletex_supplier_number:
              tt.supplierNumber != null ? String(tt.supplierNumber) : null,
            tripletex_is_inactive: !!tt.isInactive,
            tripletex_synced_at: nowIso,
          })
          .select("id, name, org_number")
          .maybeSingle();
        if (insErr) return json({ error: insErr.message }, 500);
        opprettet++;
        if (inserted) {
          byTtId.set(ttId, inserted);
          const n = norm((inserted as any).name);
          if (n && !byName.has(n)) byName.set(n, inserted);
        }
      }
    }

    return json({ ok: true, hentet: ttSuppliers.length, opprettet, oppdatert, uendret });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
