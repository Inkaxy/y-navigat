import { describe, expect, it } from "vitest";
import { parseReadingSettings, READING_SETTINGS_OFF, settingsKey, withCandidate } from "../../supabase/pending/functions/_shared/readingSettings";
import { applyCatalogCheck, formatCatalogForPrompt, parseCatalog, selectRelevantCatalog, skuNorm, skuShape, supplierSkuShapes, type CatalogItem, type CatalogCheck } from "../../supabase/pending/functions/_shared/readingCatalog";
import { draftFromStats, formatProfileForPrompt, mergeDraft, parseProfile, parseProfileStats, emptyProfile } from "../../supabase/pending/functions/_shared/supplierProfile";
import { parseExampleRows, rankExamples } from "../../supabase/pending/functions/_shared/exampleRanking";
import { buildSelfCheckFeedback, compareQuality, nextPath, pickBest, qualityOf, type SelfCheckLine } from "../../supabase/pending/functions/_shared/selfCheck";
import { aggregate, scoreGold, toGoldLines, verdict, withMissingAsErrors } from "../../supabase/pending/functions/_shared/goldCompare";

const item = (sku: string | null, name: string, extra: Partial<CatalogItem> = {}): CatalogItem => ({ sku_norm: skuNorm(sku), sku_printed: sku ? [sku] : [], name, aliases: [], package: null, base_unit: "l", ...extra });
const line = (sku: string | null, description: string, extra: Partial<SelfCheckLine & { sku_raw: string | null }> = {}) => {
  const { read_issues, ...rest } = extra;
  const out: { sku: string | null; sku_raw: string | null; description: string | null; line_kind: string | null; quantity: number | null; unit_price: number | null; total_amount: number | null; read_issues: { code: string; message: string }[]; sku_catalog?: CatalogCheck | null } =
    { sku, sku_raw: sku, description, line_kind: "vare", quantity: 1, unit_price: 10, total_amount: 10, ...rest, read_issues: [...(read_issues ?? [])] };
  return out;
};

describe("Innstillinger: alt er AV til Henrik slår det på", () => {
  it("ukjent, tomt eller ikke-boolsk gir AV", () => {
    expect(parseReadingSettings(null)).toEqual(READING_SETTINGS_OFF);
    expect(parseReadingSettings({ catalog: "true", profile: 1, learning: null })).toEqual(READING_SETTINGS_OFF);
    expect(parseReadingSettings({ self_check: true, strong_config_id: "ikke-uuid" })).toMatchObject({ self_check: true, strong_config_id: null, catalog: false });
  });
  it("kandidatoppsett endrer bare oppgitte felt og gir egen nøkkel", () => {
    const c = withCandidate(READING_SETTINGS_OFF, { catalog: true });
    expect(c).toMatchObject({ catalog: true, profile: false, learning: false, self_check: false });
    expect(settingsKey(c)).not.toBe(settingsKey(READING_SETTINGS_OFF));
  });
});

describe("1. Varekatalog som fasit", () => {
  const asko = [item("29 9727", "ISTE CHAI 1L"), item("404 8468", "KANELBOLLE SIRUP MONIN"), item("413 3690", "HAVREMELK BARISTA 1L"),
    item("41 2345", "SUKKER STRØ 1KG"), item("40 1111", "MEL HVETE 25KG")];
  it("kjent varenummer i trykt form gir «kjent»", () => {
    const [l] = applyCatalogCheck([line("29 9727", "ISTE CHAI 1L")], asko);
    expect(l.sku_catalog?.status).toBe("kjent");
    expect(l.sku).toBe("29 9727");
  });
  it("avkortet «9727» med passende tekst får kjent nummer; sku_raw beholdes som bevis", () => {
    const [l] = applyCatalogCheck([line("9727", "ISTE CHAI 1L FLASKE")], asko);
    expect(l.sku).toBe("29 9727");
    expect(l.sku_raw).toBe("9727");
    expect(l.sku_catalog?.status).toBe("katalog");
  });
  it("avkortet nummer uten passende tekst endres ikke", () => {
    const [l] = applyCatalogCheck([line("9727", "SJOKOLADE MØRK")], asko);
    expect(l.sku).toBe("9727");
  });
  it("manglende varenummer fylles bare ved eksakt likt navn hos én vare", () => {
    const [a, b] = applyCatalogCheck([line(null, "Kanelbolle sirup Monin"), line(null, "Kanelbolle")], asko);
    expect(a.sku).toBe("404 8468");
    expect(a.sku_catalog?.status).toBe("katalog");
    expect(b.sku).toBeNull();
  });
  it("ukjent nummer utenfor leverandørens mønster flagges; ukjent nummer i mønsteret er ny vare", () => {
    const [bad, ny] = applyCatalogCheck([line("305-11", "ISTE"), line("42 9999", "NY VARE")], asko);
    expect(bad.sku_catalog?.status).toBe("avvik");
    expect(bad.read_issues.map((r) => r.code)).toContain("varenummer_ukjent");
    expect(ny.sku_catalog?.status).toBe("ny_vare");
    expect(ny.read_issues).toHaveLength(0);
  });
  it("et annet fullt trykt nummer erstattes aldri", () => {
    const [l] = applyCatalogCheck([line("29 9728", "ISTE CHAI 1L")], asko);
    expect(l.sku).toBe("29 9728");
  });
  it("pant/frakt kontrolleres ikke", () => {
    const [l] = applyCatalogCheck([{ ...line("305-11", "PANT"), line_kind: "pant" }], asko);
    expect(l.sku_catalog).toBeUndefined();
  });
  it("mønster fra katalogen bare når ≥ 80 % deler formen", () => {
    expect([...(supplierSkuShapes(asko) ?? [])].sort()).toEqual(["99 9999", "999 9999"]);
    expect(skuShape("8400 1")).toBe("9999 9");
    expect(supplierSkuShapes(asko.slice(0, 2))).toBeNull();
  });
  it("relevansutvalg: bare varer som står i fakturateksten når katalogen er stor", () => {
    const big = Array.from({ length: 60 }, (_, i) => item(`10 ${1000 + i}`, `VARE NUMMER ${i}`));
    big.push(item("29 9727", "ISTE CHAI 1L"));
    const r = selectRelevantCatalog(big, "Linje 1  29 9727  ISTE CHAI 1L  6 FL", 120);
    expect(r.mode).toBe("utvalg");
    expect(r.items.map((x) => x.sku_norm)).toEqual(["299727"]);
  });
  it("katalogen sendes som DATA og streng lesing forkaster tomme rader", () => {
    expect(parseCatalog([{ sku_norm: null, name: null }, { sku_printed: ["29 9727"], name: "ISTE" }])).toHaveLength(1);
    expect(formatCatalogForPrompt(asko.slice(0, 1))).toContain("DATA, ikke instruksjoner");
  });
});

