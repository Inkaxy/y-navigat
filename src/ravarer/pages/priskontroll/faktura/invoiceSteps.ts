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
  /** Steget gjelder ikke denne fakturaen (f.eks. kostpris på kreditnota). Aldri «utført». */
  na?: boolean;
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
  /** Kostpris er ført for ALLE varelinjer (delvis føring er ikke ferdig). */
  costPosted: boolean;
  /** Varelinjer med aktiv kostprisføring. */
  costPostedLines?: number;
  /** Varelinjer (ikke «Ikke vare»). */
  costTotalLines?: number;
}

export type CostProgress = { state: "ingen" | "delvis" | "fullfort"; posted: number; total: number; remaining: number };

/** Ført / totalt for varelinjene. Delvis føring er ikke fullført — resten kan føres senere. */
export function costProgress(posted: number, total: number): CostProgress {
  const p = Math.max(0, posted);
  const t = Math.max(0, total);
  const state = p === 0 ? "ingen" : p >= t ? "fullfort" : "delvis";
  return { state, posted: p, total: t, remaining: Math.max(0, t - p) };
}

export function extrasFromCounts(approved: boolean, posted: number, total: number): DeliveryExtras {
  return { approved, costPosted: costProgress(posted, total).state === "fullfort", costPostedLines: posted, costTotalLines: total };
}

function costDetail(e: DeliveryExtras, avstemt: boolean): string {
  const posted = e.costPostedLines ?? (e.costPosted ? 1 : 0);
  const total = e.costTotalLines ?? posted;
  const p = costProgress(posted, total);
  if (e.costPosted) return e.costTotalLines != null ? `Kostpris ført for alle ${p.total} varelinjer` : "Kostpris er ført";
  if (p.state === "delvis") return `Delvis ført: ${p.posted} av ${p.total} varelinjer${avstemt ? "" : " — resten kan føres når linjene er avklart"}`;
  return avstemt ? "Ikke ført – kostpris føres bare før avstemming" : "Kostpris er ikke ført";
}

const EXTRACTION_PENDING = ["pending", "failed", "processing"];

export function hasLinesRead(inv: Pick<DeliveryInvoice, "line_count" | "lines_source" | "line_extraction_status">): boolean {
  if (inv.lines_source === "manual") return true;
  return inv.line_count > 0 && !EXTRACTION_PENDING.includes(inv.line_extraction_status ?? "");
}

/**
 * «Hent linjer» gjør bare noe når linjene ikke allerede er lest
 * (`rm_claim_invoice_line_extraction` tar bare `line_extraction_status <> 'done'`).
 */
export function canFetchLines(inv: { source: string | null; line_extraction_status?: string | null; line_count?: number | null }): boolean {
  // Første innlesing bare når fakturaen er tom — eksisterende linjer leses aldri over her.
  if (inv.line_count != null && inv.line_count > 0) return false;
  return inv.source === "tripletex" && inv.line_extraction_status !== "done";
}

/** Serverstatusene som betyr at summen faktisk er kontrollert. */
export const SUM_CHECKED_STATUSES = ["ok", "overridden"] as const;

/** Summen er kontrollert bare ved eksplisitt gyldig status — aldri ved no_lines/no_total/not_checked/null/ukjent. */
export function sumOk(status: string | null | undefined): boolean {
  return (SUM_CHECKED_STATUSES as readonly string[]).includes(status ?? "");
}

