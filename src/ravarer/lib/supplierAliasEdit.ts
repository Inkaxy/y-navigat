/**
 * Kontrakt for aliasredigering mot de live RPC-ene `rm_supplier_alias_edit_preview` og
 * `rm_edit_supplier_alias`. Bare fremtidig matching endres; fakturalinjer og priser endres aldri.
 * Streng lesing: alt som ikke er fullt gyldig er ukjent, aldri «lagret».
 */
import { isObj, type Obj } from "@/fakturaer/lib/parseRpcJson";

export type AliasStatus = "pending" | "confirmed" | "rejected" | "superseded";
export type AliasAction = "confirm" | "reject" | "replace";

export const ALIAS_TYPE_LABEL: Record<string, string> = {
  supplier_sku: "Varenummer",
  product_name: "Varenavn",
  ean: "EAN",
  gtin: "GTIN",
};
export const ALIAS_STATUS_LABEL: Record<AliasStatus, string> = {
  pending: "Venter",
  confirmed: "Bekreftet",
  rejected: "Avvist",
  superseded: "Erstattet",
};
export const aliasTypeLabel = (t: string) => ALIAS_TYPE_LABEL[t] ?? "Annen type";
export const aliasStatusLabel = (s: string) => (s in ALIAS_STATUS_LABEL ? ALIAS_STATUS_LABEL[s as AliasStatus] : "Ukjent status");

export const ALIAS_SCOPE_TEXT = "Gjelder fremtidig matching; eksisterende fakturalinjer og priser endres ikke.";
/** Typer matchemotoren faktisk tolker; bare disse kan bekreftes. */
export const MATCHABLE_TYPES = new Set(["supplier_sku", "product_name"]);

export interface AliasPreview {
  aliasId: string;
  rmsId: string;
  rawMaterialId: string;
  supplierId: string;
  legalEntityId: string;
  aliasType: string;
  aliasValue: string;
  status: AliasStatus;
  editRevision: number;
  matchCount: number;
  lastSeenAt: string | null;
  expectedSnapshot: string;
  rejectedReason: string | null;
  canEdit: boolean;
}

const STATUSES = new Set<string>(["pending", "confirmed", "rejected", "superseded"]);
const s = (o: Obj, k: string) => (typeof o[k] === "string" && (o[k] as string).length > 0 ? (o[k] as string) : null);
const sn = (o: Obj, k: string): string | null | undefined => (o[k] === null ? null : typeof o[k] === "string" ? (o[k] as string) : undefined);
const n = (o: Obj, k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);

/** Forhåndsvisning må være schema 1 og gjelde nøyaktig forespurt alias og kobling. */
export function parseAliasPreview(data: unknown, aliasId: string, rmsId: string): AliasPreview | null {
  if (!isObj(data) || data.schema_version !== 1 || data.scope !== "future_matching_only") return null;
  const id = s(data, "alias_id"), rms = s(data, "rms_id"), rm = s(data, "raw_material_id"), sup = s(data, "supplier_id");
  const le = s(data, "legal_entity_id"), type = s(data, "alias_type"), value = s(data, "alias_value"), token = s(data, "expected_snapshot");
  const status = s(data, "status");
  const rev = n(data, "edit_revision");
  const mc = data.match_count === null ? 0 : n(data, "match_count");
  const last = sn(data, "last_seen_at"), rej = sn(data, "rejected_reason");
  if (!id || !rms || !rm || !sup || !le || !type || !value || !token || !status || !STATUSES.has(status)) return null;
  if (rev == null || mc == null || last === undefined || rej === undefined || typeof data.can_edit !== "boolean") return null;
  if (id !== aliasId || rms !== rmsId) return null;
  return {
    aliasId: id, rmsId: rms, rawMaterialId: rm, supplierId: sup, legalEntityId: le, aliasType: type, aliasValue: value,
    status: status as AliasStatus, editRevision: rev, matchCount: mc, lastSeenAt: last, expectedSnapshot: token,
    rejectedReason: rej, canEdit: data.can_edit,
  };
}

