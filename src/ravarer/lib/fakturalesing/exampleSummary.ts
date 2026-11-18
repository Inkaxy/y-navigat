// Kort norsk beskrivelse av en læringsretting (før → etter) for innstillingssiden. Ren kode.
import { formatNumber } from "@/ravarer/lib/constants";

const FIELD_LABEL: Record<string, string> = {
  supplier_sku: "Varenummer", description: "Tekst", quantity: "Antall", unit: "Enhet", package_size: "Pakning",
  package_unit: "Pakningsenhet", count_per_package: "Antall per pakning", unit_price: "Enhetspris", total_amount: "Sum",
  line_kind: "Linjetype", unit_price_basis: "Prisgrunnlag", discount_amount: "Rabatt", raw_material_name: "Vare",
  base_unit: "Grunnenhet", not_item: "Ikke vare", base_units_per_package: "Grunnenheter per pakning",
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v === "number" && Number.isFinite(v)) return formatNumber(v);
  if (typeof v === "boolean") return v ? "ja" : "nei";
  if (typeof v === "string") return v.length > 40 ? `${v.slice(0, 39)}…` : v;
  return "–";
}

/** «Antall: 1 → 6» per rettet felt; felt som ikke endret seg utelates. Høyst `max` felt. */
export function exampleChanges(original: unknown, corrected: unknown, max = 4): string[] {
  const o = rec(original), c = rec(corrected);
  const out: string[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (out.length >= max) break;
    if (k === "not_item") { if (v === true) out.push("Ikke en vare"); continue; }
    if (show(o[k]) === show(v)) continue;
    out.push(k in o ? `${FIELD_LABEL[k] ?? k}: ${show(o[k])} → ${show(v)}` : `${FIELD_LABEL[k] ?? k}: ${show(v)}`);
  }
  return out;
}

export function exampleTitle(original: unknown): string {
  const o = rec(original);
  const sku = typeof o.supplier_sku === "string" && o.supplier_sku ? `${o.supplier_sku} · ` : "";
  return `${sku}${typeof o.description === "string" && o.description ? o.description : "Uten tekst"}`;
}
