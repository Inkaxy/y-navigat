import type { PriceMover } from "@/ravarer/lib/workRpcTypes";
import { formatDate } from "@/fakturaer/lib/constants";
import { formatSignedPct } from "@/fakturaer/lib/sumDirection";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const price = (n: number | null, base: string | null) => n == null ? "—" : `${n.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} kr/${base ?? "enhet"}`;

/** Skriver ut gjeldende (filtrerte) prisliste i et eget utskriftsvindu. */
export function printPriceMovers(items: PriceMover[], opts: { title: string; subtitle: string }): boolean {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  const rows = items.map((it) => `<tr>
    <td>${esc(it.rm_name)}${it.suspicious ? "<div class=s>Mistenkelig — sjekk pakning</div>" : ""}</td>
    <td>${esc(it.supplier_name ?? "—")}</td>
    <td class=n>${price(it.before_price, it.base_unit)}<div class=d>${it.before_date ? formatDate(it.before_date) : ""}</div></td>
    <td class=n>${price(it.now_price, it.base_unit)}<div class=d>${it.now_date ? formatDate(it.now_date) : ""}</div></td>
    <td class=n>${it.change_pct == null ? "—" : formatSignedPct(it.change_pct)}</td>
    <td class=n>${it.effect_nok == null ? "—" : `${it.effect_nok >= 0 ? "+" : "−"}${Math.abs(Math.round(it.effect_nok)).toLocaleString("nb-NO")} kr`}</td>
  </tr>`).join("");
  w.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><title>${esc(opts.title)}</title><style>
    body{font-family:Inter,Arial,sans-serif;font-size:11px;margin:18mm;color:#111}
    h1{font-size:18px;margin:0}p{margin:2px 0 12px;color:#555}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:5px 4px;text-align:left;vertical-align:top}
    th{font-size:10px;text-transform:uppercase;color:#555}tr{break-inside:avoid}.n{text-align:right;white-space:nowrap}
    .d{font-size:9px;color:#666}.s{font-size:9px;color:#a00}thead{display:table-header-group}
    @page{size:A4;margin:12mm}
  </style></head><body><h1>${esc(opts.title)}</h1><p>${esc(opts.subtitle)} · ${items.length} varer · skrevet ut ${new Date().toLocaleDateString("nb-NO")}</p>
  <table><thead><tr><th>Råvare</th><th>Leverandør</th><th class=n>Før</th><th class=n>Nå</th><th class=n>Endring</th><th class=n>Effekt</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
  return true;
}
