/**
 * Leveransestatus og neste steg for én faktura. Rene funksjoner uten React
 * og Supabase, slik at reglene kan testes.
 */

export type DeliveryStepKey = "mottatt" | "lest" | "kontrollert" | "avstemt" | "godkjent" | "kostpris";

export interface DeliveryStep {
  key: DeliveryStepKey;
  label: string;
  done: boolean;
  /** Kort forklaring til tooltip. */
  detail: string;
}

export interface DeliveryInvoice {
  status: string;
  received_at: string | null;
  line_count: number;
  lines_source?: string | null;
  line_extraction_status?: string | null;
  /** Linjer som fortsatt må avklares. */
  open_count: number;
  lines_sum_status: string | null;
  reconciled_mode?: string | null;
  /** Kreditnota: kostprisføring er ikke relevant (RPC-en avviser dem). */
  is_credit_note?: boolean | null;
}

export interface DeliveryExtras {
  approved: boolean;
  costPosted: boolean;
}

const EXTRACTION_PENDING = ["pending", "failed", "processing"];

export function hasLinesRead(inv: Pick<DeliveryInvoice, "line_count" | "lines_source" | "line_extraction_status">): boolean {
  if (inv.lines_source === "manual") return true;
  return inv.line_count > 0 && !EXTRACTION_PENDING.includes(inv.line_extraction_status ?? "");
}

/** Summen er kontrollert når den er ok eller overstyrt — ikke ved avvik eller ukontrollert. */
export function sumOk(status: string | null): boolean {
  return status != null && status !== "mismatch";
}

export function deliverySteps(inv: DeliveryInvoice, extras: DeliveryExtras): DeliveryStep[] {
  const lest = hasLinesRead(inv);
  const kontrollert = lest && inv.line_count > 0 && inv.open_count === 0 && sumOk(inv.lines_sum_status);
  const avstemt = inv.status === "reconciled";
  const mode = inv.reconciled_mode === "auto" ? "automatisk" : "manuelt";
  return [
    { key: "mottatt", label: "Mottatt", done: true, detail: inv.received_at ? "Fakturaen er mottatt" : "Fakturaen er registrert" },
    {
      key: "lest", label: "Linjer lest", done: lest,
      detail: lest ? `${inv.line_count} ${inv.line_count === 1 ? "linje" : "linjer"} lest` : "Linjene er ikke hentet ennå",
    },
    {
      key: "kontrollert", label: "Kontrollert", done: kontrollert,
      detail: kontrollert
        ? "Alle linjer avklart og summen stemmer"
        : inv.lines_sum_status === "mismatch"
          ? "Summen av linjene stemmer ikke med fakturabeløpet"
          : inv.open_count > 0
            ? `${inv.open_count} ${inv.open_count === 1 ? "linje" : "linjer"} må avklares`
            : "Ikke kontrollert ennå",
    },
    { key: "avstemt", label: "Avstemt", done: avstemt, detail: avstemt ? `Avstemt ${mode}` : "Ikke avstemt" },
    { key: "godkjent", label: "Godkjent", done: extras.approved, detail: extras.approved ? "Internt godkjent" : "Ikke godkjent" },
    inv.is_credit_note
      ? { key: "kostpris", label: "Kostpris ført", done: true, detail: "Ikke relevant for kreditnota" }
      : { key: "kostpris", label: "Kostpris ført", done: extras.costPosted, detail: extras.costPosted ? "Kostpris er ført" : "Kostpris er ikke ført" },
  ];
}

export type NextStepKey =
  | "flagget" | "koble_kreditnota" | "hent_linjer" | "registrer_linjer" | "rett_sum" | "avklar" | "avstem" | "godkjenn" | "kostpris" | "ferdig";

export interface NextStep {
  key: NextStepKey;
  label: string;
  /** Kan brukeren utføre steget nå? */
  enabled: boolean;
  /** Forklaring når steget er sperret, ellers hva det gjør. */
  hint: string;
}

