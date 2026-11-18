// «Nullstill køen» – utfører ett steg med de SAMME skriveveiene som knappene i Fra faktura:
//   regel 1  → link-supplier-item (not_raw_material, «Ikke vare» med regel som i dag)
//   regel 3/4 → link-supplier-item (koble/opprett + pakning) og deretter rm_remember_supplier_item_names (skrivemåter)
//   regel 2  → rm_supplier_item_accept_price («Prisen stemmer»)
//   regel 6  → rm_set_invoice_exclusion (linje, kategori «nullstilling», stegets op-id) – ingen prisobservasjon
// Læringseksempler for fakturaleseren lagres ALDRI herfra (rm_record_extraction_example kalles ikke).
// Avhengighetene injiseres (testes uten nett). Utfall: ferdig, feilet (sikker avvisning) eller uavklart (ukjent – kontrolleres).
import type { LinkSupplierItemBody, LinkSupplierItemResult } from "@/fakturaer/lib/supplierItems";
import type { ExclusionResult } from "@/fakturaer/lib/invoiceExclusion";
import { exclusionErrorText } from "@/fakturaer/lib/invoiceExclusion";
import type { ClaimedItem } from "./parse";
import { RESET_LABEL } from "./types";

export type LinkOutcome = { kind: "ok"; r: LinkSupplierItemResult } | { kind: "rejected"; message: string } | { kind: "unknown"; message: string };
export type AcceptOutcome =
  | { kind: "ok"; accepted: number; skipped: { id: string; message: string }[] }
  | { kind: "rejected"; message: string } | { kind: "unknown"; message: string };
export type ExcludeOutcome = ExclusionResult | { kind: "denied" };
export type LineVersion = { open: boolean; updatedAt: string; invoiceId: string } | null;

export interface ExecDeps {
  link: (body: LinkSupplierItemBody) => Promise<LinkOutcome>;
  rememberNames: (a: { le: string; supplierId: string; itemKey: string; rmsId: string }) => Promise<boolean>;
  acceptPrice: (a: { le: string; supplierId: string; itemKey: string; lines: { id: string; price_per_base_unit: number | null }[]; reason: string }) => Promise<AcceptOutcome>;
  exclude: (a: { invoiceId: string; lineId: string; reason: string; expectedUpdatedAt: string; opId: string }) => Promise<ExcludeOutcome>;
  /** Fersk versjon av linjen (brukes bare når «hold utenfor» får «versjon_endret»). null = ukjent. */
  lineVersion: (lineId: string) => Promise<LineVersion>;
}

export type StepOutcome = { status: "ferdig" | "feilet" | "uavklart"; result: Record<string, unknown>; error: string | null };

/** Begrunnelsen i revisjonsloggen: samme tekst for alle handlinger, med kjørings-id og stegets id (brukes ved kontroll). */
export function stepReason(rule: number, runId: string, itemId: string, prefix?: string): string {
  return `${prefix ?? `${RESET_LABEL} – regel ${rule}`} · kjøring ${runId.slice(0, 8)} · steg ${itemId}`;
}

const failed = (error: string, result: Record<string, unknown> = {}): StepOutcome => ({ status: "feilet", result, error });
const unknown = (error: string): StepOutcome => ({ status: "uavklart", result: {}, error });

