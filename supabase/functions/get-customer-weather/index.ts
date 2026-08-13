// Værvarsel for en kundes leveringsadresse.
// - Slår opp kundens geocode_latitude/longitude (geokoder via Nominatim ved behov)
// - Henter varsel fra api.met.no (krever beskrivende User-Agent — derfor server-side)
// - Cacher svaret i public.weather_cache (unik lat/lon, 2 timer)
// Attribusjon i klienten: «Værvarsel fra Yr, levert av Meteorologisk institutt og NRK».

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "NBhub/1.0 (https://nbhub.no; kontakt@nottero-bakeri.no)";
const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
// Bakeriets posisjon — siste fallback når kunden ikke lar seg geokode
const BAKERY = { lat: 59.2181, lon: 10.4295 };

type DayForecast = { symbolCode: string; tempMax: number; tempMin: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function osloParts(iso: string): { date: string; hour: number } {
  const d = new Date(iso);
  const fmt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.format(d); // "2026-08-14 13"
  const [date, hourStr] = parts.split(" ");
  return { date, hour: Number(hourStr) };
}

type MetEntry = {
  time: string;
  data: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string } };
    next_6_hours?: { summary?: { symbol_code?: string } };
    next_12_hours?: { summary?: { symbol_code?: string } };
  };
};

function aggregate(series: MetEntry[]): Record<string, DayForecast> {
  const buckets = new Map<
    string,
    { temps: number[]; symbol?: string; symbolDist: number }
  >();
  for (const s of series) {
    const { date, hour } = osloParts(s.time);
    const temp = s.data.instant?.details?.air_temperature;
    const symbol =
      s.data.next_6_hours?.summary?.symbol_code ??
      s.data.next_1_hours?.summary?.symbol_code ??
      s.data.next_12_hours?.summary?.symbol_code;
    let b = buckets.get(date);
    if (!b) {
      b = { temps: [], symbolDist: Number.POSITIVE_INFINITY };
      buckets.set(date, b);
    }
    if (typeof temp === "number") b.temps.push(temp);
    // dagssymbol: det nærmest kl 12
    const dist = Math.abs(hour - 12);
    if (symbol && dist < b.symbolDist) {
      b.symbol = symbol;
      b.symbolDist = dist;
    }
  }
  const out: Record<string, DayForecast> = {};
  for (const [date, b] of buckets) {
    if (b.temps.length === 0 || !b.symbol) continue;
    out[date] = {
      symbolCode: b.symbol,
      tempMax: Math.round(Math.max(...b.temps)),
      tempMin: Math.round(Math.min(...b.temps)),
    };
  }
  return out;
}

async function nominatim(params: URLSearchParams): Promise<{ lat: number; lon: number } | null> {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const hits = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!Array.isArray(hits) || hits.length === 0) return null;
  return { lat: Number(hits[0].lat), lon: Number(hits[0].lon) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const customerId = typeof body?.customer_id === "string" ? body.customer_id : null;
    const dateFrom = typeof body?.date_from === "string" ? body.date_from : null;
    const dateTo = typeof body?.date_to === "string" ? body.date_to : null;
    if (!customerId) return json({ error: "customer_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cust, error: custErr } = await admin
      .from("customers")
      .select(
        "id, delivery_address_line1, delivery_postal_code, delivery_city, delivery_country, geocode_latitude, geocode_longitude",
      )
      .eq("id", customerId)
      .maybeSingle();
    if (custErr) throw custErr;
    if (!cust) return json({ error: "customer not found" }, 404);

    let lat = cust.geocode_latitude != null ? Number(cust.geocode_latitude) : null;
    let lon = cust.geocode_longitude != null ? Number(cust.geocode_longitude) : null;
    let geocoded = false;

    if (lat == null || lon == null) {
      const country = (cust.delivery_country ?? "Norway").trim() || "Norway";
      let hit: { lat: number; lon: number } | null = null;
      if (cust.delivery_postal_code || cust.delivery_city) {
        const p = new URLSearchParams({ format: "jsonv2", limit: "1", country });
        if (cust.delivery_postal_code) p.set("postalcode", cust.delivery_postal_code);
        if (cust.delivery_city) p.set("city", cust.delivery_city);
        hit = await nominatim(p);
      }
      if (!hit && cust.delivery_address_line1) {
        const p = new URLSearchParams({ format: "jsonv2", limit: "1", country });
        p.set("street", cust.delivery_address_line1);
        if (cust.delivery_postal_code) p.set("postalcode", cust.delivery_postal_code);
        if (cust.delivery_city) p.set("city", cust.delivery_city);
        hit = await nominatim(p);
      }
      if (hit) {
        lat = hit.lat;
        lon = hit.lon;
        geocoded = true;
        await admin
          .from("customers")
          .update({
            geocode_latitude: lat,
            geocode_longitude: lon,
            geocode_source: "nominatim",
            geocode_updated_at: new Date().toISOString(),
          })
          .eq("id", customerId);
      } else {
        lat = BAKERY.lat;
        lon = BAKERY.lon;
      }
    }

    const latR = Math.round(lat! * 10000) / 10000;
    const lonR = Math.round(lon! * 10000) / 10000;

    let days: Record<string, DayForecast> | null = null;
    const { data: cached } = await admin
      .from("weather_cache")
      .select("forecast, expires_at")
      .eq("lat", latR)
      .eq("lon", lonR)
      .maybeSingle();
    if (cached?.forecast && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      days = cached.forecast as Record<string, DayForecast>;
    }

    if (!days) {
      const res = await fetch(`${MET_URL}?lat=${latR}&lon=${lonR}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) {
        return json({ error: `met.no ${res.status}` }, 502);
      }
      const met = await res.json();
      days = aggregate((met?.properties?.timeseries ?? []) as MetEntry[]);
      const now = new Date();
      await admin.from("weather_cache").upsert(
        {
          lat: latR,
          lon: lonR,
          forecast: days,
          fetched_at: now.toISOString(),
          expires_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: "lat,lon" },
      );
    }

    let out = days;
    if (dateFrom || dateTo) {
      out = {};
      for (const [d, f] of Object.entries(days)) {
        if (dateFrom && d < dateFrom) continue;
        if (dateTo && d > dateTo) continue;
        out[d] = f;
      }
    }

    return json({ days: out, lat: latR, lon: lonR, geocoded });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
