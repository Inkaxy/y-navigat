import { paths } from "@/ravarer/lib/paths";

/**
 * Forhandlinger: streng lesing av operasjonssvar og identitetsvern.
 *
 * - `generate-rfq-credentials` svarer `{success:true,credentials:[…]}` uten å gjenta
 *   forhandlings-ID eller noen operasjons-ID. Svaret bindes derfor til den frosne
 *   forespørselen og forventet mottakersett; rekkefølgen i lista betyr ingenting.
 * - Generering roterer passord per mottaker uten transaksjon. Et tapt eller feilet
 *   svar kan ha endret passord — det er «ukjent», aldri trygt å prøve automatisk igjen.
 * - `apply-negotiation-outcome` svarer bare `{success:true,applied:n}`. Ved 500 kan
 *   noe være lagret; `applied` i feilsvaret er ikke et pålitelig antall.
 */

export interface RfqCredential {
  recipient_id: string;
  supplier_id: string;
  supplier_name: string;
  contact_email: string | null;
  access_token: string;
  password: string;
  portal_url: string;
}

export interface ExpectedRecipient {
  id: string;
  supplier_id: string;
}

export type CredentialsParse =
  | { kind: "ok"; byRecipient: Map<string, RfqCredential> }
  | { kind: "malformed"; reason: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(o: Record<string, unknown>, k: string): string | null {
  const v = o[k];
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** Portal-ruten tokenet skal gjelde: RFQ = /tilbud/, live = /bekreftelse/. */
export type PortalRoute = "tilbud" | "bekreftelse";

/**
 * Leser generatorens svar strengt. Hver forventet mottaker må finnes nøyaktig én gang
 * med riktig leverandør, gyldig token og passord. Ukjente, dupliserte eller
 * ufullstendige oppføringer gjør hele svaret ugyldig (ingen visning under feil identitet).
 */
export function parseRfqCredentials(data: unknown, expected: readonly ExpectedRecipient[]): CredentialsParse {
  if (!isRecord(data) || data.success !== true || !Array.isArray(data.credentials)) {
    return { kind: "malformed", reason: "svaret mangler success/credentials" };
  }
  const expectedById = new Map(expected.map((r) => [r.id, r]));
  const out = new Map<string, RfqCredential>();
  for (const raw of data.credentials) {
    if (!isRecord(raw)) return { kind: "malformed", reason: "ugyldig oppføring" };
    const recipient_id = str(raw, "recipient_id");
    const supplier_id = str(raw, "supplier_id");
    const access_token = str(raw, "access_token");
    const password = str(raw, "password");
    const portal_url = str(raw, "portal_url");
    if (!recipient_id || !supplier_id || !access_token || !password || !portal_url) {
      return { kind: "malformed", reason: "ufullstendig oppføring" };
    }
    if (access_token === "undefined" || access_token === "null" || portal_url.endsWith("/undefined")) {
      return { kind: "malformed", reason: "mangler token" };
    }
    const exp = expectedById.get(recipient_id);
    if (!exp) return { kind: "malformed", reason: "ukjent mottaker" };
    if (exp.supplier_id !== supplier_id) return { kind: "malformed", reason: "feil leverandør for mottaker" };
    if (out.has(recipient_id)) return { kind: "malformed", reason: "duplisert mottaker" };
    const email = raw.contact_email;
    out.set(recipient_id, {
      recipient_id,
      supplier_id,
      supplier_name: typeof raw.supplier_name === "string" ? raw.supplier_name : "",
      contact_email: typeof email === "string" && email.trim() !== "" ? email : null,
      access_token,
      password,
      portal_url,
    });
  }
  for (const r of expected) {
    if (!out.has(r.id)) return { kind: "malformed", reason: "mangler forventet mottaker" };
  }
  return { kind: "ok", byRecipient: out };
}

/** Lenke for valgt portal, bygget fra tokenet (aldri fra en annen mottakers oppføring). */
export function portalUrlFor(origin: string, route: PortalRoute, cred: RfqCredential): string {
  return `${origin}/${route}/${encodeURIComponent(cred.access_token)}`;
}

/** 4xx fra en edge-funksjon er en sikker avvisning; alt annet kan ha skrevet noe. */
export function edgeErrorStatus(err: unknown): number | null {
  if (!isRecord(err)) return null;
  const ctx = err.context;
  if (isRecord(ctx) && typeof ctx.status === "number") return ctx.status;
  if (typeof err.status === "number") return err.status;
  return null;
}
export function isKnownRejection(err: unknown): boolean {
  const s = edgeErrorStatus(err);
  return s !== null && s >= 400 && s < 500;
}

// ---------------------------------------------------------------------------
// apply-negotiation-outcome

export type ApplyOutcome =
  | { kind: "success" }
  | { kind: "rejected"; message: string }
  /** Noe kan være lagret. `linksOpen` = serveren sa forhandlingen er avsluttet men lenkene ikke stengt. */
  | { kind: "partial"; failures: string[]; linksOpen: boolean }
  | { kind: "unknown" };

/** Leser utfallsmotorens svar. Krever bare de feltene kontrakten faktisk har. */
export function classifyApplyOutcome(data: unknown, error: unknown, body: unknown = null): ApplyOutcome {
  if (!error) {
    if (isRecord(data) && data.success === true && typeof data.applied === "number") return { kind: "success" };
    return { kind: "unknown" };
  }
  const status = edgeErrorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    const msg = isRecord(body) && typeof body.error === "string" ? body.error : "Avvist av serveren";
    return { kind: "rejected", message: msg };
  }
  if (status === 500 && isRecord(body)) {
    const failures = Array.isArray(body.failures) ? body.failures.filter((f): f is string => typeof f === "string") : [];
    const err = typeof body.error === "string" ? body.error : "";
    const linksOpen = /lenke|link/i.test(err) && /avsluttet|concluded/i.test(err);
    if (failures.length > 0 || linksOpen) return { kind: "partial", failures, linksOpen };
  }
  return { kind: "unknown" };
}

/** Leser feilkroppen fra en FunctionsHttpError uten å kaste. */
export async function readEdgeErrorBody(err: unknown): Promise<unknown> {
  if (!isRecord(err)) return null;
  const ctx = err.context;
  if (!isRecord(ctx) || typeof ctx.clone !== "function") return null;
  try {
    const res = (ctx.clone as () => { json: () => Promise<unknown> })();
    return await res.json();
  } catch (e) {
    console.warn("[forhandling] uleselig feilsvar", e instanceof Error ? e.name : "ukjent");
    return null;
  }
}

/** Gjenstående primærendringer etter at selve utfallet er lagret. */
export interface PrimaryTask {
  rawMaterialId: string;
  supplierId: string;
}

export async function runPrimaryTasks(
  tasks: readonly PrimaryTask[],
  setPrimary: (rawMaterialId: string, supplierId: string) => Promise<unknown>,
): Promise<{ failed: PrimaryTask[] }> {
  const failed: PrimaryTask[] = [];
  for (const t of tasks) {
    try {
      await setPrimary(t.rawMaterialId, t.supplierId);
    } catch (e) {
      console.warn("[forhandling] primær feilet", e instanceof Error ? e.name : "ukjent");
      failed.push(t);
    }
  }
  return { failed };
}

// ---------------------------------------------------------------------------
// Vareidentitet

/**
 * Råvarelista kan bare erstattes (slett + sett inn) i et ekte, aldri utstedt utkast.
 * Svar, utfall og live-hendelser slettes i kaskade når en vare fjernes, også om samme
 * ID settes inn igjen. Dette er et klientvern; serveren må håndheve det samme.
 */
export function canReplaceNegotiationItems(
  status: string | null | undefined,
  recipients: ReadonlyArray<{ invited_at?: string | null; password_set_at?: string | null }>,
): boolean {
  if (status !== "draft") return false;
  return recipients.every((r) => !r.invited_at && !r.password_set_at);
}

/** Avgjør om valgt råvaresett er uendret i forhold til lagrede varer (da skal ingenting skrives). */
export function sameItemSet(existing: ReadonlyArray<{ raw_material_id: string }>, selected: Iterable<string>): boolean {
  const a = new Set(existing.map((e) => e.raw_material_id));
  const b = new Set(selected);
  if (a.size !== b.size || a.size !== existing.length) return false;
  for (const x of b) if (!a.has(x)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Besparelse

/**
 * Estimert årlig besparelse. Linjer der vinnerprisen ikke kan regnes om til
 * grunnenhet, eller baseline mangler, telles som ukjente — aldri som 0 eller gjettet.
 */
export function estimateSavings(
  lines: ReadonlyArray<{ volumeBaseline: number | null; costBaseline: number | null; winnerPerBase: number | null; hasWinner: boolean }>,
): { value: number; known: number; unknown: number } {
  let value = 0, known = 0, unknown = 0;
  for (const l of lines) {
    if (!l.hasWinner) continue;
    if (l.winnerPerBase == null || l.volumeBaseline == null || l.costBaseline == null ||
        !Number.isFinite(l.winnerPerBase) || !(l.volumeBaseline > 0)) { unknown++; continue; }
    value += l.costBaseline - l.volumeBaseline * l.winnerPerBase;
    known++;
  }
  return { value, known, unknown };
}

/** 12-måneders grunnlag for en råvare i grunnenhet. null = ukjent, aldri 0. */
export interface BaselineStats { cost: number | null; avgPrice: number | null; volume: number | null }
export function baselineFromStats(s: { cost_12m: number | null; avg_price_per_base_unit_12m: number | null }): BaselineStats {
  const cost = s.cost_12m == null || !Number.isFinite(Number(s.cost_12m)) ? null : Number(s.cost_12m);
  const avg = s.avg_price_per_base_unit_12m == null || !(Number(s.avg_price_per_base_unit_12m) > 0) ? null : Number(s.avg_price_per_base_unit_12m);
  return { cost, avgPrice: avg, volume: cost != null && avg != null ? cost / avg : null };
}

/** Hvor en rad åpnes: aktiv live-forhandling går til arbeidsflaten, resten til detalj. */
export function negotiationHref(n: { id: string; status: string; negotiation_mode: string | null }): string {
  return n.negotiation_mode === "live" && n.status !== "concluded" && n.status !== "cancelled"
    ? paths.liveForhandling(n.id)
    : paths.forhandling(n.id);
}

