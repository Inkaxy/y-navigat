// Ren kjerne for tellelistelesing (ingen Deno/nett). Brukes av vt-count-ocr og testes i vitest.
// Prinsipp: modellen gir bare FORSLAG. Identitet bevises av trykte koder sammenlignet med
// serverens uforanderlige utskriftsmanifest — forventede ID-er sendes ALDRI i prompten.

export const VT_SHEET_LINES_PER_PAGE = 14;

export const VT_OCR_SYSTEM_PROMPT = [
  "Du leser fotograferte eller skannede håndskrevne tellelister fra et bakeri.",
  "Returner KUN JSON med formen:",
  '{"pages":[{"printed_identity":string|null,"printed_page":string|null,"rows":[{"row_code":string|null,"amounts":[{"column":"pakninger"|"los","unit_label":string|null,"raw":string|null}],"crossed_out":boolean,"unclear":boolean,"comment":string|null}]}]}',
  "printed_identity er den TRYKTE teksten som starter med «VT1|» øverst på siden, avskrevet tegn for tegn. Hvis den ikke kan leses sikkert: null.",
  "row_code er den trykte koden i kolonnen «Kode» (8 tegn). Ikke gjett; null hvis uleselig.",
  "raw er nøyaktig det som er håndskrevet i feltet, uten tolkning. Tomt felt: null. Ikke gjør om tomt til 0.",
  "Overstrøket tall: crossed_out=true. Usikker håndskrift: unclear=true. Ikke regn ut summer. Ikke finn på rader.",
].join("\n");