/** Hvilke handlinger som tilbys. Erstattet = historisk, skrivebeskyttet. */
export function aliasActions(p: Pick<AliasPreview, "status" | "aliasType" | "canEdit">): Set<AliasAction> {
  const out = new Set<AliasAction>();
  if (!p.canEdit || p.status === "superseded") return out;
  if (p.status !== "confirmed" && MATCHABLE_TYPES.has(p.aliasType)) out.add("confirm");
  if (p.status !== "rejected") out.add("reject");
  out.add("replace");
  return out;
}

export interface AliasEditResult { action: AliasAction; alias: AliasPreview }

/** Suksess krever ok, samme handling, ingen faktura-/kostendring og gyldig fersk forhåndsvisning. */
export function parseAliasEditResult(data: unknown, action: AliasAction, aliasId: string, rmsId: string): AliasEditResult | null {
  if (!isObj(data) || data.ok !== true || data.action !== action) return null;
  if (data.invoice_lines_changed !== 0 || data.cost_prices_changed !== 0 || !isObj(data.alias)) return null;
  const returnedId = typeof data.alias.alias_id === "string" ? data.alias.alias_id : "";
  // Retting gir ny alias-ID; ellers skal ID-en være den samme.
  if (action !== "replace" && returnedId !== aliasId) return null;
  if (action === "replace" && (!returnedId || returnedId === aliasId)) return null;
  const alias = parseAliasPreview(data.alias, returnedId, rmsId);
  if (!alias) return null;
  if (action === "confirm" && alias.status !== "confirmed") return null;
  if (action === "reject" && alias.status !== "rejected") return null;
  if (action === "replace" && (alias.status !== "pending" || alias.matchCount !== 0)) return null;
  return { action, alias };
}

export type AliasEditFailure =
  | { kind: "stale"; message: string }
  | { kind: "duplicate"; message: string }
  | { kind: "denied"; message: string }
  | { kind: "invalid"; message: string }
  | { kind: "unknown"; message: string };

const KNOWN_22023 = [
  "Begrunnelse kreves", "Oppgi et gyldig alias", "Aliasverdien er uendret", "Aliaset er allerede bekreftet",
  "Aliaset er allerede avvist", "Aliaset er erstattet", "Denne aliastypen støttes ikke", "Ny verdi brukes bare ved retting",
];

/**
 * Feilkode → visning. Bare kjente PostgREST-koder er et kjent avslag (ingenting lagret).
 * Nettverk/ukjent: utfallet er ukjent — les på nytt før noe nytt forsøk.
 */
export function classifyAliasError(e: unknown): AliasEditFailure {
  const code = isObj(e) && typeof e.code === "string" ? e.code : null;
  const msg = isObj(e) && typeof e.message === "string" ? e.message : "";
  if (code === "40001") return { kind: "stale", message: "Aliaset eller koblingen er endret siden du åpnet det. Se oppdatert tilstand; utkastet ditt er beholdt." };
  if (code === "23505") return { kind: "duplicate", message: "Verdien finnes allerede på denne koblingen. Åpne det aliaset i listen i stedet." };
  if (code === "42501" || code === "28000") return { kind: "denied", message: "Du har ikke tilgang til å endre dette aliaset." };
  if (code === "22023" || code === "P0002") {
    const known = KNOWN_22023.find((k) => msg.startsWith(k));
    return { kind: "invalid", message: known ? msg : "Handlingen er ikke gyldig for aliaset slik det er nå." };
  }
  return { kind: "unknown", message: "Utfallet er ukjent. Hent aliaset på nytt for å se om endringen ble lagret før du prøver igjen." };
}

export function validateAliasDraft(action: AliasAction, reason: string, newValue: string, oldValue: string): string | null {
  const r = reason.trim();
  if (!r) return "Skriv en begrunnelse.";
  if (reason.length > 2000) return "Begrunnelsen kan være maks 2000 tegn.";
  if (action !== "replace") return null;
  const v = newValue.trim();
  if (!v || v.length > 500 || !/[\p{L}\p{N}]/u.test(v)) return "Oppgi et gyldig alias (1–500 tegn, med bokstaver eller tall).";
  if (v.toLowerCase() === oldValue.trim().toLowerCase()) return "Aliasverdien er uendret.";
  return null;
}
