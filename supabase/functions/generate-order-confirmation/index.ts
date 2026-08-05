// Genererer en ordrebekreftelse fra FAKTISKE ordredata med fast mal.
// AI kan KUN tilpasse innledning og oversette språk — aldri finne opp ordredata.
//
// Body: {
//   order_id: string,
//   language?: "nb" | "en" | "auto",
//   ticket_id?: string,            // hvis bekreftelsen springer ut fra en ticket
//   ai_intro?: boolean,            // true = la AI skrive en kort introsetning
//   tone?: ("kort"|"vennlig"|"profesjonell"|"tydelig")[],
// }
//
// Returnerer { subject, body_html, body_text, language, intro_text, variables, deadlines }
// Sender IKKE. Bruk send-order-confirmation for det.

import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "npm:zod@3.23.8";
import { callAi } from "../_shared/ai-providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const NB_LEGAL_ENTITY_ID = "751709bc-04b3-4449-867d-b97faa9ab373";

function jsonErr(msg: string, status: number, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ error: msg, ...extra }), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const InputSchema = z.object({
  order_id: z.string().uuid(),
  language: z.enum(["nb", "en", "auto"]).default("nb"),
  ticket_id: z.string().uuid().optional(),
  ai_intro: z.boolean().optional(),
  tone: z.array(z.enum(["kort", "vennlig", "profesjonell", "tydelig"])).optional(),
});