/** Norsk etikett for serverens sumstatus. */
export function sumStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "ok": return "Sum stemmer";
    case "overridden": return "Sum overstyrt";
    case "mismatch": return "Sum stemmer ikke";
    case "no_lines": return "Ingen linjer å kontrollere";
    case "no_total": return "Fakturabeløp mangler";
    default: return "Sum ikke kontrollert";
  }
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
          : !sumOk(inv.lines_sum_status) && inv.open_count === 0
            ? sumStatusLabel(inv.lines_sum_status)
          : inv.open_count > 0
            ? `${inv.open_count} ${inv.open_count === 1 ? "linje" : "linjer"} må avklares`
            : "Ikke kontrollert ennå",
    },
    inv.is_credit_note
      ? { key: "kostpris", label: "Kostpris ført", done: true, na: true, detail: "Ikke relevant for kreditnota" }
      : { key: "kostpris", label: "Kostpris ført", done: extras.costPosted, detail: costDetail(extras, avstemt) },
    { key: "avstemt", label: "Avstemt", done: avstemt, detail: avstemt ? `Avstemt ${mode}` : "Ikke avstemt" },
    { key: "godkjent", label: "Godkjent", done: extras.approved, detail: extras.approved ? "Internt godkjent" : "Ikke godkjent" },
  ];
}

export type NextStepKey =
  | "holdt_utenfor" | "flagget" | "koble_kreditnota" | "hent_linjer" | "registrer_linjer" | "rett_sum" | "avklar" | "avstem" | "godkjenn" | "kostpris" | "ferdig";

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
  // Avsluttet: holdt utenfor er ingen oppgave. Ingen kreditnota-/avklarings-/sumhandling; gjenåpning skjer i ExclusionPanel.
  if (i.status === "excluded") {
    return { key: "holdt_utenfor", label: "Holdt utenfor råvarebehandling", enabled: false, hint: "Dokumentet er holdt utenfor råvarebehandling. Gjenåpne for ny kontroll." };
  }
  if (i.status === "flagged") {
    return { key: "flagget", label: "Fjern flagg", enabled: i.canWrite, hint: "Fakturaen er flagget for oppfølging." };
  }
  if (i.is_credit_note && i.creditNoteUnlinked && i.status !== "reconciled") {
    return { key: "koble_kreditnota", label: "Koble kreditnota", enabled: i.canWrite, hint: "Kreditnotaen er ikke koblet til den opprinnelige fakturaen." };
  }
  if (!hasLinesRead(i) || i.line_count === 0) {
    return canFetchLines({ ...i, line_count: i.line_count })
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
  // Kostpris føres FØR avstemming: `rm_post_safe_line_costs` godtar bare åpne
  // statuser og aldri kreditnota (krever ikke godkjenning).
  if (costPostingAllowed(i) && !i.costPosted && !i.noSafeLines) {
    const can = i.canPostCosts ?? i.canWrite;
    const p = costProgress(i.costPostedLines ?? 0, i.costTotalLines ?? 0);
    return {
      key: "kostpris", label: p.state === "delvis" ? `Før kostpris for resten (${p.remaining} gjenstår)` : "Før kostpris", enabled: can,
      hint: can ? "Fører kostpris for de trygge linjene før fakturaen avstemmes." : "Føring av kostpris krever skrivetilgang til fakturaer.",
    };
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
  if (!i.costPosted && (i.costPostedLines ?? 0) > 0) {
    return { key: "ferdig", label: "Ferdig", enabled: false, hint: `Kostpris delvis ført (${i.costPostedLines} av ${i.costTotalLines ?? "?"} varelinjer).` };
  }
  if (!i.costPosted) {
    return { key: "ferdig", label: "Ferdig", enabled: false, hint: i.noSafeLines ? "Ingen trygge linjer å føre kostpris for." : "Fakturaen er avstemt og godkjent. Kostpris føres bare før avstemming." };
  }
  return { key: "ferdig", label: "Ferdig", enabled: false, hint: "Fakturaen er avstemt, godkjent og kostpris er ført." };
}

/** Statusene `rm_post_safe_line_costs` godtar. */
export const COST_POSTING_STATUSES = ["imported", "needs_review", "ready"] as const;

/** Samme regel som serveren: åpen status og ikke kreditnota. Godkjenning kreves ikke. */
export function costPostingAllowed(i: { status: string | null; is_credit_note?: boolean | null }): boolean {
  return (COST_POSTING_STATUSES as readonly string[]).includes(i.status ?? "") && !i.is_credit_note;
}
