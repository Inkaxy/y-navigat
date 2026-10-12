// Ren kjerne for tellelistelesing (ingen Deno/nett). Brukes av vt-count-ocr, utskriften og vitest.
// Prinsipp: modellen gir bare FORSLAG. Identitet bevises av trykte koder sammenlignet med manifestet,
// som er deterministisk avledet av uforanderlige linjer + versjonert sideoppsett. Forventede ID-er sendes aldri.

/** Versjon av sideoppsettet. Endres hvis radhøyder/kapasitet endres — står i den trykte identiteten. */
export const VT_SHEET_LAYOUT = 2;
/** Kapasitet per A4-side i rad-enheter (én enhet = fast radhøyde i utskriften). */
export const VT_SHEET_CAPACITY = 14;
/** Tegn per navnelinje i navnekolonnen (konservativt for liten skrift). */
export const VT_NAME_CHARS_PER_LINE = 30;
/** Maks sider i én lesejobb (hver side leses i eget, avgrenset kall). */
export const VT_OCR_MAX_PAGES = 20;
/** Maks sider per Edge-kall; resten fortsettes i nye kall på samme forsøk (gjenopptakbart). */
export const VT_OCR_PAGES_PER_CALL = 3;

export interface SheetLine { id: string; snap_name: string; snap_units: { id: string; label: string; units_in_base: number }[] }
/** Rad-enheter: to navnelinjer og én pakningslinje per enhet; aldri mindre enn 1. */
export function rowUnits(l: Pick<SheetLine, "snap_name" | "snap_units">): number {
  const nameLines = Math.max(1, Math.ceil(l.snap_name.length / VT_NAME_CHARS_PER_LINE));
  return Math.min(VT_SHEET_CAPACITY, Math.max(1, Math.ceil(nameLines / 2), l.snap_units.length));
}
/** Deterministisk sideinndeling etter rad-enheter. Samme input ⇒ samme sider (utskrift og lesing). */
export function paginateSheet<T extends Pick<SheetLine, "snap_name" | "snap_units">>(sorted: T[]): T[][] {
  const pages: T[][] = []; let cur: T[] = []; let used = 0;
  for (const l of sorted) {
    const u = rowUnits(l);
    if (cur.length && used + u > VT_SHEET_CAPACITY) { pages.push(cur); cur = []; used = 0; }
    cur.push(l); used += u;
  }
  if (cur.length || pages.length === 0) pages.push(cur);
  return pages;
}
export const sheetIdentityOf = (countId: string, listId: string, rev: number, page: number, pages: number) =>
  `VT${VT_SHEET_LAYOUT}|${countId}|${listId}|r${rev}|s${page}/${pages}`;
/** Radkode trykt på arket: 10 tegn (kollisjoner oppdages og gjør siden ugyldig). */
export const rowCodeOf = (lineId: string) => lineId.replace(/-/g, "").slice(0, 10);

export const VT_OCR_SYSTEM_PROMPT = [
  "Du leser ÉN fotografert eller skannet side av en håndskrevet telleliste fra et bakeri.",
  "Returner KUN JSON med formen:",
  '{"printed_identity":string|null,"rows":[{"row_code":string|null,"amounts":[{"column":"pakninger"|"los","unit_label":string|null,"raw":string|null}],"crossed_out":boolean,"unclear":boolean,"comment":string|null}],"complete":boolean}',
  "printed_identity er den TRYKTE teksten som starter med «VT» øverst, avskrevet tegn for tegn. Uleselig: null.",
  "Ta med HVER trykte rad i rekkefølge, også tomme rader. row_code er den trykte koden i kolonnen «Kode». Ikke gjett; null hvis uleselig.",
  "raw er nøyaktig det som er håndskrevet i feltet, uten tolkning. Tomt felt: null. Ikke gjør om tomt til 0.",
  "crossed_out og unclear SKAL alltid være true eller false. complete=true bare hvis alle rader på siden er tatt med.",
  "Ikke regn ut summer. Ikke finn på rader.",
].join("\n");

export interface OcrAmount { column: "pakninger" | "los"; unit_label: string | null; raw: string | null }
export interface OcrRow { row_code: string | null; amounts: OcrAmount[]; crossed_out: boolean; unclear: boolean; comment: string | null }
export interface OcrPage { printed_identity: string | null; rows: OcrRow[]; complete: boolean }
export interface OcrDoc { pages: OcrPage[] }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strN = (v: unknown, k: string): string | null => { if (v == null) return null; if (typeof v !== "string") throw new Error(`Ugyldig lesesvar: ${k}`); return v.slice(0, 200); };
const boolStrict = (v: unknown, k: string): boolean => { if (typeof v !== "boolean") throw new Error(`Ugyldig lesesvar: ${k} mangler`); return v; };