function htmlEscape(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatNOK(amount: number | null | undefined): string {
  if (amount == null || isNaN(Number(amount))) return "—";
  return new Intl.NumberFormat("nb-NO", { style: "currency", currency: "NOK", maximumFractionDigits: 2 })
    .format(Number(amount));
}

function formatDateNb(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("nb-NO", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function formatDateEn(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

function formatTimeRange(time: string | null | undefined, fallback?: string | null): string {
  if (time) return time.slice(0, 5);
  return fallback ?? "—";
}

const WEEKDAYS_NB = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
function openingHoursForDate(opening: any, dateIso: string | null | undefined, isNb: boolean): string | null {
  if (!opening || !dateIso) return null;
  const d = new Date(dateIso);
  const key = WEEKDAYS_NB[d.getDay()];
  const day = opening?.[key];
  if (!day) return null;
  if (day.closed) return isNb ? "Stengt" : "Closed";
  const periods = (day.periods ?? []) as Array<{ open?: string; close?: string }>;
  if (!periods.length) return null;
  return periods.map((p) => `${p.open ?? ""}–${p.close ?? ""}`).join(", ");
}

function detectLanguageFromText(text: string | null | undefined): "nb" | "en" {
  if (!text) return "nb";
  const t = text.toLowerCase();
  if (/[æøå]/.test(t)) return "nb";
  const en = (t.match(/\b(the|and|please|thanks|regards|order|delivery|pickup|cake|hello|hi)\b/g) ?? []).length;
  return en >= 3 ? "en" : "nb";
}

/** Oslo-offset (minutter foran UTC) for et gitt UTC-tidspunkt — DST-sikkert. */
function osloOffsetMinutes(utc: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Oslo", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(utc).filter((x) => x.type !== "literal").map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - utc.getTime()) / 60000);
}

/** Oslo vegg-klokke (dato + HH:mm) → korrekt UTC-instans. */
function osloWallToUtc(dateIso: string, time: string): Date {
  const [hh = 0, mm = 0] = time.split(":").map(Number);
  const naive = new Date(`${dateIso}T00:00:00Z`);
  naive.setUTCHours(hh, mm, 0, 0);
  let out = new Date(naive.getTime() - osloOffsetMinutes(naive) * 60000);
  out = new Date(naive.getTime() - osloOffsetMinutes(out) * 60000);
  return out;
}

type DeadlineRule = { days_before: number; time: string } | null;

function computeDeadlines(
  deliveryIso: string | null | undefined,
  changeRule: DeadlineRule = null,
  cancelRule: DeadlineRule = null,
): {
  change_deadline_iso: string | null;
  cancel_deadline_iso: string | null;
  change_deadline_human_nb: string;
  cancel_deadline_human_nb: string;
  change_deadline_human_en: string;
  cancel_deadline_human_en: string;
} {
  if (!deliveryIso) {
    return {
      change_deadline_iso: null, cancel_deadline_iso: null,
      change_deadline_human_nb: "—", cancel_deadline_human_nb: "—",
      change_deadline_human_en: "—", cancel_deadline_human_en: "—",
    };
  }
  // Leveringsdagen kl 08:00 Oslo-tid (DST-korrekt), minus frist.
  const base = osloWallToUtc(deliveryIso, "08:00");
  const fromRule = (r: DeadlineRule) => {
    if (!r) return null;
    const d = new Date(`${deliveryIso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - (r.days_before ?? 0));
    const dateStr = d.toISOString().slice(0, 10);
    return osloWallToUtc(dateStr, (r.time ?? "12:00").slice(0, 5));
  };
  const change = fromRule(changeRule) ?? new Date(base.getTime() - 72 * 3600 * 1000);
  const cancel = fromRule(cancelRule) ?? new Date(base.getTime() - 48 * 3600 * 1000);
  const fmt = (d: Date, locale: string) =>
    d.toLocaleString(locale, {
      timeZone: "Europe/Oslo",
      weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit",
    });
  return {
    change_deadline_iso: change.toISOString(),
    cancel_deadline_iso: cancel.toISOString(),
    change_deadline_human_nb: fmt(change, "nb-NO"),
    cancel_deadline_human_nb: fmt(cancel, "nb-NO"),
    change_deadline_human_en: fmt(change, "en-GB"),
    cancel_deadline_human_en: fmt(cancel, "en-GB"),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return jsonErr("Missing Authorization", 401);

    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes } = await userClient.auth.getUser();
    if (!userRes?.user) return jsonErr("Not authenticated", 401);

    const { data: hasWrite } = await userClient.rpc("has_app_write_access", { p_app_code: "ordre" });
    if (!hasWrite) return jsonErr("Forbidden — mangler skrivetilgang på ordre", 403);

    const parsed = InputSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonErr("Ugyldig input", 400, { details: parsed.error.flatten() });
    const { order_id, language, ticket_id, ai_intro, tone } = parsed.data;

    // --- Hent ordre + linjer ---
    const { data: order, error: oErr } = await admin
      .from("orders")
      .select("id,order_number,status,delivery_date,delivery_time,delivery_address_line1,delivery_address_line2,delivery_postal_code,delivery_city,delivery_instructions,customer_id,customer_snapshot,customer_notes,internal_notes,total_incl_vat,subtotal_excl_vat,total_vat,delivery_tour_id,final_customer_email,final_customer_phone,final_customer_name,distribution,is_customer_order")
      .eq("id", order_id).maybeSingle();
    if (oErr) throw oErr;
    if (!order) return jsonErr("Ordre ikke funnet", 404);

    const { data: lines } = await admin
      .from("order_lines")
      .select("line_number,quantity,sales_unit,unit_price,line_total_incl_vat,product_snapshot,notes,merknad,cake_config")
      .eq("order_id", order_id).order("line_number", { ascending: true });

    // --- Hent tur for hentetid + driver ---
    let tour: any = null;
    if (order.delivery_tour_id) {
      const { data: t } = await admin.from("delivery_tours")
        .select("id,display_name,time_from,time_to,driver_name")
        .eq("id", order.delivery_tour_id).maybeSingle();
      tour = t;
    }

    // --- Hentested: outlet (best-effort: bruk hovedutsalg/konditori) ---
    const { data: outlets } = await admin.from("outlets")
      .select("id,short_name,full_name,address_line1,postal_code,city,opening_hours,phone,email,outlet_type")
      .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
      .eq("status", "active");
    const outlet = (outlets ?? []).find((o: any) => o.outlet_type === "retail")
      ?? (outlets ?? []).find((o: any) => /konditori|utsalg/i.test(o.short_name ?? ""))
      ?? (outlets ?? [])[0]
      ?? null;

    // --- Kontaktinfo bakeriet ---
    const { data: contactSettings } = await admin.from("platform_settings")
      .select("key,value").in("category", ["ordre_email", "ordre_contact"]);
    const settings = Object.fromEntries((contactSettings ?? []).map((r: any) => [r.key, r.value]));
    const contactPhone = (settings.contact_phone?.value ?? settings.contact_phone) ?? outlet?.phone ?? null;
    const contactEmail = (settings.contact_email?.value ?? settings.contact_email) ?? outlet?.email ?? "ordre@notterobakeri.no";

    // --- Språk ---
    const customer = (order.customer_snapshot ?? {}) as any;
    const customerName = order.final_customer_name ?? customer.display_name ?? customer.name ?? "Kunde";
    const recipientEmail = order.final_customer_email ?? customer.primary_contact_email ?? customer.email ?? null;
    const detectedLang = language === "auto" ? detectLanguageFromText(customerName + " " + (order.customer_notes ?? "")) : language;
    const isNb = detectedLang === "nb";

    // --- Bygg variabler ---
    // Frister: foretrekk aktive delivery_rules for kunden, ellers 72/48t (Oslo-tid).
    let changeRule: DeadlineRule = null;
    let cancelRule: DeadlineRule = null;
    {
      const { data: rules } = await admin.from("delivery_rules")
        .select("rule_type,deadline_days_before,deadline_time,priority,customer_ids,is_active")
        .eq("legal_entity_id", NB_LEGAL_ENTITY_ID)
        .eq("is_active", true)
        .in("rule_type", ["order_deadline", "change_deadline", "cancellation_deadline"])
        .order("priority", { ascending: false });
      const scoped = (rules ?? []).filter((r: any) =>
        !r.customer_ids || r.customer_ids.length === 0 || r.customer_ids.includes(order.customer_id)
      );
      const pick = (types: string[]): DeadlineRule => {
        const r = scoped.find((x: any) => types.includes(x.rule_type) && x.deadline_days_before != null);
        return r ? { days_before: Number(r.deadline_days_before), time: String(r.deadline_time ?? "12:00") } : null;
      };
      changeRule = pick(["change_deadline", "order_deadline"]);
      cancelRule = pick(["cancellation_deadline"]) ?? changeRule;
    }
    const deadlines = computeDeadlines(order.delivery_date, changeRule, cancelRule);
    // Levering vs. henting styres av order.distribution, ikke adressefelt.
    const isDelivery = (order.distribution ?? "delivery") !== "pickup";
    const pickupOrDeliveryLabel = isNb
      ? (isDelivery ? "Levering" : "Henting")
      : (isDelivery ? "Delivery" : "Pickup");

    const pickupName = isDelivery ? null : (outlet?.full_name ?? outlet?.short_name ?? null);
    const pickupAddress = isDelivery
      ? [order.delivery_address_line1, order.delivery_address_line2, order.delivery_postal_code, order.delivery_city].filter(Boolean).join(", ")
      : [outlet?.address_line1, outlet?.postal_code, outlet?.city].filter(Boolean).join(", ");

    const openingToday = openingHoursForDate(outlet?.opening_hours, order.delivery_date, isNb);

    // Linjer som strukturerte rader (aldri AI-generert)
    const lineRows = (lines ?? []).map((l: any) => {
      const snap = l.product_snapshot ?? {};
      const cake = l.cake_config ?? {};
      const parts: string[] = [];
      if (cake.size_or_servings) parts.push(`${isNb ? "Størrelse" : "Size"}: ${cake.size_or_servings}`);
      if (cake.flavor) parts.push(`${isNb ? "Smak" : "Flavor"}: ${cake.flavor}`);
      if (cake.filling) parts.push(`${isNb ? "Fyll" : "Filling"}: ${cake.filling}`);
      if (cake.decoration) parts.push(`${isNb ? "Dekorasjon" : "Decoration"}: ${cake.decoration}`);
      if (cake.cake_text) parts.push(`${isNb ? "Kaketekst" : "Cake text"}: "${cake.cake_text}"`);
      if (cake.allergies) parts.push(`${isNb ? "Allergier" : "Allergies"}: ${cake.allergies}`);
      if (l.notes) parts.push(`${isNb ? "Merknad" : "Note"}: ${l.notes}`);
      return {
        name: snap.display_name ?? snap.name ?? "(ukjent vare)",
        qty: l.quantity,
        unit: l.sales_unit ?? "",
        line_total: l.line_total_incl_vat,
        details: parts,
      };
    });

    const linesHtml = `
      <table style="width:100%;border-collapse:collapse;margin:8px 0 16px;font-size:14px;">
        <thead>
          <tr style="background:#f3efe7;">
            <th align="left" style="padding:8px;border-bottom:1px solid #ddd;">${isNb ? "Vare" : "Item"}</th>
            <th align="right" style="padding:8px;border-bottom:1px solid #ddd;width:70px;">${isNb ? "Antall" : "Qty"}</th>
            <th align="right" style="padding:8px;border-bottom:1px solid #ddd;width:110px;">${isNb ? "Sum" : "Total"}</th>
          </tr>
        </thead>
        <tbody>
          ${lineRows.map((r) => `
            <tr>
              <td style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;">
                <div style="font-weight:600;">${htmlEscape(r.name)}</div>
                ${r.details.length ? `<div style="color:#666;font-size:13px;margin-top:2px;">${r.details.map(htmlEscape).join("<br/>")}</div>` : ""}
              </td>
              <td align="right" style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;">${htmlEscape(String(r.qty))} ${htmlEscape(r.unit)}</td>
              <td align="right" style="padding:8px;border-bottom:1px solid #eee;vertical-align:top;">${htmlEscape(formatNOK(r.line_total))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    const linesText = lineRows.map((r) => {
      const head = `${r.qty}${r.unit ? " " + r.unit : ""} × ${r.name}  —  ${formatNOK(r.line_total)}`;
      return r.details.length ? head + "\n   " + r.details.join("\n   ") : head;
    }).join("\n");

    // --- Intro (AI valgfri, ellers statisk) ---
    let introText = isNb
      ? `Tusen takk for bestillingen! Her er bekreftelsen din — vennligst gå gjennom og gi beskjed hvis noe ikke stemmer.`
      : `Thank you for your order! Here is your confirmation — please review and let us know if anything is wrong.`;

    if (ai_intro) {
      const provider = ((settings.ai_provider?.provider) ?? "anthropic") as "anthropic" | "openai";
      const models = (settings.ai_models ?? {}) as any;
      const model = (models.main ?? (provider === "anthropic" ? "claude-sonnet-4-5" : "gpt-4o")) as string;
      const apiKey = (Deno.env.get(provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY") ?? "").trim();
      if (apiKey) {
        const toneList = (tone && tone.length ? tone : ["vennlig", "profesjonell"]).join(", ");
        try {
          const res = await callAi({
            provider, apiKey, model, maxTokens: 200, temperature: 0.5,
            systemPrompt: isNb
              ? `Du skriver KUN én kort innledning (maks 2 setninger) til en ordrebekreftelse fra Nøtterø Bakeri. Tone: ${toneList}. Ikke nevn pris, dato, mengde eller produkter — det er allerede i selve bekreftelsen. Ikke skriv hilsen eller signatur. Ikke skriv "AI-aktig". Returner KUN selve teksten, uten anførselstegn.`
              : `You write ONLY a short intro (max 2 sentences) for an order confirmation from Nøtterø Bakeri. Tone: ${toneList}. Do not mention price, date, quantity or products — those are already in the confirmation. No greeting or signature. No "AI-like" phrasing. Return ONLY the intro text, no quotes.`,
            userText: JSON.stringify({
              customer_name: customerName,
              language: detectedLang,
            }),
          });
          const cleaned = res.rawText.trim().replace(/^["']|["']$/g, "").slice(0, 400);
          if (cleaned) introText = cleaned;
        } catch (e) {
          console.warn("ai_intro feilet, bruker default", e);
        }
      }
    }

    // --- Fast mal (norsk + engelsk variant) ---
    const greetingName = (customerName ?? "").split(/\s+/)[0] || customerName;
    const subject = isNb
      ? `Ordrebekreftelse ${order.order_number} — ${pickupOrDeliveryLabel.toLowerCase()} ${formatDateNb(order.delivery_date)}`
      : `Order confirmation ${order.order_number} — ${pickupOrDeliveryLabel.toLowerCase()} ${formatDateEn(order.delivery_date)}`;

    const labels = isNb ? {
      hello: `Hei ${greetingName},`,
      summary: "Sammendrag",
      orderNo: "Ordrenummer",
      pickupDate: isDelivery ? "Leveringsdato" : "Hentedato",
      pickupTime: isDelivery ? "Leveringstid" : "Hentetid",
      pickupPlace: isDelivery ? "Leveringsadresse" : "Hentested",
      address: "Adresse",
      hours: "Åpningstid den dagen",
      whatYouOrdered: "Det du har bestilt",
      total: "Totalt inkl. MVA",
      change: "Endringsfrist",
      cancel: "Avbestillingsfrist",
      contact: "Kontakt oss",
      check: "Vennligst sjekk at alt stemmer. Hvis noe er feil — svar på denne e-posten så fikser vi det.",
      regards: "Vennlig hilsen\nNøtterø Bakeri",
    } : {
      hello: `Hi ${greetingName},`,
      summary: "Summary",
      orderNo: "Order number",
      pickupDate: isDelivery ? "Delivery date" : "Pickup date",
      pickupTime: isDelivery ? "Delivery time" : "Pickup time",
      pickupPlace: isDelivery ? "Delivery address" : "Pickup location",
      address: "Address",
      hours: "Opening hours that day",
      whatYouOrdered: "What you ordered",
      total: "Total incl. VAT",
      change: "Change deadline",
      cancel: "Cancellation deadline",
      contact: "Contact us",
      check: "Please verify everything is correct. If anything is wrong — reply to this email and we'll fix it.",
      regards: "Kind regards,\nNøtterø Bakeri",
    };

    const fmtDate = isNb ? formatDateNb : formatDateEn;
    const changeDeadline = isNb ? deadlines.change_deadline_human_nb : deadlines.change_deadline_human_en;
    const cancelDeadline = isNb ? deadlines.cancel_deadline_human_nb : deadlines.cancel_deadline_human_en;
    const pickupTime = formatTimeRange(order.delivery_time, tour ? `${tour.time_from?.slice(0,5) ?? ""}–${tour.time_to?.slice(0,5) ?? ""}` : null);

    const variables = {
      order_number: order.order_number,
      customer_name: customerName,
      pickup_or_delivery: pickupOrDeliveryLabel,
      pickup_date: fmtDate(order.delivery_date),
      pickup_time: pickupTime,
      pickup_place: pickupName ?? (isDelivery ? (isNb ? "Til adresse" : "To address") : "—"),
      pickup_address: pickupAddress || "—",
      opening_hours_today: openingToday,
      total: formatNOK(order.total_incl_vat),
      change_deadline: changeDeadline,
      cancel_deadline: cancelDeadline,
      contact_phone: contactPhone,
      contact_email: contactEmail,
      language: detectedLang,
    };

    const bodyHtml = `<!doctype html>
<div style="font-family:Inter,Arial,sans-serif;color:#211d18;max-width:640px;font-size:15px;line-height:1.55;">
  <p style="margin:0 0 8px;">${htmlEscape(labels.hello)}</p>
  <p style="margin:0 0 16px;">${htmlEscape(introText)}</p>

  <h3 style="margin:20px 0 6px;font-size:15px;color:#211d18;">${htmlEscape(labels.summary)}</h3>
  <table style="border-collapse:collapse;font-size:14px;">
    <tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.orderNo)}:</td><td><strong>${htmlEscape(order.order_number)}</strong></td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.pickupDate)}:</td><td>${htmlEscape(variables.pickup_date)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.pickupTime)}:</td><td>${htmlEscape(variables.pickup_time)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.pickupPlace)}:</td><td>${htmlEscape(variables.pickup_place)}</td></tr>
    <tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.address)}:</td><td>${htmlEscape(variables.pickup_address)}</td></tr>
    ${openingToday ? `<tr><td style="padding:2px 12px 2px 0;color:#666;">${htmlEscape(labels.hours)}:</td><td>${htmlEscape(openingToday)}</td></tr>` : ""}
  </table>

  <h3 style="margin:24px 0 6px;font-size:15px;">${htmlEscape(labels.whatYouOrdered)}</h3>
  ${linesHtml}
  ${order.total_incl_vat != null
    ? `<p style="margin:0 0 16px;font-size:15px;"><strong>${htmlEscape(labels.total)}:</strong> ${htmlEscape(variables.total)}</p>`
    : ""}

  <h3 style="margin:20px 0 6px;font-size:15px;">${isNb ? "Frister" : "Deadlines"}</h3>
  <p style="margin:0 0 4px;">${htmlEscape(labels.change)}: <strong>${htmlEscape(changeDeadline)}</strong></p>
  <p style="margin:0 0 16px;">${htmlEscape(labels.cancel)}: <strong>${htmlEscape(cancelDeadline)}</strong></p>

  <h3 style="margin:20px 0 6px;font-size:15px;">${htmlEscape(labels.contact)}</h3>
  <p style="margin:0 0 4px;">${contactPhone ? `📞 ${htmlEscape(String(contactPhone))} · ` : ""}✉️ <a href="mailto:${htmlEscape(String(contactEmail))}">${htmlEscape(String(contactEmail))}</a></p>

  <p style="margin:20px 0 16px;padding:10px 12px;background:#fff7e6;border-left:3px solid #b88445;font-size:14px;">
    ${htmlEscape(labels.check)}
  </p>

  <p style="margin:24px 0 0;white-space:pre-line;">${htmlEscape(labels.regards)}</p>
</div>`;

    const bodyText = [
      labels.hello,
      "",
      introText,
      "",
      `=== ${labels.summary} ===`,
      `${labels.orderNo}: ${order.order_number}`,
      `${labels.pickupDate}: ${variables.pickup_date}`,
      `${labels.pickupTime}: ${variables.pickup_time}`,
      `${labels.pickupPlace}: ${variables.pickup_place}`,
      `${labels.address}: ${variables.pickup_address}`,
      openingToday ? `${labels.hours}: ${openingToday}` : null,
      "",
      `=== ${labels.whatYouOrdered} ===`,
      linesText,
      "",
      order.total_incl_vat != null ? `${labels.total}: ${variables.total}` : null,
      "",
      `${labels.change}: ${changeDeadline}`,
      `${labels.cancel}: ${cancelDeadline}`,
      "",
      `${labels.contact}: ${contactPhone ? contactPhone + " · " : ""}${contactEmail}`,
      "",
      labels.check,
      "",
      labels.regards,
    ].filter((x) => x !== null).join("\n");

    return new Response(JSON.stringify({
      ok: true,
      subject,
      body_html: bodyHtml,
      body_text: bodyText,
      language: detectedLang,
      intro_text: introText,
      recipient_email_suggested: recipientEmail,
      variables,
      deadlines,
      ticket_id: ticket_id ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("generate-order-confirmation error", e);
    return jsonErr((e as Error).message ?? "error", 500);
  }
});
