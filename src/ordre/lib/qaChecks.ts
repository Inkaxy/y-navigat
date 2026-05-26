// QA-sjekkliste før ordre lagres og før bekreftelse sendes.
// Deterministisk — uavhengig av AI-modellen. Bruker AI-forslaget kun som
// signal (f.eks. lav konfidens => "dato kan være tolket fra relativ tekst").
import type { AiSuggestion } from "@/ordre/lib/aiSuggestion";

export type QaSeverity = "green" | "yellow" | "red";

export type QaCheck = {
  id: string;
  severity: QaSeverity;
  label: string;
  detail?: string;
};

// ---------- Felles helpers ----------

const RELATIVE_TIME_HINTS = [
  "i morgen", "i dag", "i overmorgen", "neste uke", "denne uka", "denne uken",
  "om en uke", "om noen dager", "førstkommende", "kommende",
  "mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag",
];

function looksLikeRelativeDate(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return RELATIVE_TIME_HINTS.some((h) => t.includes(h));
}

const UNCERTAINTY_HINTS = [
  "usikker", "kanskje", "tror", "muligens", "vet ikke", "ikke sikker",
  "kanskje vi", "vurderer", "lurer på",
];

function looksUncertain(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return UNCERTAINTY_HINTS.some((h) => t.includes(h));
}

function isValidHHMM(t: string | null | undefined): boolean {
  if (!t) return false;
  return /^([01]?\d|2[0-3]):[0-5]\d(:\d{2})?$/.test(t);
}

// ---------- 1) Før ordre lagres ----------

export type OrderDraftCheckInput = {
  delivery_date: string | null;
  delivery_time: string | null;
  pickup_location_hint?: string | null;
  pickup_location_known?: boolean;
  has_pickup_concept?: boolean; // false => sjekken er ikke relevant
  lines: Array<{
    product_id: string | null;
    product_name?: string | null;
    quantity: number;
    size_or_servings?: string | null;
  }>;
  customer_id: string | null;
  ai?: AiSuggestion | null;
  // Råtekst fra kundens epost (brukes til å oppdage usikkerhet / relativ dato)
  source_text?: string | null;
};