async function linkStep(it: ClaimedItem, le: string, runId: string, deps: ExecDeps): Promise<StepOutcome> {
  if (!it.supplier_id || !it.item_key) return failed("Mangler leverandørvare.");
  const reason = stepReason(it.rule, runId, it.id);
  const body: LinkSupplierItemBody = { legal_entity_id: le, supplier_id: it.supplier_id, item_key: it.item_key, line_ids: it.line_ids, reason };
  if (it.action === "ikke_vare") body.not_raw_material = true;
  else if (it.action === "opprett") {
    const n = it.payload.new_raw_material;
    if (!n) return failed("Mangler navn og grunnenhet for ny vare.");
    body.new_raw_material = { name: n.name, base_unit: n.base_unit, item_type: n.item_type, category: n.category };
  } else {
    if (!it.raw_material_id) return failed("Mangler vare.");
    body.raw_material_id = it.raw_material_id;
  }
  if (it.action !== "ikke_vare" && it.payload.package) body.package = it.payload.package;
  const o = await deps.link(body);
  if (o.kind === "unknown") return unknown(o.message);
  if (o.kind === "rejected") return failed(o.message);
  const r = o.r;
  if (!(r.lines_updated > 0)) return failed("Ingenting ble lagret – linjene kunne ikke endres (løst, låst eller avsluttet i mellomtiden).", { lines_updated: 0, skipped_line_ids: r.skipped_line_ids ?? [] });
  const result: Record<string, unknown> = {
    lines_updated: r.lines_updated, raw_material_id: r.raw_material_id, created: r.created_raw_material, still_open_lines: r.still_open_lines,
    skipped_line_ids: r.skipped_line_ids ?? [],
  };
  if (it.action !== "ikke_vare" && r.raw_material_supplier_id) {
    // Som knappen: skrivemåtene huskes etter koblingen. Feil her gjør ikke koblingen ugyldig.
    result.names_remembered = await deps.rememberNames({ le, supplierId: it.supplier_id, itemKey: it.item_key, rmsId: r.raw_material_supplier_id }).catch(() => false);
  }
  return { status: "ferdig", result, error: null };
}

async function acceptStep(it: ClaimedItem, le: string, runId: string, deps: ExecDeps): Promise<StepOutcome> {
  if (!it.supplier_id || !it.item_key || !it.payload.lines?.length) return failed("Mangler linjene som skal godtas.");
  const o = await deps.acceptPrice({ le, supplierId: it.supplier_id, itemKey: it.item_key, lines: it.payload.lines, reason: stepReason(2, runId, it.id) });
  if (o.kind === "unknown") return unknown(o.message);
  if (o.kind === "rejected") return failed(o.message);
  if (o.accepted === 0) return failed(`Ingen linjer ble godtatt${o.skipped.length ? `: ${[...new Set(o.skipped.map((s) => s.message))].join("; ")}` : "."}`, { accepted: 0, skipped: o.skipped });
  return { status: "ferdig", result: { accepted: o.accepted, skipped: o.skipped }, error: null };
}

async function excludeStep(it: ClaimedItem, runId: string, deps: ExecDeps): Promise<StepOutcome> {
  const lineId = it.line_ids[0];
  const invoiceId = it.payload.invoice_id;
  if (!invoiceId || !it.payload.line_updated_at) return failed("Mangler faktura eller linjeversjon.");
  const reason = stepReason(6, runId, it.id, it.payload.reason_text);
  const send = (expected: string) => deps.exclude({ invoiceId, lineId, reason: reason.slice(0, 500), expectedUpdatedAt: expected, opId: it.op_id });
  let r = await send(it.payload.line_updated_at);
  // Linjen kan ha blitt regnet om etter planen (omregningskøen). Fersk versjon: fortsatt åpen → avslutt den; løst → ingenting å gjøre.
  if (r.kind === "rejected" && r.error === "versjon_endret") {
    const v = await deps.lineVersion(lineId);
    if (!v) return unknown("Linjen er endret, og ny versjon kunne ikke leses. Kontroller før nytt forsøk.");
    if (!v.open) return { status: "ferdig", result: { already_resolved: true }, error: null };
    r = await send(v.updatedAt);
  }
  if (r.kind === "ok") return { status: "ferdig", result: { already: r.already }, error: null };
  if (r.kind === "denied") return failed("Mangler skrivetilgang til fakturaer.");
  if (r.kind === "rejected") return failed(exclusionErrorText(r), { error: r.error });
  return unknown("Utfallet er ukjent. Kontroller steget før nytt forsøk.");
}

export async function executeStep(it: ClaimedItem, ctx: { le: string; runId: string }, deps: ExecDeps): Promise<StepOutcome> {
  try {
    if (it.action === "godta_pris") return await acceptStep(it, ctx.le, ctx.runId, deps);
    if (it.action === "hold_utenfor") return await excludeStep(it, ctx.runId, deps);
    return await linkStep(it, ctx.le, ctx.runId, deps);
  } catch (e) {
    return unknown(e instanceof Error ? e.message : "Ukjent feil.");
  }
}
