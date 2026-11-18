// «Nullstill køen» – lokal prøvekjøring av regelmotoren mot en lesekopi av åpne linjer (bare lesing, skriver ingenting).
// Bruk: bun scripts/nullstilling-provekjoring.ts <snap.json> <cat.json> [rapport.md]
// snap.json = rader i samme form som rm_queue_reset_snapshot_lines, cat.json = { suppliers, links } som rm_queue_reset_catalog
// (lenkene kan ha `stock` = lagerført). Ekte fakturadata ligger aldri i repoet – bare i /tmp.
import { readFileSync, writeFileSync } from "node:fs";
import { parseCatalog, parseSnapLine } from "../src/ravarer/lib/nullstilling/parse";
import { planPhase1 } from "../src/ravarer/lib/nullstilling/plan";
import { FORKLARING_TEXT, linePackage } from "../src/ravarer/lib/nullstilling/readBasis";
import { CLOSE_REASON_LABEL, RULE_LABEL, type LineBasis, type PlanItem, type SnapLine } from "../src/ravarer/lib/nullstilling/types";

const [snapPath, catPath, outPath] = process.argv.slice(2);
const raw: unknown[] = JSON.parse(readFileSync(snapPath, "utf8"));
const lines = raw.map((r) => parseSnapLine(r)).filter((l): l is SnapLine => l != null);
if (lines.length !== raw.length) throw new Error(`uleselige rader: ${raw.length - lines.length}`);
const catRaw = JSON.parse(readFileSync(catPath, "utf8"));
const cat = parseCatalog({ ok: true, ...catRaw });
if (!cat) throw new Error("katalog uleselig");
const stockRm = new Set<string>((catRaw.links as { raw_material_id: string; stock?: boolean }[]).filter((x) => x.stock).map((x) => x.raw_material_id));
const byId = new Map(lines.map((l) => [l.line_id, l]));
const plan = planPhase1(lines, cat);
const out: string[] = [];
const p = (s = "") => out.push(s);
const nb = (n: number, d = 0) => n.toLocaleString("nb-NO", { minimumFractionDigits: d, maximumFractionDigits: d });
const kr = (n: number | null | undefined) => (n == null ? "–" : n.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

p(`# Prøvekjøring «Nullstill køen» – ${nb(lines.length)} åpne linjer`);
p("\n| Regel | Linjer | Leverandørvarer | Råvarer | Nye varer |\n|---|---:|---:|---:|---:|");
for (const r of [1, 2, 3, 4, 6] as const) { const t = plan.totals[r]; p(`| ${RULE_LABEL[r]} | ${nb(t.lines)} | ${nb(t.supplierItems)} | ${nb(t.rawMaterials)} | ${r === 4 ? nb(t.newItems) : ""} |`); }
p(`\nBlir stående åpne (kan ikke holdes utenfor): ${nb(plan.leftOpen.length)}`);

const why = new Map<string, number>();
for (const c of plan.closes) why.set(c.reason_code ?? "?", (why.get(c.reason_code ?? "?") ?? 0) + 1);
p("\n## Regel 6 per årsak\n\n| Årsak | Linjer |\n|---|---:|");
for (const [k, v] of [...why.entries()].sort((a, b) => b[1] - a[1])) p(`| ${CLOSE_REASON_LABEL[k as keyof typeof CLOSE_REASON_LABEL] ?? k} | ${nb(v)} |`);

// A og B: linjer i regel 3/4 som trengte pakning fra varenavnet (A) eller en forklaring (B).
type Tagged = { item: PlanItem; l: SnapLine; b: LineBasis; ppb: number | null };
const tagged: Tagged[] = [];
for (const i of plan.items.filter((x) => x.rule === 3 || x.rule === 4)) {
  const price = new Map(i.prices.map((x) => [x.line_id, x.ppb]));
  for (const id of i.line_ids) tagged.push({ item: i, l: byId.get(id)!, b: i.payload.lesegrunnlag?.[id] ?? { f: 0, pakning: "lest" }, ppb: price.get(id) ?? null });
}
const count = (f: (t: Tagged) => boolean, r?: 3 | 4) => tagged.filter((t) => (!r || t.item.rule === r) && f(t)).length;
const A = (t: Tagged) => t.b.pakning === "varenavn", B = (t: Tagged) => t.b.f !== 0;
p("\n## Hva A og B henter inn (linjer i regel 3 og 4)\n\n| | Regel 3 | Regel 4 | Sum |\n|---|---:|---:|---:|");
const row = (label: string, f: (t: Tagged) => boolean) => p(`| ${label} | ${nb(count(f, 3))} | ${nb(count(f, 4))} | ${nb(count(f))} |`);
row("A – pakning fra varenavnet", A);
row("B – forklaring (1) " + FORKLARING_TEXT[1], (t) => t.b.f === 1);
row("B – forklaring (2) " + FORKLARING_TEXT[2], (t) => t.b.f === 2);
row("B – forklaring (3) " + FORKLARING_TEXT[3], (t) => t.b.f === 3);
row("Både A og B", (t) => A(t) && B(t));
row("Verken A eller B (som før)", (t) => !A(t) && !B(t));
const bItems = new Map<string, Tagged[]>();
for (const t of tagged.filter(B)) bItems.set(t.item.line_ids.join(), [...(bItems.get(t.item.line_ids.join()) ?? []), t]);
const onlyB = plan.items.filter((i) => (i.rule === 3 || i.rule === 4) && i.prices.every((x) => !x.obs));
const bStock = tagged.filter((t) => B(t) && ((t.item.raw_material_id && stockRm.has(t.item.raw_material_id)) || t.l.rm_stock));
p(`\nB-linjer gir ingen prisobservasjon (lesevarselet står på serveren): ${nb(count(B))} linjer. Steg der ALLE linjene er B: ${nb(onlyB.length)} (regel 3: ${nb(onlyB.filter((i) => i.rule === 3).length)}, regel 4 koble: ${nb(onlyB.filter((i) => i.action === "koble").length)}, regel 4 opprett: ${nb(onlyB.filter((i) => i.action === "opprett").length)}). B-linjer på lagerførte varer: ${nb(bStock.length)}.`);

// Ti tilfeldige (fast frø) eksempler per forklaring.
let seed = 20261118;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const sample = <T,>(xs: T[], n: number) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a.slice(0, n); };
const pkgText = (l: SnapLine) => { const g = linePackage(l, l.rm_base_unit); return g.ok ? `${g.draft.qty} ${g.draft.unit}${g.count > 1 ? ` (${g.count} stk)` : ""} [${g.source}]` : "–"; };
for (const f of [1, 2, 3] as const) {
  const xs = tagged.filter((t) => t.b.f === f);
  p(`\n### Forklaring (${f}) – ${FORKLARING_TEXT[f]} – ${nb(xs.length)} linjer, ${nb(Math.min(10, xs.length))} tilfeldige\n`);
  p("| Leverandør | Faktura | Tekst | Antall | Enhetspris | Rabatt | Linjesum | Pakning | Regnestykke | Pris/grunnenhet | Regel |\n|---|---|---|---:|---:|---:|---:|---|---|---:|---|");
  for (const t of sample(xs, 10)) {
    const l = t.l, d = l.discount_amount ?? 0, g = linePackage(l, l.rm_base_unit);
    const P = g.ok ? Number(g.draft.qty.replace(",", ".")) * (g.draft.unit === "g" || g.draft.unit === "ml" ? 0.001 : 1) : null;
    const calc = f === 1 ? `${nb(l.quantity!, 3)} × ${nb(P ?? 0, 3)} × ${kr(l.unit_price)}${d ? ` − ${kr(d)}` : ""} = ${kr(l.quantity! * (P ?? 0) * l.unit_price! - d)}`
      : f === 2 ? `${nb(l.quantity!, 3)} × ${kr(l.unit_price)}${d ? ` − ${kr(d)}` : ""} = ${kr(l.quantity! * l.unit_price! - d)}`
      : `(${kr(l.total_amount)} + ${kr(d)}) ÷ ${kr(l.unit_price)} = ${nb((l.total_amount! + d) / l.unit_price!, 2)} = ${nb(l.quantity!, 3)} × ${g.ok ? g.count : "?"}`;
    p(`| ${l.supplier_name ?? ""} | ${l.invoice_number ?? ""} | ${(l.description ?? "").replace(/\|/g, "/")} | ${nb(l.quantity!, 3)} ${l.unit ?? ""} | ${kr(l.unit_price)} | ${kr(l.discount_amount)} | ${kr(l.total_amount)} | ${pkgText(l)} | ${calc} | ${kr(t.ppb)} | ${t.item.rule} ${t.item.action} |`);
  }
}

