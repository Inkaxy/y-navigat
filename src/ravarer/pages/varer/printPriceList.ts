import type { RawMaterialListItem } from "@/ravarer/lib/varerListFilter";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

type Row = Pick<RawMaterialListItem, "name" | "sku" | "supplierName" | "costPrice" | "baseUnit" | "costStatus">;

/** Skriver ut varelisten slik den er filtrert/søkt nå. Ikke-verifisert kostpris merkes. */
export function printPriceList(items: Row[], title: string): boolean {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return false;
  const rows = items.map((it) => `<tr>
    <td>${esc(it.name)}</td><td>${esc(it.sku ?? "")}</td><td>${esc(it.supplierName ?? "—")}</td>
    <td class=n>${it.costPrice == null ? "—" : `${it.costPrice.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr/${esc(it.baseUnit ?? "enhet")}`}${it.costPrice != null && it.costStatus !== "verifisert" ? "<div class=s>Ikke verifisert</div>" : ""}</td>
  </tr>`).join("");
  w.document.write(`<!doctype html><html lang="no"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font-family:Inter,Arial,sans-serif;font-size:11px;margin:0;color:#111}
    h1{font-size:18px;margin:0}p{margin:2px 0 12px;color:#555}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ccc;padding:5px 4px;text-align:left;vertical-align:top}
    th{font-size:10px;text-transform:uppercase;color:#555}tr{break-inside:avoid}.n{text-align:right;white-space:nowrap}
    .s{font-size:9px;color:#a00}thead{display:table-header-group}@page{size:A4;margin:12mm}
  </style></head><body><h1>${esc(title)}</h1><p>${items.length} varer · skrevet ut ${new Date().toLocaleDateString("nb-NO")}</p>
  <table><thead><tr><th>Råvare</th><th>Varenr.</th><th>Leverandør</th><th class=n>Kostpris</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 200);
  return true;
}