export function evaluateOrderDraftChecks(input: OrderDraftCheckInput): QaCheck[] {
  const out: QaCheck[] = [];
  const ai = input.ai ?? null;

  // Hentedato
  out.push(
    input.delivery_date
      ? { id: "delivery_date", severity: "green", label: "Hentedato satt", detail: input.delivery_date }
      : { id: "delivery_date", severity: "red", label: "Mangler hentedato" },
  );

  // Hentetid gyldig
  if (input.delivery_time) {
    out.push(
      isValidHHMM(input.delivery_time)
        ? { id: "delivery_time", severity: "green", label: "Hentetid gyldig", detail: input.delivery_time }
        : { id: "delivery_time", severity: "red", label: "Hentetid har ugyldig format", detail: input.delivery_time },
    );
  } else {
    out.push({ id: "delivery_time", severity: "yellow", label: "Hentetid ikke spesifisert" });
  }

  // Hentested
  if (input.has_pickup_concept) {
    if (!input.pickup_location_hint) {
      out.push({ id: "pickup_location", severity: "red", label: "Mangler hentested" });
    } else if (input.pickup_location_known === false) {
      out.push({
        id: "pickup_location",
        severity: "yellow",
        label: "Hentested er ikke gjenkjent",
        detail: `«${input.pickup_location_hint}» matcher ingen registrert lokasjon`,
      });
    } else {
      out.push({ id: "pickup_location", severity: "green", label: "Hentested OK", detail: input.pickup_location_hint });
    }
  }

  // Produkt
  const validLines = input.lines.filter((l) => l.product_id && Number(l.quantity) > 0);
  if (validLines.length === 0) {
    out.push({ id: "product_missing", severity: "red", label: "Mangler produkt" });
  } else {
    out.push({
      id: "product_present",
      severity: "green",
      label: `${validLines.length} produktlinje(r)`,
    });
  }

  // Produkt finnes (matchet mot katalog)
  const unmatched = input.lines.filter((l) => !l.product_id && (l.product_name ?? "").trim().length > 0);
  if (unmatched.length > 0) {
    out.push({
      id: "product_unmatched",
      severity: "yellow",
      label: `${unmatched.length} produkt mangler match`,
      detail: unmatched.map((l) => l.product_name ?? "?").join(", "),
    });
  }

  // Størrelse / personer
  const linesNeedingSize = (ai?.products ?? []).filter(
    (p) => !p.size_or_servings && /kake|bløtkake|marsipan|sjokoladekake|sjokolade|moussekake|brullé/i.test(p.product_name),
  );
  if (linesNeedingSize.length > 0) {
    out.push({
      id: "size_missing",
      severity: "yellow",
      label: "Størrelse / antall personer ikke spesifisert",
      detail: linesNeedingSize.map((p) => p.product_name).slice(0, 3).join(", "),
    });
  }

  // Allergi nevnt
  const allergyText = ai?.order_fields?.allergies?.trim();
  if (allergyText) {
    out.push({
      id: "allergy_present",
      severity: "yellow",
      label: "Allergi nevnt — krever manuell kontroll",
      detail: allergyText.slice(0, 160),
    });
  }

  // Kunden virker usikker
  const uncertainAi = (ai?.missing_info ?? []).some((m) =>
    /uncertain|unclear|ambigu|usikker/i.test(`${m.code} ${m.label}`),
  );
  if (uncertainAi || looksUncertain(input.source_text)) {
    out.push({
      id: "customer_uncertain",
      severity: "yellow",
      label: "Kunden virker usikker",
      detail: "Avklar minst ett uavklart punkt før bekreftelse.",
    });
  }

  // Dato tolket fra relativ tekst
  const dateConfidence = ai?.field_confidence?.delivery_date;
  const dateReason = ai?.reasoning_per_field?.delivery_date ?? "";
  if (
    input.delivery_date &&
    (looksLikeRelativeDate(dateReason) ||
      looksLikeRelativeDate(input.source_text) ||
      (typeof dateConfidence === "number" && dateConfidence < 0.85))
  ) {
    out.push({
      id: "date_relative",
      severity: "yellow",
      label: "Hentedato kan være tolket fra relativ tekst",
      detail: `Bekreft at ${input.delivery_date} er riktig dato.`,
    });
  }

  // Riktig kunde koblet
  const aiCustomerId = ai?.customer_match?.customer_id ?? null;
  if (input.customer_id && aiCustomerId && aiCustomerId !== input.customer_id) {
    out.push({
      id: "customer_mismatch",
      severity: "yellow",
      label: "AI foreslo en annen kunde",
      detail: ai?.customer_match?.customer_name
        ? `Vurder «${ai.customer_match.customer_name}» (match ${Math.round((ai.customer_match.match_confidence ?? 0) * 100)}%)`
        : undefined,
    });
  } else if (input.customer_id && aiCustomerId && aiCustomerId === input.customer_id) {
    out.push({ id: "customer_ok", severity: "green", label: "Kunde matcher AI-forslag" });
  } else if (!input.customer_id) {
    out.push({ id: "customer_missing", severity: "red", label: "Mangler kunde" });
  }

  return out;
}

// ---------- 2) Før bekreftelse sendes ----------

export type ConfirmationCheckInput = {
  order: {
    delivery_date: string | null;
    delivery_time: string | null;
    total_amount?: number | null;
    line_count: number;
    pickup_location_hint?: string | null;
  };
  ai?: AiSuggestion | null;
  body_text: string;
  // Skal pris være med i denne bekreftelsen?
  include_price?: boolean;
};

function bodyMentions(haystack: string, needles: RegExp): boolean {
  return needles.test(haystack);
}