// Ny kostpris (anslag): bare linjer som gir prisobservasjon.
const cc = plan.costChanges;
const buckets: [string, (x: number | null) => boolean][] = [
  ["ingen kostpris før", (x) => x == null], ["under −20 %", (x) => x != null && x < -20], ["−20 til −10 %", (x) => x != null && x >= -20 && x < -10],
  ["−10 til −5 %", (x) => x != null && x >= -10 && x < -5], ["−5 til −1 %", (x) => x != null && x >= -5 && x < -1], ["−1 til +1 %", (x) => x != null && x >= -1 && x <= 1],
  ["+1 til +5 %", (x) => x != null && x > 1 && x <= 5], ["+5 til +10 %", (x) => x != null && x > 5 && x <= 10], ["+10 til +20 %", (x) => x != null && x > 10 && x <= 20],
  ["over +20 %", (x) => x != null && x > 20],
];
p(`\n## Ny kostpris (anslag) – ${nb(cc.length)} varer\n\n| Endring | Varer |\n|---|---:|`);
for (const [label, f] of buckets) p(`| ${label} | ${nb(cc.filter((c) => f(c.pct)).length)} |`);
p(`\nPer regel: ${[2, 3, 4].map((r) => `regel ${r}: ${nb(cc.filter((c) => c.rule === r).length)}`).join(", ")}.`);