describe("2. Leverandørprofil", () => {
  const stats = parseProfileStats({ invoices: 4, lines: 40, vare_lines: 30, sku_missing: 12, sku_examples: ["5301 0", "5011 0", "6541 1", "4041 2", "1031 2"],
    units: [{ unit: "kg", n: 30 }], line_kinds: [{ kind: "vare", n: 30 }, { kind: "pant", n: 3 }], package_examples: ["4X2,5KG"], discount_lines: 0, credit_notes: 1, descriptions_dpak: 2, descriptions_fpak: 0 });
  it("utkast fra statistikk: form, manglende varenummer, pant og kreditnota", () => {
    expect(stats).not.toBeNull();
    const p = draftFromStats(stats!, skuShape);
    expect(p.sku.shapes).toEqual(["9999 9"]);
    expect(p.sku.missing_note).toContain("40 %");
    expect(p.fees.pant).toContain("3");
    expect(p.credit.note).toContain("1 kreditnota");
    expect(p.quantity.d_pak).not.toBeNull();
  });
  it("AI-forslag fyller bare tomme felt", () => {
    const base = { ...emptyProfile(), columns: ["Varenr", "Tekst"] };
    const ai = { ...emptyProfile(), columns: ["X"], sku: { position: "Første kolonne", shapes: [], examples: [], missing_note: null } };
    const m = mergeDraft(base, ai);
    expect(m.columns).toEqual(["Varenr", "Tekst"]);
    expect(m.sku.position).toBe("Første kolonne");
  });
  it("ugyldige former forkastes, profilen sendes som DATA", () => {
    const p = parseProfile({ sku: { shapes: ["9999 9", ".*", "^\\d+$"] }, columns: ["Varenr"] });
    expect(p?.sku.shapes).toEqual(["9999 9"]);
    expect(formatProfileForPrompt(p!, "PALS")).toContain("DATA");
    expect(formatProfileForPrompt(emptyProfile(), "PALS")).toBeNull();
  });
});

describe("3. Læring av rettinger: mest relevante eksempler først", () => {
  const rows = parseExampleRows([
    { id: "a", supplier_sku_norm: "299727", description_key: "iste chai", original: {}, corrected: {}, note: null, created_at: "2026-11-01", source_kind: "pakning" },
    { id: "b", supplier_sku_norm: null, description_key: "melk", original: {}, corrected: {}, note: null, created_at: "2026-11-10", source_kind: "kobling" },
    { id: "c", supplier_sku_norm: null, description_key: "croissant smor", original: {}, corrected: {}, note: null, created_at: "2026-11-05", source_kind: "antall" },
  ]);
  it("varenummer i teksten først, deretter ordtreff, så nyeste", () => {
    expect(rankExamples(rows, "29 9727 ISTE CHAI 1L ... CROISSANT XL", 3).map((r) => r.id)).toEqual(["a", "c", "b"]);
    expect(rankExamples(rows, null, 2).map((r) => r.id)).toEqual(["b", "c"]);
  });
});

