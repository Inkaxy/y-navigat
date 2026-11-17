/** D5: «Leverandører og innkjøpspris» – ren logikk (testes uten nettverk). */
export const COST_RULES = ["hovedleverandor", "billigste", "avtalt"] as const;
export type CostRule = (typeof COST_RULES)[number];
export const COST_RULE_LABEL: Record<CostRule, string> = {
  hovedleverandor: "Siste kjøp fra hovedleverandør",
  billigste: "Billigste siste kjøp",
  avtalt: "Avtalt pris",
};
export function parseCostRule(v: unknown): CostRule {
  return typeof v === "string" && (COST_RULES as readonly string[]).includes(v) ? (v as CostRule) : "hovedleverandor";
}

export type PurchaseRow = { supplier_id: string | null; price: number; effective_date: string; snapshot_unit: string | null; is_credit: boolean };
export type LastPurchase = { price: number; date: string; comparable: boolean };

/** Siste kjøp per leverandør (radene er nyeste først). Kreditnotaer og pris ≤ 0 teller ikke. */
export function lastPurchaseBySupplier(rows: readonly PurchaseRow[], baseUnit: string): Map<string, LastPurchase> {
  const out = new Map<string, LastPurchase>();
  for (const r of rows) {
    if (!r.supplier_id || r.is_credit || !(r.price > 0) || out.has(r.supplier_id)) continue;
    out.set(r.supplier_id, { price: r.price, date: r.effective_date, comparable: r.snapshot_unit == null || r.snapshot_unit === baseUnit });
  }
  return out;
}

/** Hva kalkylen bruker, i klartekst under velgeren. */
export function costRuleExplanation(rule: CostRule, primaryName: string | null, cheapest: { name: string } | null): string {
  if (rule === "billigste") return cheapest ? `Bruker det billigste av siste kjøp fra hver leverandør – nå ${cheapest.name}.` : "Bruker det billigste av siste kjøp fra hver leverandør.";
  if (rule === "avtalt") return `Bruker avtalt pris når den finnes, ellers siste kjøp fra ${primaryName ?? "hovedleverandøren"}.`;
  return primaryName
    ? `Bruker siste kjøp fra ${primaryName}. Kjøp fra andre leverandører vises i historikken, men endrer ikke kalkylen.`
    : "Ingen hovedleverandør er valgt. Kalkylen bruker siste gyldige kjøp uansett leverandør.";
}

/** Billigste sammenlignbare siste kjøp. */
export function cheapestSupplier(last: ReadonlyMap<string, LastPurchase>): string | null {
  let best: [string, number] | null = null;
  for (const [id, p] of last) if (p.comparable && (!best || p.price < best[1])) best = [id, p.price];
  return best?.[0] ?? null;
}

/** «Kjennes igjen på»: varenummer først, så skrivemåter (unike, uten store/små-forskjell). */
export function recognizedBy(sku: string | null, aliases: readonly { type: string; value: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => { const k = s.trim().toLowerCase(); if (k && !seen.has(k)) { seen.add(k); out.push(s.trim()); } };
  if (sku) add(`varenr ${sku}`);
  for (const a of aliases) if (a.type === "supplier_sku") add(`varenr ${a.value}`);
  for (const a of aliases) if (a.type === "product_name") add(`«${a.value}»`);
  return out;
}
