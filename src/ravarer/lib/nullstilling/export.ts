// «Nullstill køen» – eksport av forhåndsvisningen (CSV med semikolon og norske tall, og JSON). Ren logikk.
import { FORKLARING_TEXT } from "./readBasis";
import { ACTION_LABEL, BLOCKER_LABEL, CLOSE_REASON_LABEL, RESET_LABEL, RULE_LABEL, type LineBasis, type Plan, type PlanItem, type SnapLine } from "./types";

const no = (n: number | null | undefined, d = 2) => (n == null || !Number.isFinite(n) ? "" : n.toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: d, useGrouping: false }));
const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const pkgText = (i: PlanItem) => (i.payload.package ? `${no(i.payload.package.package_size, 3)} ${i.payload.package.package_unit} (= ${no(i.payload.package.base_units_per_package, 3)} grunnenhet)` : "");

/** Lesegrunnlaget i klartekst: forklaring (B) og pakning fra varenavnet (A). Tom = lesekontrollen er grønn og pakningen er lest. */
export function basisText(b: LineBasis | undefined): string {
  if (!b) return "";
  const parts = [b.f !== 0 ? `Forklaring ${b.f}: ${FORKLARING_TEXT[b.f]} (gir ingen prisobservasjon)` : "", b.pakning === "varenavn" ? "Pakning fra varenavnet" : ""];
  return parts.filter(Boolean).join("; ");
}

export const CSV_HEADER = ["Regel", "Handling", "Årsak", "Leverandør", "Faktura", "Fakturadato", "Linje-id", "Tekst på fakturaen", "Varenøkkel", "Vare", "Pakning", "Pris per grunnenhet", "Kostpris før", "Lesegrunnlag", "Merknad"];

export function planCsv(plan: Plan, lines: ReadonlyMap<string, SnapLine>): string {
  const rows: string[][] = [CSV_HEADER];
  for (const i of [...plan.items, ...plan.closes]) {
    const price = new Map(i.prices.map((p) => [p.line_id, p.ppb]));
    for (const id of i.line_ids) {
      const l = lines.get(id);
      rows.push([
        String(i.rule), ACTION_LABEL[i.action], i.reason_code ? CLOSE_REASON_LABEL[i.reason_code] : "", i.supplier_name ?? "", l?.invoice_number ?? "", l?.invoice_date ?? "",
        id, l?.description ?? i.payload.title, i.item_key ?? "", i.raw_material_name ?? "", pkgText(i),
        no(i.rule === 2 ? l?.price_per_base_unit : price.get(id), 4), no(i.payload.cost_before ?? null, 4), basisText(i.payload.lesegrunnlag?.[id]), i.detail ?? "",
      ]);
    }
  }
  for (const o of plan.leftOpen) {
    const l = lines.get(o.line_id);
    rows.push(["6", "Blir stående åpen", `${CLOSE_REASON_LABEL[o.reason_code]} – ${BLOCKER_LABEL[o.blocker] ?? o.blocker}`, o.supplier_name ?? "", o.invoice_number ?? "", l?.invoice_date ?? "",
      o.line_id, o.description ?? "", l?.item_key ?? "", l?.rm_name ?? "", "", "", "", "", "Kan ikke holdes utenfor"]);
  }
  return rows.map((r) => r.map(cell).join(";")).join("\r\n");
}

export function planJson(plan: Plan, generatedAt: string): string {
  const strip = (i: PlanItem) => ({ regel: i.rule, regeltekst: RULE_LABEL[i.rule], handling: i.action, aarsak: i.reason_code, merknad: i.detail,
    leverandor: i.supplier_name, leverandor_id: i.supplier_id, varenokkel: i.item_key, vare: i.raw_material_name, vare_id: i.raw_material_id,
    linjer: i.line_ids, fakturaer: i.invoice_ids, pakning: i.payload.package ?? null, ny_vare: i.payload.new_raw_material ?? null, kostpris_for: i.payload.cost_before ?? null,
    lesegrunnlag: i.payload.lesegrunnlag ?? null });
  return JSON.stringify({ kjoring: RESET_LABEL, laget: generatedAt, fingeravtrykk: plan.fingerprint, linjer_i_utvalget: plan.snapshotIds.length,
    per_regel: plan.totals, hentet_inn: plan.readStats, per_leverandor: plan.bySupplier, ny_kostpris_anslag: plan.costChanges, nye_varer: plan.creations,
    steg: plan.items.map(strip), lukkes_anslag: plan.closes.map(strip), blir_staaende_aapne: plan.leftOpen }, null, 2);
}