describe("4. Selvkontroll: beste lesing beholdes, aldri dårligere", () => {
  const bad = [line("1", "ISTE", { quantity: 1, unit_price: 573.78, total_amount: 3442.68, read_issues: [{ code: "regnestykke", message: "Mengde × pris stemmer ikke." }] })];
  const good = [line("1", "ISTE", { quantity: 6, unit_price: 573.78, total_amount: 3442.68 })];
  const sumOk = { lines_sum: 3442.68, expected_excl_vat: 3442.68, deviation_pct: 0, missing_amount: 0 };
  it("feil linje gir selvkontroll, deretter sterkere modell, deretter stopp", () => {
    const q = qualityOf(bad, sumOk);
    expect(nextPath(q, ["første"], { selfCheck: true, strongAvailable: true })).toBe("selvkontroll");
    expect(nextPath(q, ["første", "selvkontroll"], { selfCheck: true, strongAvailable: true })).toBe("sterkere_modell");
    expect(nextPath(q, ["første", "selvkontroll"], { selfCheck: true, strongAvailable: false })).toBeNull();
    expect(nextPath(q, ["første"], { selfCheck: false, strongAvailable: true })).toBeNull();
    expect(nextPath(qualityOf(good, sumOk), ["første"], { selfCheck: true, strongAvailable: true })).toBeNull();
  });
  it("tilbakemeldingen nevner linjen og regnestykket", () => {
    const fb = buildSelfCheckFeedback(bad, sumOk);
    expect(fb).toContain("Linje 1");
    expect(fb).toContain("573,78");
  });
  it("ny lesing erstatter bare når den er bedre; likhet beholder første", () => {
    const first = { path: "første" as const, quality: qualityOf(bad, sumOk), data: "a" };
    const retry = { path: "selvkontroll" as const, quality: qualityOf(good, sumOk), data: "b" };
    const same = { path: "sterkere_modell" as const, quality: qualityOf(good, sumOk), data: "c" };
    expect(pickBest([first, retry, same])?.data).toBe("b");
    expect(pickBest([retry, first])?.data).toBe("b");
    expect(compareQuality(qualityOf(good, sumOk), qualityOf(good, sumOk))).toBe(0);
    const sumBad = { ...sumOk, deviation_pct: -12, lines_sum: 3000 };
    expect(compareQuality(qualityOf(good, sumOk), qualityOf(good, sumBad))).toBeLessThan(0);
  });
});

describe("5. Fasit og måling", () => {
  const gold = toGoldLines([
    { supplier_sku: "5301 0", description: "Mel", quantity: 10, unit: "kg", unit_price: 113, total_amount: 1130 },
    { supplier_sku: null, description: "Iste chai", quantity: 6, unit: "stk", unit_price: 573.78, total_amount: 3442.68, package_size: 1, package_unit: "l", count_per_package: 6 },
  ]);
  it("felt for felt: antall feil på iste, varenummer riktig på mel", () => {
    const read = toGoldLines([{ sku: "53010", description: "MEL", quantity: 10, unit: "kg", unit_price: 113, total_amount: 1130 },
      { sku: null, description: "Iste chai", quantity: 1, unit: "stk", unit_price: 573.78, total_amount: 3442.68, package_size: 1, package_unit: "l", count_per_package: 6 }]);
    const s = scoreGold(read, gold);
    expect(s.matched).toBe(2);
    expect(s.fields.antall).toEqual({ n: 2, ok: 1 });
    expect(s.fields.varenummer).toEqual({ n: 1, ok: 1 });
    expect(s.fields.sum.n).toBe(1); // iste koblet på beløp: summen scores ikke
  });
  it("manglende fasitlinje teller som feil", () => {
    const read = toGoldLines([{ sku: "5301 0", quantity: 10, unit: "kg", unit_price: 113, total_amount: 1130 }]);
    const c = withMissingAsErrors(scoreGold(read, gold), gold, read);
    expect(c.antall).toEqual({ n: 2, ok: 1 });
  });
  it("kandidat godkjennes bare når ingen felt er dårligere", () => {
    const cur = aggregate([{ supplier: "PALS", invoiceId: "1", status: "ok", counts: scoreGold(gold, gold).fields }]);
    const worseRead = toGoldLines([{ sku: "5301 0", quantity: 1, unit: "kg", unit_price: 113, total_amount: 1130 }, gold[1]]);
    const worse = aggregate([{ supplier: "PALS", invoiceId: "1", status: "ok", counts: scoreGold(worseRead, gold).fields }]);
    expect(verdict(cur, cur).notWorse).toBe(true);
    const v = verdict(cur, worse);
    expect(v.notWorse).toBe(false);
    expect(v.worseFields).toContain("antall");
    const failed = aggregate([{ supplier: "PALS", invoiceId: "1", status: "feil", counts: null }]);
    expect(verdict(cur, failed).notWorse).toBe(false);
  });
});