/** Streng parser for ÉN side. Manglende/feil type (også booleans) gir feil — aldri stille standardverdi. */
export function parseOcrPage(v: unknown): OcrPage {
  if (!isObj(v) || !Array.isArray(v.rows) || v.rows.length > 80) throw new Error("Ugyldig lesesvar: side");
  return {
    printed_identity: strN(v.printed_identity, "identitet"), complete: boolStrict(v.complete, "complete"),
    rows: v.rows.map((r): OcrRow => {
      if (!isObj(r) || !Array.isArray(r.amounts) || r.amounts.length > 12) throw new Error("Ugyldig lesesvar: rad");
      return {
        row_code: strN(r.row_code, "radkode"), crossed_out: boolStrict(r.crossed_out, "crossed_out"), unclear: boolStrict(r.unclear, "unclear"), comment: strN(r.comment, "kommentar"),
        amounts: r.amounts.map((a): OcrAmount => {
          if (!isObj(a) || (a.column !== "pakninger" && a.column !== "los")) throw new Error("Ugyldig lesesvar: felt");
          return { column: a.column, unit_label: strN(a.unit_label, "enhet"), raw: strN(a.raw, "verdi") };
        }),
      };
    }),
  };
}

export type AmountRead = { kind: "tom" } | { kind: "tall"; value: number } | { kind: "usikker"; reason: string };
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

export interface ManifestLine extends SheetLine { revision: number; snap_base_unit: string | null }
export interface ManifestPage { page: number; pages: number; identity: string; lines: ManifestLine[] }
export function buildManifest(countId: string, listId: string, templateRevision: number, sortedLines: ManifestLine[]): ManifestPage[] {
  const chunks = paginateSheet(sortedLines);
  return chunks.map((lines, i) => ({ page: i + 1, pages: chunks.length, identity: sheetIdentityOf(countId, listId, templateRevision, i + 1, chunks.length), lines }));
}

/** Ett felt i et forslag. unit_id er bare gyldig når unit_known=true; ukjent pakning må velges av brukeren. */
export interface ProposalEntry { unit_id: string | null; unit_known: boolean; label: string; value: number | null; reason: string | null; raw: string | null }
export interface Proposal { line_id: string; line_revision_at_job: number; page: number; /** Lest side (0-basert, opplastingsrekkefølge). */ upload_index: number; row_code: string; entries: ProposalEntry[]; reasons: string[] }
export interface MatchResult { document_ok: boolean; issues: string[]; proposals: Proposal[]; pages_seen: number[] }

/**
 * Sammenligner leste sider (i opplastingsrekkefølge) med manifestet for NØYAKTIG én liste.
 * Ugyldig ⇒ document_ok=false (ingen forslag kan godkjennes): feil/uleselig identitet, duplikat/manglende side,
 * siden ikke fullstendig lest, kolliderende radkoder, manglende eller dobbeltleste rader.
 */