export interface NextStepInput extends DeliveryInvoice, DeliveryExtras {
  source: string | null;
  /** Fakturaen kan avstemmes (ingen blokkere, se `assessInboxInvoice`). */
  canReconcile: boolean;
  reconcileBlockedReason: string | null;
  canWrite: boolean;
  canReconcileRight: boolean;
  canApprove: boolean;
  /** Skrivetilgang til fakturaer (`useInvoiceRights().canWrite`) — det databasen krever for kostprisføring. */
  canPostCosts?: boolean;
  /** Kreditnotaen er ikke koblet til en opprinnelig faktura. */
  creditNoteUnlinked?: boolean;
  /** Siste kostprisføring fant ingen trygge linjer — steget regnes som ferdig. */
  noSafeLines?: boolean;
}

/** ÉN primærhandling — alltid neste steg i leveransen. */
export function nextInvoiceStep(i: NextStepInput): NextStep {
  if (i.status === "flagged") {
    return { key: "flagget", label: "Fjern flagg", enabled: i.canWrite, hint: "Fakturaen er flagget for oppfølging." };
  }
  if (i.is_credit_note && i.creditNoteUnlinked && i.status !== "reconciled") {
    return { key: "koble_kreditnota", label: "Koble kreditnota", enabled: i.canWrite, hint: "Kreditnotaen er ikke koblet til den opprinnelige fakturaen." };
  }
  if (!hasLinesRead(i) || i.line_count === 0) {
    return i.source === "tripletex"
      ? { key: "hent_linjer", label: "Hent linjer", enabled: i.canWrite, hint: "Linjene er ikke hentet fra Tripletex ennå." }
      : { key: "registrer_linjer", label: "Registrer linjer", enabled: i.canWrite, hint: "Linjene må registreres manuelt." };
  }
  if (i.status !== "reconciled" && i.lines_sum_status === "mismatch") {
    return { key: "rett_sum", label: "Rett sumavvik", enabled: true, hint: "Summen av linjene stemmer ikke med fakturabeløpet." };
  }
  if (i.status !== "reconciled" && i.open_count > 0) {
    const n = i.open_count;
    return { key: "avklar", label: `Avklar ${n} ${n === 1 ? "linje" : "linjer"}`, enabled: true, hint: "Går til første åpne linje." };
  }
  if (i.status !== "reconciled") {
    const enabled = i.canReconcile && i.canReconcileRight;
    return {
      key: "avstem", label: "Avstem fakturaen", enabled,
      hint: !i.canReconcileRight ? "Du har ikke tilgang til å avstemme." : i.reconcileBlockedReason ?? "Alle linjer er avklart.",
    };
  }
  if (!i.approved) {
    return {
      key: "godkjenn", label: "Godkjenn", enabled: i.canApprove,
      hint: i.canApprove ? "Intern godkjenning. Utløser ikke betaling." : "Krever godkjennerrolle (godkjenne eller admin).",
    };
  }
  if (i.is_credit_note) {
    return { key: "ferdig", label: "Ferdig", enabled: false, hint: "Kreditnotaen er avstemt og godkjent. Kostprisføring gjelder ikke kreditnotaer." };
  }
  if (i.noSafeLines && !i.costPosted) {
    return { key: "ferdig", label: "Ferdig", enabled: false, hint: "Ingen trygge linjer å føre kostpris for." };
  }
  if (!i.costPosted) {
    const can = i.canPostCosts ?? i.canWrite;
    return {
      key: "kostpris", label: "Før kostpris", enabled: can,
      hint: can ? "Fører kostpris for de trygge linjene." : "Føring av kostpris krever skrivetilgang til fakturaer.",
    };
  }
  return { key: "ferdig", label: "Ferdig", enabled: false, hint: "Fakturaen er avstemt, godkjent og kostpris er ført." };
}
