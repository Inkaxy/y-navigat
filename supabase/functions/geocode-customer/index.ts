// Geokoder en kundes leveringsadresse via Nominatim (OpenStreetMap)
// og lagrer geocode_latitude/longitude på customers-raden.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "NBHub Ordre/1.0 (https://nbhub.no; kontakt@nottero-bakeri.no)";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { customer_id, force } = await req.json().catch(() => ({}));
    if (!customer_id || typeof customer_id !== "string") {
      return new Response(JSON.stringify({ error: "customer_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cust, error: custErr } = await admin
      .from("customers")
      .select("id, delivery_address_line1, delivery_address_line2, delivery_postal_code, delivery_city, delivery_country, geocode_latitude, geocode_longitude")
      .eq("id", customer_id)
      .maybeSingle();
    if (custErr) throw custErr;
    if (!cust) {
      return new Response(JSON.stringify({ error: "customer not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!force && cust.geocode_latitude != null && cust.geocode_longitude != null) {
      return new Response(JSON.stringify({
        ok: true, skipped: true,
        lat: cust.geocode_latitude, lon: cust.geocode_longitude,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const street = [cust.delivery_address_line1, cust.delivery_address_line2].filter(Boolean).join(" ");
    if (!street && !cust.delivery_postal_code && !cust.delivery_city) {
      return new Response(JSON.stringify({ error: "Kunden mangler leveringsadresse" }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const country = (cust.delivery_country ?? "Norway").trim() || "Norway";
    const params = new URLSearchParams({
      format: "jsonv2",
      addressdetails: "0",
      limit: "1",
      countrycodes: country.toLowerCase().startsWith("no") ? "no" : "",
      street: street || "",
      postalcode: cust.delivery_postal_code ?? "",
      city: cust.delivery_city ?? "",
      country,
    });
    // fjern tomme felter
    for (const [k, v] of [...params.entries()]) if (!v) params.delete(k);

    let res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
    });
    let hits = res.ok ? (await res.json() as Array<{ lat: string; lon: string; display_name: string }>) : [];

    // Fallback: prøv freeform-query
    if (hits.length === 0) {
      const q = [street, cust.delivery_postal_code, cust.delivery_city, country].filter(Boolean).join(", ");
      res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      });
      hits = res.ok ? await res.json() : [];
    }
    // Siste fallback: postnr + by + land
    if (hits.length === 0 && (cust.delivery_postal_code || cust.delivery_city)) {
      const q = [cust.delivery_postal_code, cust.delivery_city, country].filter(Boolean).join(", ");
      res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
      });
      hits = res.ok ? await res.json() : [];
    }

    if (hits.length === 0) {
      return new Response(JSON.stringify({ error: "Fant ingen treff hos Nominatim" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const lat = Number(hits[0].lat);
    const lon = Number(hits[0].lon);

    const { error: updErr } = await admin
      .from("customers")
      .update({
        geocode_latitude: lat,
        geocode_longitude: lon,
        geocode_source: "nominatim",
        geocode_updated_at: new Date().toISOString(),
      })
      .eq("id", customer_id);
    if (updErr) throw updErr;

    return new Response(JSON.stringify({ ok: true, lat, lon, display_name: hits[0].display_name }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