export function matchDocument(doc: OcrDoc, manifest: ManifestPage[]): MatchResult {
  const issues: string[] = []; const blocking: string[] = []; const proposals: Proposal[] = []; const seen = new Map<number, number>();
  const block = (s: string) => { issues.push(s); blocking.push(s); };
  if (manifest.length === 0) block("Listen har ingen linjer");
  doc.pages.forEach((p, idx) => {
    const id = p.printed_identity?.trim() ?? null;
    if (!id) { block(`Opplastet side ${idx + 1}: trykt identitet kunne ikke leses`); return; }
    const m = manifest.find(x => x.identity === id);
    if (!m) {
      const parts = id.split("|"); const mp = manifest[0]?.identity.split("|") ?? [];
      const why = parts[0] !== mp[0] ? "annet sideoppsett/eldre utskrift" : parts[1] !== mp[1] ? "annen telling" : parts[2] !== mp[2] ? "annen liste" : parts[3] !== mp[3] ? "annen malversjon" : "ukjent side";
      block(`Opplastet side ${idx + 1}: tilhører ikke denne listen (${why})`); return;
    }
    seen.set(m.page, (seen.get(m.page) ?? 0) + 1);
    if ((seen.get(m.page) ?? 0) > 1) { block(`Side ${m.page} er lastet opp mer enn én gang`); return; }
    if (!p.complete) block(`Side ${m.page}: lesingen er ikke fullstendig`);
    const byCode = new Map<string, ManifestLine[]>();
    for (const l of m.lines) byCode.set(rowCodeOf(l.id), [...(byCode.get(rowCodeOf(l.id)) ?? []), l]);
    for (const [code, ls] of byCode) if (ls.length > 1) block(`Side ${m.page}: radkode «${code}» er ikke entydig`);
    const used = new Map<string, number>();
    for (const r of p.rows) { const c = r.row_code?.trim(); if (c) used.set(c, (used.get(c) ?? 0) + 1); }
    for (const [code, n] of used) {
      if (!byCode.has(code)) block(`Side ${m.page}: radkode «${code}» hører ikke til siden`);
      else if (n > 1) block(`Side ${m.page}: radkode «${code}» lest ${n} ganger`);
    }
    if (p.rows.some(r => !r.row_code?.trim())) block(`Side ${m.page}: rad uten lesbar radkode`);
    for (const code of byCode.keys()) if (!used.has(code)) block(`Side ${m.page}: rad «${code}» ble ikke lest`);
    for (const r of p.rows) {
      const code = r.row_code?.trim() ?? ""; const ls = byCode.get(code);
      if (!ls || ls.length !== 1 || used.get(code) !== 1) continue;
      const line = ls[0];
      const reasons: string[] = [];
      if (r.crossed_out) reasons.push("Overstrøket"); if (r.unclear) reasons.push("Utydelig håndskrift");
      const entries: ProposalEntry[] = [];
      for (const a of r.amounts) {
        const read = readHandwrittenAmount(a.raw);
        if (read.kind === "tom") continue;
        const unit = a.column === "los"
          ? (line.snap_base_unit ? { id: null, label: line.snap_base_unit } : null)
          : line.snap_units.length === 1 && (!a.unit_label || a.unit_label === line.snap_units[0].label) ? line.snap_units[0]
          : line.snap_units.find(u => u.label === a.unit_label) ?? null;
        const base = { unit_id: unit ? unit.id : null, unit_known: !!unit, label: unit ? unit.label : a.unit_label ?? "ukjent pakning", raw: a.raw };
        if (!unit) entries.push({ ...base, value: read.kind === "tall" ? read.value : null, reason: "Pakningen kan ikke knyttes til listens telleenheter — velg enhet" });
        else if (read.kind === "usikker") entries.push({ ...base, value: null, reason: read.reason });
        else if (r.crossed_out || r.unclear) entries.push({ ...base, value: null, reason: reasons.join(", ") });
        else entries.push({ ...base, value: read.value, reason: null });
      }
      if (entries.length === 0 && !r.crossed_out) continue;
      proposals.push({ line_id: line.id, line_revision_at_job: line.revision, page: m.page, upload_index: idx, row_code: code, entries, reasons });
    }
  });
  for (const m of manifest) if (!seen.has(m.page)) block(`Side ${m.page} av ${m.pages} mangler`);
  return { document_ok: blocking.length === 0, issues, proposals, pages_seen: [...seen.keys()].sort((a, b) => a - b) };
}

/**
 * Manifest fra en UTSTEDT sideinndeling (lagret ved utskrift). Ukjente linje-ID-er eller linjer som mangler gir feil —
 * historiske ark valideres mot det som faktisk ble trykt, ikke en rekonstruksjon.
 */
export function manifestFromIssued(countId: string, listId: string, templateRevision: number, pages: string[][], lines: ManifestLine[]): ManifestPage[] {
  const byId = new Map(lines.map(l => [l.id, l]));
  const ids = pages.flat();
  if (new Set(ids).size !== ids.length || ids.length !== lines.length || ids.some(id => !byId.has(id))) throw new Error("Utstedt manifest stemmer ikke med listen");
  return pages.map((p, i) => ({ page: i + 1, pages: pages.length, identity: sheetIdentityOf(countId, listId, templateRevision, i + 1, pages.length), lines: p.map(id => byId.get(id) as ManifestLine) }));
}

/** Et forslag kan godkjennes bare når hvert felt er avklart: gyldig verdi + kjent enhet, eller eksplisitt utelatt med begrunnelse. */
export interface EntryDecision { value: number | null; unit_id: string | null; unit_chosen: boolean; excluded: boolean; exclude_reason: string }
export function proposalResolution(entries: ProposalEntry[], decisions: EntryDecision[]): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  entries.forEach((e, i) => {
    const d = decisions[i];
    if (!d) { problems.push(`${e.label}: ikke vurdert`); return; }
    if (d.excluded) { if (d.exclude_reason.trim().length < 3) problems.push(`${e.label}: begrunn hvorfor feltet utelates`); return; }
    if (d.value == null || !Number.isFinite(d.value) || d.value < 0) problems.push(`${e.label}: skriv inn verdi eller utelat med begrunnelse`);
    if (!e.unit_known && !d.unit_chosen) problems.push(`${e.label}: velg enhet`);
  });
  const units = decisions.filter(d => !d.excluded).map(d => d.unit_id ?? "base");
  if (new Set(units).size !== units.length) problems.push("Samme enhet er brukt i to felt");
  return { ok: problems.length === 0 && entries.length > 0, problems };
}