// Utenfor reglene, til vurdering: (3) med antall utledet uten trykt stk per pakning, og «N stk» alene i varenavnet.
const uforklart = plan.closes.filter((c) => c.reason_code === "regnestykke_uforklart").map((c) => byId.get(c.line_ids[0])!);
const looser = uforklart.filter((l) => {
  const q = l.quantity, pr = l.unit_price, t = l.total_amount; if (!q || !pr || !t || q <= 0 || pr <= 0 || t <= 0) return false;
  const d = l.discount_amount && l.discount_amount > 0 ? l.discount_amount : 0, n = Math.round((t + d) / pr);
  return Number.isInteger(q) && n > q && n % q === 0 && Math.abs(n * pr - (t + d)) <= Math.max(1, 0.005 * t);
});
const stkOnly = plan.closes.filter((c) => c.reason_code === "pakning_uleselig").map((c) => byId.get(c.line_ids[0])!).filter((l) => /\b\d+\s*(stk|st)\b/i.test(l.description ?? ""));
p(`\n## Til vurdering (ikke med i reglene)\n\n- Regnestykket går opp med et helt antall n = antall × k uten trykt stk per pakning (f.eks. 1 flaske lest, 6 fakturert): ${nb(looser.length)} av ${nb(uforklart.length)} uforklarte linjer.`);
for (const l of sample(looser, 5)) p(`  - ${l.supplier_name}: «${l.description}» ${nb(l.quantity!, 3)} ${l.unit} × ${kr(l.unit_price)} = ${kr(l.total_amount)} (n = ${nb((l.total_amount! + (l.discount_amount ?? 0)) / l.unit_price!, 2)})`);
p(`- «N stk» alene i varenavnet (den eksisterende tolkningen leser ikke dette som pakning): ${nb(stkOnly.length)} linjer med uleselig pakning.`);

p("\n## Blir stående åpne\n");
for (const o of plan.leftOpen) { const l = byId.get(o.line_id)!; p(`- ${o.supplier_name} ${o.invoice_number} «${o.description}» ${nb(l.quantity ?? 0, 3)} ${l.unit ?? ""} = ${kr(l.total_amount)} – ${o.blocker}, årsak ${CLOSE_REASON_LABEL[o.reason_code]}, vare ${l.rm_name ?? "–"}, ${l.review_reason}`); }

const text = out.join("\n");
if (outPath) writeFileSync(outPath, text); else console.log(text);
