import { describe, expect, it } from "vitest";
import { buildOperations, emptySelection, loadPending, parseRun, rereadErrorText, savePending, selectionProblem, suggestPairs, type Selection } from "@/fakturaer/lib/reread";
import { rereadFixtureRow } from "@/dev/rereadFixtures";

const run = parseRun(rereadFixtureRow("ready"));
const sel = (o: Partial<Selection>): Selection => ({ ...emptySelection(), ...o });

describe("lesing på nytt – valg", () => {
  it("parser snapshot: rettet og manuelt koblet linje, signert header", () => {
    expect(run.oldLines.find((l) => l.id === "l2")?.corrected).toBe(true);
    expect(run.oldLines.find((l) => l.id === "l3")?.manuallyLinked).toBe(true);
    expect(run.invoice.issues).toHaveLength(1);
  });
  it("forslag bare ved entydig varenr./navn; ingen valg på forhånd", () => {
    const s = suggestPairs(run.candidates, run.oldLines);
    expect(s).toEqual({ "line-0": "l1", "line-1": "l2" });
    expect(buildOperations(run.candidates, {}, run.oldLines)).toEqual([]);
  });
  it("valgt linje krever felt og bekreftelse", () => {
    const c = run.candidates[0];
    expect(selectionProblem(c, sel({ target: "l1" }), run.oldLines, {})).toMatch(/minst ett felt/);
    expect(selectionProblem(c, sel({ target: "l1", fields: ["quantity"] }), run.oldLines, {})).toMatch(/Bekreft/);
    const ops = buildOperations(run.candidates, { "line-0": sel({ target: "l1", fields: ["quantity", "total_amount"], confirmed: true }) }, run.oldLines);
    expect(ops).toEqual([{ kind: "update", candidate_id: "line-0", line_id: "l1", changes: { quantity: 10, total_amount: 3125 }, confirmed_mapping: true, learn: false }]);
  });
  it("tidligere rettelse er beskyttet til overstyring med begrunnelse", () => {
    const c = run.candidates[1];
    const base = sel({ target: "l2", fields: ["description"], confirmed: true });
    expect(selectionProblem(c, base, run.oldLines, {})).toMatch(/rettet manuelt/);
    const ok = { ...base, overrideManual: true, manualReason: "Feil rettet" };
    expect(selectionProblem(c, ok, run.oldLines, {})).toBeNull();
    expect(buildOperations(run.candidates, { "line-1": ok }, run.oldLines)[0]).toMatchObject({ override_manual: true, manual_reason: "Feil rettet" });
  });
  it("identitetsendring på manuelt koblet linje krever egen bekreftelse", () => {
    const c = run.candidates[2];
    const base = sel({ target: "l3", fields: ["supplier_sku"], confirmed: true });
    expect(selectionProblem(c, base, run.oldLines, {})).toMatch(/koblet manuelt/);
    const ops = buildOperations(run.candidates, { "line-2": { ...base, confirmIdentity: true } }, run.oldLines);
    expect(ops[0]).toMatchObject({ confirm_identity_change: true });
  });
  it("ny linje krever bekreftelse og sender hele forslaget", () => {
    const c = run.candidates[3];
    expect(selectionProblem(c, sel({ target: "add" }), run.oldLines, {})).toMatch(/mangler i dag/);
    const ops = buildOperations(run.candidates, { "line-3": sel({ target: "add", confirmed: true }) }, run.oldLines);
    expect(ops[0]).toMatchObject({ kind: "add", confirmed_addition: true, changes: { description: "Frakt", total_amount: 450 } });
    expect(ops[0]).not.toHaveProperty("learn");
  });
  it("samme mållinje to ganger er uavklart", () => {
    const all = { "line-0": sel({ target: "l1", fields: ["quantity"], confirmed: true }), "line-1": sel({ target: "l1", fields: ["quantity"], confirmed: true }) };
    expect(selectionProblem(run.candidates[1], all["line-1"], run.oldLines, all)).toMatch(/annet forslag/);
  });
  it("ventende forespørsel lagres og gjenopprettes nøyaktig", () => {
    const m = new Map<string, string>();
    const store = { setItem: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, removeItem: (k: string) => void m.delete(k) };
    const ops = buildOperations(run.candidates, { "line-0": sel({ target: "l1", fields: ["quantity"], confirmed: true }) }, run.oldLines);
    savePending({ runId: run.id, operations: ops, reason: "Kontrollert" }, store);
    expect(loadPending(run.id, store)).toEqual({ runId: run.id, operations: ops, reason: "Kontrollert" });
    expect(loadPending("annen", store)).toBeNull();
  });
  it("feilkoder gir norsk tekst, aldri rå backendtekst", () => {
    expect(rereadErrorText("snapshot_endret")).toMatch(/endret siden/);
    expect(rereadErrorText('ERROR: tidligere_rettelse_beskyttet')).toMatch(/overstyres/);
    expect(rereadErrorText("relation x does not exist")).toBe("Noe gikk galt. Ingenting er endret.");
  });
});