export function evaluateConfirmationChecks(input: ConfirmationCheckInput): QaCheck[] {
  const out: QaCheck[] = [];
  const body = (input.body_text ?? "").toLowerCase();
  const o = input.order;
  const ai = input.ai ?? null;

  // 1) Ordredata stemmer (dato/tid vises i bekreftelsen)
  if (o.delivery_date) {
    const datePart = o.delivery_date.slice(0, 10);
    const [, mm, dd] = datePart.split("-");
    const present =
      body.includes(datePart) ||
      body.includes(`${Number(dd)}.${Number(mm)}`) ||
      body.includes(`${Number(dd)}/${Number(mm)}`);
    out.push(
      present
        ? { id: "date_in_body", severity: "green", label: "Hentedato vises i bekreftelsen" }
        : { id: "date_in_body", severity: "red", label: "Hentedato vises ikke i bekreftelsen", detail: datePart },
    );
  }
  if (o.delivery_time) {
    const hhmm = o.delivery_time.slice(0, 5);
    out.push(
      body.includes(hhmm)
        ? { id: "time_in_body", severity: "green", label: "Hentetid vises i bekreftelsen" }
        : { id: "time_in_body", severity: "yellow", label: "Hentetid mangler i teksten", detail: hhmm },
    );
  }
  if (o.line_count > 0) {
    out.push({ id: "lines_ok", severity: "green", label: `${o.line_count} ordrelinje(r)` });
  } else {
    out.push({ id: "lines_missing", severity: "red", label: "Ingen ordrelinjer å bekrefte" });
  }

  // 2) Røde risikoer fra AI
  const redRisks = (ai?.risks ?? []).filter((r) => r.severity === "red");
  if (redRisks.length > 0) {
    out.push({
      id: "red_risks",
      severity: "red",
      label: `${redRisks.length} rød risiko fra AI`,
      detail: redRisks.map((r) => r.message).slice(0, 2).join(" · "),
    });
  }

  // 3) Kunden lovet noe som ikke finnes i ordren — sjekk om AI noterte "special_requests"
  const specialReq = ai?.order_fields?.special_requests?.trim();
  if (specialReq) {
    const keyTokens = specialReq.toLowerCase().split(/[,;.]/).map((s) => s.trim()).filter((s) => s.length > 3);
    const missingTokens = keyTokens.filter((tok) => !body.includes(tok.slice(0, Math.min(24, tok.length))));
    if (missingTokens.length > 0) {
      out.push({
        id: "promise_missing",
        severity: "yellow",
        label: "Spesialønsker mangler kanskje i bekreftelsen",
        detail: missingTokens.slice(0, 2).join(" · "),
      });
    } else {
      out.push({ id: "promise_covered", severity: "green", label: "Spesialønsker dekket i tekst" });
    }
  }

  // 4) Pris hvis pris skal være med
  const mentionsPrice = bodyMentions(body, /\b(kr|nok|,-|,–|\bsum\b|\btotalt?\b|\bpris\b)/i);
  if (input.include_price) {
    if (o.total_amount && o.total_amount > 0 && !mentionsPrice) {
      out.push({ id: "price_missing", severity: "yellow", label: "Pris er ikke nevnt i bekreftelsen" });
    } else if (mentionsPrice) {
      out.push({ id: "price_present", severity: "green", label: "Pris er inkludert" });
    }
  }

  // 5) Åpningstider inkludert
  const mentionsHours = bodyMentions(body, /(åpningstid|åpent|åpner|stenger|\b\d{1,2}[:.]\d{2}\b.*\b\d{1,2}[:.]\d{2}\b)/i);
  out.push(
    mentionsHours
      ? { id: "hours_present", severity: "green", label: "Åpningstid nevnt" }
      : { id: "hours_missing", severity: "yellow", label: "Åpningstid for hentested mangler" },
  );

  // 6) Avbestillings-/endringsfrist
  const mentionsCancellation = bodyMentions(body, /(avbestill|endringsfrist|kansell|frist for endring|frist for avbestilling)/i);
  out.push(
    mentionsCancellation
      ? { id: "cancel_present", severity: "green", label: "Avbestillingsfrist nevnt" }
      : { id: "cancel_missing", severity: "yellow", label: "Avbestillings-/endringsfrist mangler" },
  );

  return out;
}

// ---------- Oppsummering ----------

export function summarizeQa(checks: QaCheck[]): { red: number; yellow: number; green: number; severity: QaSeverity | null } {
  let red = 0, yellow = 0, green = 0;
  for (const c of checks) {
    if (c.severity === "red") red++;
    else if (c.severity === "yellow") yellow++;
    else green++;
  }
  const severity: QaSeverity | null =
    red > 0 ? "red" : yellow > 0 ? "yellow" : checks.length > 0 ? "green" : null;
  return { red, yellow, green, severity };
}
