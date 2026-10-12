import type { createFakeVtApi } from "@/ravarer/varetelling/fakeApi";
import type { createFakeStage3 } from "@/ravarer/varetelling/stage3";
import type { VtCountLine } from "@/ravarer/varetelling/types";
import { paginateSheet, rowCodeOf, sheetIdentityOf, VT_SHEET_LAYOUT } from "../../supabase/pending/functions/vt-count-ocr/ocrCore";

/**
 * SYNTETISK demonstrasjon (ingen nettverk, ingen ekte opplasting, IKKE ekte AI): en startet telling med en liste over
 * flere A4-sider, utstedt manifest, et flersides prøveark (SVG «håndskrift») og ferdige lese-FORSLAG med usikre felt.
 * Gjør kontroll i nettleser mulig uten filvelger.
 */
export async function seedVaretellingDemo(api: ReturnType<typeof createFakeVtApi>, s3: ReturnType<typeof createFakeStage3>): Promise<string | null> {
  const st = api._state;
  const names = ["Rugmel grovt (demo)", "Speltmel siktet (demo)", "Havregryn store flak (demo)", "Solsikkekjerner (demo)", "Linfrø brune (demo)",
    "Gjær fersk 500 g (demo)", "Salt fint (demo)", "Sirup lys (demo)", "Kardemomme malt (demo)", "Kanel malt (demo)", "Rosiner (demo)",
    "Mandler hakket (demo)", "Kakao 22/24 (demo)", "Melis (demo)", "Vaniljekrem pulver – svært langt demonstrasjonsnavn som brytes over flere linjer (demo)",
    "Eggehvite pasteurisert (demo)", "Fløte 38 % (demo)", "Melk lett (demo)"];
  names.forEach((n, i) => {
    const id = `dm${i + 1}`;
    st.materials.push({ id, name: n, sku: `DM-${100 + i}`, base_unit: i % 5 === 4 ? "stk" : "kg", stock_tracking: i % 2 === 0, is_active: true, category: "Demo", categories: [] });
    if (i % 4 === 0) st.prices.set(id, { price: 10 + i, historyId: `hd${i}`, effective: "2026-10-01" });
    if (i % 3 === 0) st.units.set(id, [{ id: `du${i}`, label: "sekk 25 kg", units_in_base: 25 }]);
  });
  st.templates.push({ id: "tdemo", name: "Papirkontroll (demo)", department: "Bakeri", default_location_id: "l1", revision: 1, archived_at: null, updated_at: "2026-10-12T08:00:00Z" });
  names.forEach((_, i) => st.tlines.push({ id: `tld${i}`, template_id: "tdemo", raw_material_id: `dm${i + 1}`, location_id: "l1", sort_order: i + 1, count_unit_ids: [] }));
  const { countId } = await api.createCount({ opId: "demo-create", entity: "demo-firma", name: "Demo: papir og prisavklaring", plannedDate: "2026-10-12", valuationMode: "ved_start", valuationDate: null, templateIds: ["tdemo"] });
  await api.startCount({ opId: "demo-start", countId, expectedRevision: 1 });
  const list = st.lists.find(l => l.count_id === countId);
  if (!list) return null;
  const lines = st.lines.filter(l => l.count_list_id === list.id).sort((a, b) => a.sort_order - b.sort_order);
  const pages = paginateSheet(lines);
  await s3.issueManifest({ listId: list.id, layoutVersion: VT_SHEET_LAYOUT, pages: pages.map(p => p.map(l => l.id)) });
  const ident = (i: number) => sheetIdentityOf(countId, list.id, list.source_template_revision, i + 1, pages.length);
  // Samme kildekobling som ekte opplasting: én PDF med trykte sider i OMVENDT rekkefølge (s. N … 2), deretter
  // trykt side 1 som bevart WEBP-original + avledet side. Visningen må da finne riktig fil og PDF-side.
  const files: Parameters<typeof s3.seedDemo>[1] = [];
  if (pages.length >= 2) {
    const rest = pages.map((_, i) => i).slice(1).reverse();
    const pdf = await specimenPdf(rest.map(i => ({ identity: ident(i), lines: pages[i], idx: i })));
    files.push({ url: pdf, mime: "application/pdf", role: "side", printed: rest.map(i => i + 1) });
  }
  const p1 = specimenPage(ident(0), pages[0], 0);
  files.push({ url: p1, mime: "image/webp", role: "original" });
  files.push({ url: p1, mime: "image/png", role: "side", original_index: files.length - 1, printed: [1] });
  s3.seedDemo(list.id, files);
  return countId;
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] ?? c));
/** Syntetisk A4-side som SVG med trykt identitet, radkoder og «håndskrevne» tall (bare til visning). */
function specimenPage(identity: string, lines: VtCountLine[], pageIdx: number): string {
  const hand = ["2", "1.500", "", "3,5", "x?"];
  const rows = lines.map((l, i) => {
    const y = 210 + i * 64;
    return `<text x="40" y="${y}" font-family="monospace" font-size="14">${rowCodeOf(l.id)}</text>
<text x="170" y="${y}" font-family="sans-serif" font-size="15">${esc(l.snap_name.slice(0, 44))}</text>
<text x="560" y="${y}" font-family="cursive" font-size="24" fill="#1d3fa8">${esc(hand[(i + pageIdx) % hand.length])}</text>
${i % 5 === 3 ? `<line x1="550" y1="${y - 8}" x2="620" y2="${y - 8}" stroke="#1d3fa8" stroke-width="2"/>` : ""}
<line x1="30" y1="${y + 22}" x2="780" y2="${y + 22}" stroke="#999"/>`;
  }).join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="1160" viewBox="0 0 820 1160"><rect width="820" height="1160" fill="#fdfcf7"/>
<text x="40" y="60" font-family="sans-serif" font-size="22" font-weight="bold">Telleark (syntetisk demonstrasjon)</text>
<text x="40" y="95" font-family="monospace" font-size="13">${esc(identity)}</text>
<text x="40" y="150" font-family="sans-serif" font-size="13">Kode</text><text x="170" y="150" font-family="sans-serif" font-size="13">Vare</text><text x="560" y="150" font-family="sans-serif" font-size="13">Mengde</text>
${rows}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Syntetisk flersidig PDF (tekst) for visning av riktig PDF-side. Tom streng ved feil (visningen sier da at filen mangler). */
async function specimenPdf(pages: { identity: string; lines: VtCountLine[]; idx: number }[]): Promise<string> {
  try {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const hand = ["2", "1.500", "", "3,5", "x?"];
    pages.forEach((p, k) => {
      if (k > 0) doc.addPage();
      doc.setFontSize(14); doc.text("Telleark (syntetisk demonstrasjon)", 14, 18);
      doc.setFontSize(8); doc.text(p.identity, 14, 26);
      p.lines.forEach((l, i) => { const y = 40 + i * 14; doc.setFontSize(9); doc.text(rowCodeOf(l.id), 14, y); doc.text(l.snap_name.slice(0, 60), 50, y); doc.setFontSize(13); doc.text(hand[(i + p.idx) % hand.length], 170, y); });
    });
    return URL.createObjectURL(doc.output("blob"));
  } catch { return ""; }
}
