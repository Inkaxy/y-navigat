// Utrulling 18.11.2026: den nye fakturaleseren med ALLE brytere av skal gi nøyaktig samme tekst til modellen og samme
// linjer som før. Testen kjører den ekte forsøksløkken og de ekte opplæringsmodulene som nå ligger i supabase/functions.
import { describe, expect, it } from "vitest";
import { runExtractionAttempts, type Hints, type LearningExample } from "../../supabase/functions/_shared/invoiceExtraction.ts";
import { catalogCheck, loadReadingContext, OFF_CONTEXT, readingPrompt, type ReadingDb, type RpcResult } from "../../supabase/functions/_shared/readingContext.ts";
import { READING_SETTINGS_OFF, settingsKey } from "../../supabase/functions/_shared/readingSettings.ts";

const hints: Hints = {
  expected_total_excl_vat: 1000, expected_total_incl_vat: 1150, expected_vat: 150, supplier_name: "ASKO",
  invoice_number: "9204947561", is_credit: false, known_items: [{ sku: "299727", name: "ISTE CHAI 1L" }],
};
const examples: LearningExample[] = [{ original: { quantity: 1 }, corrected: { quantity: 6 }, note: "6 flasker, ikke 1" }];
const reply = JSON.stringify({ invoice_number: "9204947561", lines: [{ description: "ISTE CHAI", sku_raw: "29 9727", quantity: 2, unit_price: 500, total_amount: 1000 }] });

async function capture(extraHint: string | null | undefined, ex: readonly LearningExample[]) {
  const texts: string[] = [];
  const opts = {
    hints, examples: ex, maxAttempts: 2, parseJson: (s: string) => JSON.parse(s),
    call: async (t: string) => { texts.push(t); return { text: reply }; },
  };
  const run = await runExtractionAttempts(extraHint === undefined ? opts : { ...opts, extraHint });
  return { texts, lines: run.best?.lines ?? [] };
}

const db = (answers: Record<string, RpcResult>): ReadingDb & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    rpc: (fn) => { calls.push(fn); return Promise.resolve(answers[fn] ?? { data: null, error: { message: "missing", code: "PGRST202" } }); },
    from: () => ({ insert: () => Promise.resolve({ error: null }) }),
  };
};

describe("Ny leser med alt av = samme lesing som før", () => {
  it("databasen svarer med alt av: bare innstillingene leses, ingen katalog/profil/eksempler hentes", async () => {
    const d = db({ rm_reading_settings: { data: { revision: 3 }, error: null } });
    const ctx = await loadReadingContext(d, "le", "sup");
    expect(ctx.available).toBe(true);
    expect(ctx.settings).toEqual(READING_SETTINGS_OFF);
    expect(d.calls).toEqual(["rm_reading_settings"]);
    expect(readingPrompt(ctx, "ASKO", "29 9727 ISTE CHAI")).toEqual({ extraHint: null, examples: null, catalogItems: 0, profileUsed: false });
  });

  it("samme tekst til modellen, ord for ord, i alle forsøk – både med alt av og uten databaseendringen", async () => {
    const before = await capture(undefined, examples); // slik leseren kalte før utrullingen
    for (const ctx of [OFF_CONTEXT, { ...OFF_CONTEXT, available: true }]) {
      const rp = readingPrompt(ctx, "ASKO", "29 9727 ISTE CHAI");
      const after = await capture(rp.extraHint, rp.examples ?? examples); // slik den patchede leseren kaller
      expect(after.texts).toEqual(before.texts);
      expect(after.lines).toEqual(before.lines);
    }
  });

  it("sidebolker: tilleggsteksten er nøyaktig sidehintet som før", () => {
    const chunkHint = "SIDEUTSNITT: side 1–4 av 9";
    const rp = readingPrompt(OFF_CONTEXT, "ASKO", null);
    // Samme uttrykk som aiRead.ts bruker etter utrullingen.
    expect([rp.extraHint, chunkHint].filter((x): x is string => !!x).join("\n\n")).toBe(chunkHint);
  });

  it("varenummer-etterkontrollen endrer ingen linjer når «Varekatalog» er av", () => {
    const lines = [{ sku: "29 9727", description: "ISTE CHAI", quantity: 2, unit_price: 500, total_amount: 1000 }];
    const out = catalogCheck({ ...OFF_CONTEXT, available: true, catalog: [{ sku_norm: "299727", sku_printed: ["29 9727"], name: "ISTE", aliases: [], package: null, base_unit: "l" }] }, lines);
    expect(out).toEqual(lines);
  });

  it("selvkontroll er av, og innstillingsnøkkelen viser det i leseloggen", () => {
    expect(READING_SETTINGS_OFF.self_check).toBe(false);
    expect(settingsKey(READING_SETTINGS_OFF)).toBe(settingsKey({ ...READING_SETTINGS_OFF }));
  });
});
