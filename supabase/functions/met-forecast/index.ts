// Proxy mot api.met.no slik at vi kan sette en gyldig User-Agent
// (nettleseren får ikke lov til å sette UA selv, så uten denne proxy
// returnerer met.no 403). Returnerer aggregert dag-prognose.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const USER_AGENT = "NBHub Ordre/1.0 (https://nbhub.no; kontakt@nottero-bakeri.no)";
const URL_BASE = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

type MetTimeseriesEntry = {
  time: string;
  data: {
    instant?: { details?: { air_temperature?: number } };
    next_1_hours?: { summary?: { symbol_code?: string } };
    next_6_hours?: { summary?: { symbol_code?: string } };
    next_12_hours?: { summary?: { symbol_code?: string } };
  };
};

type DayBucket = { temps: number[]; symbols: Map<string, number> };

function aggregate(series: MetTimeseriesEntry[]) {
  const byDate = new Map<string, DayBucket>();
  for (const s of series) {
    const d = new Date(s.time);
    const isoDate = d.toISOString().slice(0, 10);
    const hour = d.getUTCHours();
    const temp = s.data.instant?.details?.air_temperature;
    const symbol =
      s.data.next_1_hours?.summary?.symbol_code ??
      s.data.next_6_hours?.summary?.symbol_code ??
      s.data.next_12_hours?.summary?.symbol_code;
    let bucket = byDate.get(isoDate);
    if (!bucket) {
      bucket = { temps: [], symbols: new Map() };
      byDate.set(isoDate, bucket);
    }
    if (typeof temp === "number") bucket.temps.push(temp);
    if (symbol && hour >= 6 && hour <= 20) {
      bucket.symbols.set(symbol, (bucket.symbols.get(symbol) ?? 0) + 1);
    }
  }
  const out: Record<string, { tempMin: number; tempMax: number; symbolCode: string }> = {};
  for (const [isoDate, bucket] of byDate) {
    if (bucket.temps.length === 0) continue;
    let dominant: string | undefined;
    let best = 0;
    for (const [sym, c] of bucket.symbols) {
      if (c > best) { best = c; dominant = sym; }
    }
    out[isoDate] = {
      tempMin: Math.round(Math.min(...bucket.temps)),
      tempMax: Math.round(Math.max(...bucket.temps)),
      symbolCode: dominant ?? "cloudy",
    };
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const lat = Number(url.searchParams.get("lat"));
    const lon = Number(url.searchParams.get("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      return new Response(JSON.stringify({ error: "lat/lon required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Round to 4 decimals — met.no krever maks 4 desimaler for caching
    const latR = Math.round(lat * 10000) / 10000;
    const lonR = Math.round(lon * 10000) / 10000;
    const res = await fetch(`${URL_BASE}?lat=${latR}&lon=${lonR}`, {
      headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
    });
    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: `met.no ${res.status}`, body }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const json = await res.json();
    const series = (json?.properties?.timeseries ?? []) as MetTimeseriesEntry[];
    const days = aggregate(series);
    return new Response(JSON.stringify({ days }), {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=1800",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