export interface OcrAmount { column: "pakninger" | "los"; unit_label: string | null; raw: string | null }
export interface OcrRow { row_code: string | null; amounts: OcrAmount[]; crossed_out: boolean; unclear: boolean; comment: string | null }
export interface OcrPage { printed_identity: string | null; printed_page: string | null; rows: OcrRow[] }
export interface OcrDoc { pages: OcrPage[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strN = (v: unknown): string | null => (typeof v === "string" ? v.slice(0, 200) : null);

/** Streng parser. Ukjent form gir feil — aldri tom suksess. */
export function parseOcrOutput(v: unknown): OcrDoc {
  if (!isObj(v) || !Array.isArray(v.pages) || v.pages.length === 0 || v.pages.length > 40) throw new Error("Ugyldig lesesvar: sider mangler");
  return {
    pages: v.pages.map((p): OcrPage => {
      if (!isObj(p) || !Array.isArray(p.rows) || p.rows.length > 60) throw new Error("Ugyldig lesesvar: side");
      return {
        printed_identity: strN(p.printed_identity), printed_page: strN(p.printed_page),
        rows: p.rows.map((r): OcrRow => {
          if (!isObj(r) || !Array.isArray(r.amounts) || r.amounts.length > 12) throw new Error("Ugyldig lesesvar: rad");
          return {
            row_code: strN(r.row_code), crossed_out: r.crossed_out === true, unclear: r.unclear === true, comment: strN(r.comment),
            amounts: r.amounts.map((a): OcrAmount => {
              if (!isObj(a) || (a.column !== "pakninger" && a.column !== "los")) throw new Error("Ugyldig lesesvar: felt");
              return { column: a.column, unit_label: strN(a.unit_label), raw: strN(a.raw) };
            }),
          };
        }),
      };
    }),
  };
}

export type AmountRead = { kind: "tom" } | { kind: "tall"; value: number } | { kind: "usikker"; reason: string };

/** Tolker håndskrevet mengde. Tvetydige skilletegn og alt annet enn rene tall er usikkert. */
export function readHandwrittenAmount(raw: string | null): AmountRead {
  if (raw == null) return { kind: "tom" };
  const t = raw.replace(/\s+/g, "");
  if (t === "" || t === "-" || t === "—") return { kind: "tom" };
  if (/^\d{1,7}$/.test(t)) return { kind: "tall", value: Number(t) };
  if (/^\d{1,7},\d{1,3}$/.test(t)) return { kind: "tall", value: Number(t.replace(",", ".")) };
  if (/^\d{1,3}\.\d{3}$/.test(t)) return { kind: "usikker", reason: "Punktum kan være tusenskille eller desimal" };
  if (/^\d{1,7}\.\d{1,2}$/.test(t)) return { kind: "usikker", reason: "Punktum som desimaltegn — bekreft verdien" };
  if (/[\/½¼¾]/.test(t)) return { kind: "usikker", reason: "Brøk må bekreftes" };
  return { kind: "usikker", reason: "Uleselig eller ikke et tall" };
}

export interface ManifestLine { id: string; revision: number; snap_base_unit: string | null; snap_units: { id: string; label: string; units_in_base: number }[] }
export interface ManifestPage { page: number; pages: number; identity: string; lines: ManifestLine[] }

/** Samme identitet som utskriften (report.ts sheetIdentity) og samme sideinndeling. */
export function buildManifest(countId: string, listId: string, templateRevision: number, sortedLines: ManifestLine[], perPage = VT_SHEET_LINES_PER_PAGE): ManifestPage[] {
  const chunks: ManifestLine[][] = [];
  for (let i = 0; i < sortedLines.length; i += perPage) chunks.push(sortedLines.slice(i, i + perPage));
  return chunks.map((lines, i) => ({ page: i + 1, pages: chunks.length, identity: `VT1|${countId}|${listId}|r${templateRevision}|s${i + 1}/${chunks.length}`, lines }));
}

export interface ProposalEntry { unit_id: string | null; label: string; value: number | null; reason: string | null; raw: string | null }
export interface Proposal { line_id: string; line_revision_at_job: number; page: number; row_code: string; entries: ProposalEntry[]; reasons: string[] }
export interface MatchResult { document_ok: boolean; issues: string[]; proposals: Proposal[]; pages_seen: number[] }

/**
 * Sammenligner lest dokument med manifestet for NØYAKTIG én liste. Feil/ukjent identitet,
 * duplikat- eller manglende sider gir document_ok=false (ingen forslag kan godkjennes).
 * Rader med koder utenfor siden avvises. Usikre felter forblir uten verdi med årsak.
 */
export function matchDocument(doc: OcrDoc, manifest: ManifestPage[]): MatchResult {
  const issues: string[] = []; const proposals: Proposal[] = []; const seen = new Map<number, number>();
  doc.pages.forEach((p, idx) => {
    const id = p.printed_identity?.trim() ?? null;
    const m = id ? manifest.find(x => x.identity === id) : undefined;
    if (!id) { issues.push(`Bilde/side ${idx + 1}: trykt identitet kunne ikke leses`); return; }
    if (!m) {
      const parts = id.split("|");
      const mp = manifest[0];
      const why = !mp ? "listen har ingen linjer" : parts[1] !== mp.identity.split("|")[1] ? "annen telling" : parts[2] !== mp.identity.split("|")[2] ? "annen liste" : parts[3] !== mp.identity.split("|")[3] ? "annen malversjon" : "ukjent side";
      issues.push(`Bilde/side ${idx + 1}: tilhører ikke denne listen (${why})`); return;
    }
    seen.set(m.page, (seen.get(m.page) ?? 0) + 1);
    if ((seen.get(m.page) ?? 0) > 1) { issues.push(`Side ${m.page} er lastet opp mer enn én gang`); return; }
    const codes = new Map(m.lines.map(l => [l.id.slice(0, 8), l]));
    const used = new Set<string>();
    for (const r of p.rows) {
      const code = r.row_code?.trim() ?? "";
      const line = codes.get(code);
      if (!line) { if (code) issues.push(`Side ${m.page}: radkode «${code}» hører ikke til siden — ignorert`); continue; }
      if (used.has(code)) { issues.push(`Side ${m.page}: radkode «${code}» lest to ganger — ingen forslag`); { const at = proposals.findIndex(x => x.row_code === code && x.page === m.page); if (at >= 0) proposals.splice(at, 1); } continue; }
      used.add(code);
      const reasons: string[] = [];
      if (r.crossed_out) reasons.push("Overstrøket");
      if (r.unclear) reasons.push("Utydelig håndskrift");
      const entries: ProposalEntry[] = [];
      for (const a of r.amounts) {
        const read = readHandwrittenAmount(a.raw);
        if (read.kind === "tom") continue;
        const unit = a.column === "los"
          ? (line.snap_base_unit ? { id: null, label: line.snap_base_unit } : null)
          : (line.snap_units.length === 1 && (!a.unit_label || a.unit_label === line.snap_units[0].label) ? line.snap_units[0]
            : line.snap_units.find(u => u.label === a.unit_label) ?? null);
        const base = { unit_id: unit ? unit.id : null, label: unit ? unit.label : a.unit_label ?? "ukjent enhet", raw: a.raw };
        if (!unit) entries.push({ ...base, value: null, reason: "Enheten kan ikke knyttes til listens telleenheter" });
        else if (read.kind === "usikker") entries.push({ ...base, value: null, reason: read.reason });
        else if (r.crossed_out || r.unclear) entries.push({ ...base, value: null, reason: reasons.join(", ") });
        else entries.push({ ...base, value: read.value, reason: null });
      }
      if (entries.length === 0 && !r.crossed_out) continue; // tomt = ikke talt, ingen forslag
      proposals.push({ line_id: line.id, line_revision_at_job: line.revision, page: m.page, row_code: code, entries, reasons });
    }
  });
  for (const m of manifest) if (!seen.has(m.page)) issues.push(`Side ${m.page} av ${m.pages} mangler`);
  const identityBad = issues.some(i => /tilhører ikke|identitet|mer enn én gang|mangler$/.test(i));
  return { document_ok: !identityBad && manifest.length > 0, issues, proposals, pages_seen: [...seen.keys()].sort((a, b) => a - b) };
}
