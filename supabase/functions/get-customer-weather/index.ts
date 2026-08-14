// Vær for en kundes leveringsadresse.
// - Slår opp kundens geocode_latitude/longitude (geokoder via Nominatim ved behov)
// - Fremtid: varsel fra api.met.no (krever beskrivende User-Agent — derfor server-side)
// - Fortid: observert vær fra Open-Meteo (forecast?past_days / archive)
// - Samme dag i fjor: Open-Meteo archive (ett samlet kall for hele fjorårs-området)
// - Cacher hele den sammensatte responsen i public.weather_cache (unik lat/lon, 2 timer)
// Attribusjon i klienten: «Værvarsel fra Yr, levert av Meteorologisk institutt og NRK»
// og «Historiske værdata fra Open-Meteo (CC BY 4.0)».

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "NBhub/1.0 (https://nbhub.no; kontakt@nottero-bakeri.no)";
const MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";
const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
// Bakeriets posisjon — siste fallback når kunden ikke lar seg geokode
const BAKERY = { lat: 59.2181, lon: 10.4295 };

type DayForecast = { symbolCode: string; tempMax: number; tempMin: number };
type DayEntry = {
  date: string;
  symbol_code: string;
  max_temperature: number;
  min_temperature: number | null;
  source: "forecast" | "observed";
  last_year: { date: string; symbol_code: string; max_temperature: number } | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const osloDayFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function osloToday(): string {
  return osloDayFmt.format(new Date());
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

function addDays(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function minusOneYear(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const prev = new Date(Date.UTC(y - 1, m - 1, d, 12));
  return prev.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000,
  );
}

/** WMO weather code → nærmeste Yr symbol_code (dagvariant der det finnes). */
function wmoToYr(code: number | null | undefined): string {
  if (code == null) return "cloudy";
  switch (code) {
    case 0:
      return "clearsky_day";
    case 1:
      return "fair_day";
    case 2:
      return "partlycloudy_day";
    case 3:
      return "cloudy";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
      return "lightrain";
    case 55:
      return "rain";
    case 56:
      return "lightsleet";
    case 57:
      return "sleet";
    case 61:
      return "lightrain";
    case 63:
      return "rain";
    case 65:
      return "heavyrain";
    case 66:
      return "lightsleet";
    case 67:
      return "heavysleet";
    case 71:
      return "lightsnow";
    case 73:
      return "snow";
    case 75:
      return "heavysnow";
    case 77:
      return "lightsnow";
    case 80:
      return "lightrainshowers_day";
    case 81:
      return "rainshowers_day";
    case 82:
      return "heavyrainshowers_day";
    case 85:
      return "lightsnowshowers_day";
    case 86:
      return "heavysnowshowers_day";
    case 95:
      return "rainandthunder";
    case 96:
    case 99:
      return "heavyrainandthunder";
    default:
      return "cloudy";
  }
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

type ObservedDay = { symbolCode: string; tempMax: number; tempMin: number | null };

function parseOpenMeteoDaily(payload: unknown): Record<string, ObservedDay> {
  const daily = (payload as {
    daily?: {
      time?: string[];
      weather_code?: (number | null)[];
      temperature_2m_max?: (number | null)[];
      temperature_2m_min?: (number | null)[];
    };
  })?.daily;
  const out: Record<string, ObservedDay> = {};
  const times = daily?.time ?? [];
  for (let i = 0; i < times.length; i++) {
    const max = daily?.temperature_2m_max?.[i];
    if (typeof max !== "number") continue;
    const min = daily?.temperature_2m_min?.[i];
    out[times[i]] = {
      symbolCode: wmoToYr(daily?.weather_code?.[i]),
      tempMax: Math.round(max),
      tempMin: typeof min === "number" ? Math.round(min) : null,
    };
  }
  return out;
}

async function openMeteoRange(
  base: string,
  lat: number,
  lon: number,
  start: string,
  end: string,
): Promise<Record<string, ObservedDay>> {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    timezone: "Europe/Oslo",
    start_date: start,
    end_date: end,
  });
  const res = await fetch(`${base}?${p.toString()}`);
  if (!res.ok) return {};
  return parseOpenMeteoDaily(await res.json());
}

/** Observerte dager: bruk forecast?past_days for nære datoer, archive for eldre. */
async function fetchObserved(
  lat: number,
  lon: number,
  start: string,
  end: string,
  today: string,
): Promise<Record<string, ObservedDay>> {
  if (daysBetween(start, end) < 0) return {};
  const recentCutoff = addDays(today, -90);
  const out: Record<string, ObservedDay> = {};

  const oldEnd = daysBetween(end, recentCutoff) < 0 ? end : addDays(recentCutoff, -1);
  if (daysBetween(start, oldEnd) >= 0) {
    Object.assign(out, await openMeteoRange(OM_ARCHIVE, lat, lon, start, oldEnd));
  }
  const recentStart = daysBetween(start, recentCutoff) > 0 ? recentCutoff : start;
  if (daysBetween(recentStart, end) >= 0) {
    const p = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      daily: "weather_code,temperature_2m_max,temperature_2m_min",
      timezone: "Europe/Oslo",
      past_days: String(Math.min(92, Math.max(1, daysBetween(recentStart, today) + 1))),
      forecast_days: "1",
    });
    const res = await fetch(`${OM_FORECAST}?${p.toString()}`);
    if (res.ok) {
      const days = parseOpenMeteoDaily(await res.json());
      for (const [d, v] of Object.entries(days)) {
        if (daysBetween(recentStart, d) >= 0 && daysBetween(d, end) >= 0) out[d] = v;
      }
    }
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
    const today = osloToday();
    const rangeKey = `${dateFrom ?? "-"}|${dateTo ?? "-"}`;

    // ---- cache ----------------------------------------------------------
    type CachePayload = {
      forecast?: Record<string, DayForecast>;
      ranges?: Record<string, { entries: Record<string, DayEntry>; today: string }>;
    };
    let cachePayload: CachePayload = {};
    let cacheFresh = false;
    const { data: cached } = await admin
      .from("weather_cache")
      .select("forecast, expires_at")
      .eq("lat", latR)
      .eq("lon", lonR)
      .maybeSingle();
    if (cached?.forecast && cached.expires_at && new Date(cached.expires_at) > new Date()) {
      const raw = cached.forecast as Record<string, unknown>;
      // Ny struktur { forecast, ranges }; gammel struktur var et flatt dagskart.
      cachePayload = raw && (raw.forecast || raw.ranges) ? (raw as CachePayload) : { forecast: raw as Record<string, DayForecast> };
      cacheFresh = true;
    }

    const cachedRange = cacheFresh ? cachePayload.ranges?.[rangeKey] : undefined;
    if (cachedRange && cachedRange.today === today) {
      const entries = cachedRange.entries;
      const days: Record<string, DayForecast> = {};
      for (const [d, e] of Object.entries(entries)) {
        days[d] = {
          symbolCode: e.symbol_code,
          tempMax: e.max_temperature,
          tempMin: e.min_temperature ?? e.max_temperature,
        };
      }
      return json({ days, entries, lat: latR, lon: lonR, geocoded, cached: true });
    }

    // ---- varsel (MET) ---------------------------------------------------
    let forecastDays = cacheFresh ? cachePayload.forecast : undefined;
    if (!forecastDays) {
      const res = await fetch(`${MET_URL}?lat=${latR}&lon=${lonR}`, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
      if (!res.ok) return json({ error: `met.no ${res.status}` }, 502);
      const met = await res.json();
      forecastDays = aggregate((met?.properties?.timeseries ?? []) as MetEntry[]);
    }

    // ---- datoområde -----------------------------------------------------
    const rangeStart = dateFrom ?? today;
    const rangeEnd =
      dateTo ??
      (Object.keys(forecastDays).sort().slice(-1)[0] ?? addDays(today, 7));
    const dates: string[] = [];
    for (let d = rangeStart; daysBetween(d, rangeEnd) >= 0; d = addDays(d, 1)) {
      dates.push(d);
      if (dates.length > 400) break;
    }

    // ---- observert (fortid) + i fjor ------------------------------------
    const pastDates = dates.filter((d) => daysBetween(d, today) > 0 && !forecastDays![d]);
    const observed = pastDates.length
      ? await fetchObserved(
          latR,
          lonR,
          pastDates[0],
          pastDates[pastDates.length - 1],
          today,
        ).catch(() => ({}))
      : {};

    const lastYear = dates.length
      ? await openMeteoRange(
          OM_ARCHIVE,
          latR,
          lonR,
          minusOneYear(dates[0]),
          minusOneYear(dates[dates.length - 1]),
        ).catch(() => ({}))
      : {};

    // ---- sammenstilling -------------------------------------------------
    const entries: Record<string, DayEntry> = {};
    const days: Record<string, DayForecast> = {};
    for (const date of dates) {
      const fc = forecastDays![date];
      const obs = observed[date];
      const pick = fc
        ? { ...fc, source: "forecast" as const }
        : obs
          ? { symbolCode: obs.symbolCode, tempMax: obs.tempMax, tempMin: obs.tempMin, source: "observed" as const }
          : null;
      const ly = lastYear[minusOneYear(date)];
      if (!pick) continue;
      entries[date] = {
        date,
        symbol_code: pick.symbolCode,
        max_temperature: pick.tempMax,
        min_temperature: pick.tempMin ?? null,
        source: pick.source,
        last_year: ly
          ? {
              date: minusOneYear(date),
              symbol_code: ly.symbolCode,
              max_temperature: ly.tempMax,
            }
          : null,
      };
      days[date] = {
        symbolCode: pick.symbolCode,
        tempMax: pick.tempMax,
        tempMin: pick.tempMin ?? pick.tempMax,
      };
    }

    // ---- lagre cache ----------------------------------------------------
    const now = new Date();
    const ranges = { ...(cachePayload.ranges ?? {}), [rangeKey]: { entries, today } };
    await admin.from("weather_cache").upsert(
      {
        lat: latR,
        lon: lonR,
        forecast: { forecast: forecastDays, ranges },
        fetched_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "lat,lon" },
    );

    return json({ days, entries, lat: latR, lon: lonR, geocoded });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
