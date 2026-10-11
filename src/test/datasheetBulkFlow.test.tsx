// @vitest-environment jsdom
/**
 * DatabladBulk — ekte side, mocket I/O (ingen opplasting, AI, anvendelse eller sletting når ut).
 * Gjennomgang før/etter, frosset operasjon, synkron lås, kontekstvakt og usikre utfall.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

type Res = { data: unknown; error: unknown };
const ctx = { canWrite: true, legalEntityId: "A" };
const log: { kind: string; payload?: unknown }[] = [];
let applyImpl: () => Promise<Res> = async () => ({ data: { applied: true, failures: [], changes_logged: 3, follow_ups: {} }, error: null });
let linkImpl: () => Promise<Res> = async () => ({ data: null, error: null });
let pkgImpl: () => Promise<Res> = async () => ({ data: null, error: null });
let orphanRows: { id: string; file_name: string; file_path: string; supplier_name: string | null; uploaded_at: string }[] = [];
const AI = { name: "Combisur", nutrition: { fat_g: 2.5, salt_g: 1.1 }, allergens: [{ allergen: "milk", presence: "contains" }], ingredient_declaration: "hvetemel, salt", grain_classification_hint: "grovt", e_numbers: ["E300", " "], country_of_origin: "Norge", package_size_value: 20, package_size_unit: "kg" };

vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ canWrite: ctx.canWrite, legalEntityId: ctx.legalEntityId }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({
  useRawMaterials: () => ({ data: [] }),
  useRawMaterial: () => ({ data: { grain_classification: "fint" }, isLoading: false, isError: false }),
}));
vi.mock("@/ravarer/hooks/useNutrition", () => ({
  useNutrition: () => ({ data: { fat_g: 2.0, salt_g: 1.1, ingredient_declaration: "hvetemel" }, isLoading: false, isError: false }),
  useAllergens: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock("@/ravarer/editors/PackageEditor", () => ({ PackageEditor: ({ open }: { open: boolean }) => (open ? <div>Pakningsdialog åpen</div> : null) }));
vi.mock("@/ravarer/editors/RawMaterialCreateSheet", () => ({ RawMaterialCreateSheet: () => null }));
type Rc = { status: "none" | "done" | "partial" | "failed"; ok: number; total: number; failedRecipeIds: string[] };
let recomputeImpl: (id: string) => Promise<Rc> = async () => ({ status: "done", ok: 2, total: 2, failedRecipeIds: [] });
vi.mock("@/varer/lib/recomputeFanout", () => ({ recomputeRecipesDetailed: vi.fn(async (id: string) => { log.push({ kind: "recompute", payload: id }); return recomputeImpl(id); }) }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    let op = "select"; let cols = ""; let payload: unknown = null;
    const filters: unknown[][] = [];
    const c = {
      select: (s: string) => { if (op === "select") cols = s; return c; },
      insert: (p: unknown) => { op = "insert"; payload = p; return c; },
      update: (p: unknown) => { op = "update"; payload = p; return c; },
      delete: () => { op = "delete"; return c; },
      eq: (k: string, v: unknown) => { filters.push(["eq", k, v]); return c; },
      is: (k: string, v: unknown) => { filters.push(["is", k, v]); return c; },
      in: (k: string, v: unknown) => { filters.push(["in", k, v]); return c; },
      order: () => c, limit: () => c, single: () => c, maybeSingle: () => c,
      then: (ok: (v: Res) => unknown, bad?: (e: unknown) => unknown) => {
        let p: Promise<Res>;
        if (table === "datasheet_upload_batches" && op === "insert") p = Promise.resolve({ data: { id: "b1" }, error: null });
        else if (table === "datasheet_upload_batches") p = Promise.resolve({ data: null, error: null });
        else if (table === "raw_material_datasheets" && op === "update") { log.push({ kind: "link", payload: { payload, filters } }); p = linkImpl(); }
        else if (table === "raw_material_datasheets" && op === "delete") { log.push({ kind: "delete", payload: filters }); p = Promise.resolve({ data: [], error: null }); }
        else if (table === "raw_material_datasheets" && cols.includes("ai_extracted")) p = Promise.resolve({ data: { ai_extracted: AI }, error: null });
        else if (table === "raw_material_datasheets") p = Promise.resolve({ data: orphanRows, error: null });
        else if (table === "raw_materials") { log.push({ kind: "pkg-read" }); p = pkgImpl(); }
        else p = Promise.resolve({ data: null, error: null });
        return p.then(ok, bad);
      },
    };
    return c;
  };
  const invoke = vi.fn(async (name: string, opts: { body: unknown }) => {
    log.push({ kind: name, payload: opts.body });
    if (name === "extract-datasheet") return { data: { datasheet_id: "ds1" }, error: null };
    if (name === "match-datasheet-to-raw-material") return { data: { candidates: [{ id: "rmA", name: "Hvetemel", sku: "1", score: 0.95 }] }, error: null };
    if (name === "apply-datasheet-update") return applyImpl();
    return { data: null, error: null };
  });
  return { supabase: {
    from: chain,
    functions: { invoke },
    storage: { from: () => ({ upload: vi.fn(async () => { log.push({ kind: "upload" }); return { error: null }; }), createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x" }, error: null })) }) },
    auth: { getUser: async () => ({ data: { user: null } }) },
  } };
});

import DatabladBulk from "@/ravarer/pages/DatabladBulk";

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const tree = (client: QueryClient) => <QueryClientProvider client={client}><MemoryRouter><DatabladBulk /></MemoryRouter></QueryClientProvider>;
const count = (k: string) => log.filter((l) => l.kind === k).length;
function deferred() {
  let resolve!: (v: Res) => void;
  const promise = new Promise<Res>((r) => { resolve = r; });
  return { promise, resolve };
}

async function uploadOne(client = qc()) {
  const utils = render(tree(client));
  const input = utils.container.querySelector('input[type="file"]');
  if (!input) throw new Error("mangler filvelger");
  await act(async () => { fireEvent.change(input, { target: { files: [new File(["x"], "combi.pdf", { type: "application/pdf" })] } }); });
  await screen.findByText(/AI leste:/);
  return { ...utils, client };
}

beforeEach(() => {
  ctx.canWrite = true; ctx.legalEntityId = "A"; log.length = 0; orphanRows = [];
  applyImpl = async () => ({ data: { applied: true, failures: [], changes_logged: 3, follow_ups: {} }, error: null });
  linkImpl = async () => ({ data: null, error: null });
  pkgImpl = async () => ({ data: null, error: null });
  recomputeImpl = async () => ({ status: "done", ok: 2, total: 2, failedRecipeIds: [] });
});

describe("gjennomgang før anvend", () => {
  it("viser dagens og nye verdier (inkl. brødskala), og sender NØYAKTIG valgte felt og næringsfelt", async () => {
    await uploadOne();
    expect(screen.getByText(/brødskala: grovt/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Koble og anvend/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getByText("fint")).toBeInTheDocument();   // brødskala i dag
    expect(within(dlg).getByText("grovt")).toBeInTheDocument();  // fra databladet
    expect(within(dlg).getByText("hvetemel")).toBeInTheDocument(); // deklarasjon i dag
    // Fravelg salt og deklarasjon.
    fireEvent.click(within(dlg).getByRole("checkbox", { name: /Bruk Salt fra databladet/i }));
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Bruk deklarasjon" }));
    fireEvent.click(within(dlg).getByRole("button", { name: /Anvend valgte/ }));
    await waitFor(() => expect(count("apply-datasheet-update")).toBe(1));
    const body = log.find((l) => l.kind === "apply-datasheet-update")?.payload as Record<string, unknown>;
    expect(body.accepted_fields).toEqual(["nutrition", "allergens", "grain"]);
    expect(body.accepted_nutrition_fields).toEqual(["fat_g"]);
    expect(body).not.toHaveProperty("package");
    expect(await screen.findByText(/Anvendt på Hvetemel/)).toBeInTheDocument();
  });

  it("«Bekreft alle» krever gjennomgang: ikke-gjennomgått fil gir 0 skrivinger", async () => {
    await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Bekreft alle gjennomgåtte/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(count("link") + count("apply-datasheet-update")).toBe(0);
  });

  it("samlet bekreftelse sender den frosne gjennomgangen", async () => {
    await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Bruk brødskala" }));
    fireEvent.click(within(dlg).getByRole("button", { name: "Merk som gjennomgått" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Bekreft alle gjennomgåtte/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Anvend" }));
    await waitFor(() => expect(count("apply-datasheet-update")).toBe(1));
    const body = log.find((l) => l.kind === "apply-datasheet-update")?.payload as Record<string, unknown>;
    expect(body.accepted_fields).toEqual(["nutrition", "allergens", "ingredient_declaration"]);
  });
});

describe("koblede næringsfelt", () => {
  it("E-numre og opprinnelsesland vises som en del av næringsgruppen, med ærlig gruppesemantikk", async () => {
    await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    const dlg = await screen.findByRole("dialog");
    const box = within(dlg).getByTestId("coupled-nutrition");
    expect(within(box).getByText("E300")).toBeInTheDocument();
    expect(within(box).getByText("Norge")).toBeInTheDocument();
    expect(within(box).getByText(/uansett hvilke enkeltfelt/)).toBeInTheDocument();
    // Fravalg av hele næringsgruppen sender ikke næring (og dermed ikke de koblede feltene).
    fireEvent.click(within(dlg).getByRole("checkbox", { name: "Bruk næring" }));
    fireEvent.click(within(dlg).getByRole("button", { name: /Anvend valgte/ }));
    await waitFor(() => expect(count("apply-datasheet-update")).toBe(1));
    const body = log.find((l) => l.kind === "apply-datasheet-update")?.payload as Record<string, unknown>;
    expect(body.accepted_fields).not.toContain("nutrition");
    expect(body.accepted_nutrition_fields).toEqual([]);
  });
});

describe("etterberegning av oppskrifter", () => {
  const applyNow = async () => {
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ }));
  };
  it("feilet etterberegning vises separat; «prøv igjen» kjører bare etterberegningen", async () => {
    recomputeImpl = async () => ({ status: "failed", ok: 0, total: 3, failedRecipeIds: ["r1", "r2", "r3"] });
    await uploadOne();
    await applyNow();
    expect(await screen.findByText(/Anvendt på Hvetemel/)).toBeInTheDocument();
    expect(await screen.findByText(/3 av 3 oppskrifter ble ikke beregnet på nytt/)).toBeInTheDocument();
    recomputeImpl = async () => ({ status: "done", ok: 3, total: 3, failedRecipeIds: [] });
    fireEvent.click(screen.getByRole("button", { name: "Beregn oppskrifter på nytt" }));
    expect(await screen.findByText(/3 oppskrifter beregnet på nytt/)).toBeInTheDocument();
    expect(count("apply-datasheet-update")).toBe(1);
    expect(count("link")).toBe(1);
    expect(log.filter((l) => l.kind === "recompute").map((l) => l.payload)).toEqual(["rmA", "rmA"]);
  });
  it("selskapsbytte etter bekreftet lagring: etterberegningen fullføres for frosset råvare, feil varsles", async () => {
    const { toast } = await import("sonner");
    let finish!: (r: Rc) => void;
    recomputeImpl = () => new Promise<Rc>((r) => { finish = r; });
    const { rerender, client } = await uploadOne();
    await applyNow();
    await waitFor(() => expect(count("recompute")).toBe(1));
    ctx.legalEntityId = "B"; ctx.canWrite = false;
    rerender(tree(client));
    await act(async () => { finish({ status: "failed", ok: 0, total: 1, failedRecipeIds: ["r1"] }); });
    expect(log.find((l) => l.kind === "recompute")?.payload).toBe("rmA");
    expect(toast.warning).toHaveBeenCalledWith(expect.stringMatching(/ble ikke beregnet på nytt/));
    expect(count("apply-datasheet-update")).toBe(1);
  });
  it("ukjent anvendelsesutfall starter ingen etterberegning", async () => {
    applyImpl = async () => ({ data: {}, error: null });
    await uploadOne();
    await applyNow();
    expect(await screen.findByText(/Ukjent utfall/)).toBeInTheDocument();
    expect(count("recompute")).toBe(0);
  });
});

describe("utfall", () => {
  it.each([
    ["tom respons {}", { data: {}, error: null }, /Ukjent utfall/],
    ["applied:false uten feil", { data: { applied: false, failures: [] }, error: null }, /Ukjent utfall/],
    ["207 med feil", { data: { applied: false, failures: ["brødskala: x"], follow_ups: {} }, error: null }, /Delvis anvendt på/],
    ["nettverksfeil", { data: null, error: new Error("Failed to fetch") }, /Ukjent utfall/],
  ])("%s vises aldri som «Anvendt»", async (_n, res, expected) => {
    applyImpl = async () => res;
    await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ }));
    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(/^Anvendt på/)).toBeNull();
    // Gjennomgangen må gjøres på nytt før et nytt forsøk.
    expect(screen.getByRole("button", { name: /Gjennomgå på nytt/ })).toBeInTheDocument();
  });
});

describe("lås og kontekst", () => {
  it("to trykk før første svar sender bare én kobling og én anvendelse", async () => {
    const link = deferred();
    linkImpl = () => link.promise;
    await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    const btn = within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ });
    // Samme gjengivelse: kall knappens handler to ganger før React rekker å deaktivere den.
    const propsKey = Object.keys(btn).find((k) => k.startsWith("__reactProps"));
    if (!propsKey) throw new Error("fant ikke React-props");
    const onClick = (btn as unknown as Record<string, { onClick: () => void }>)[propsKey].onClick;
    await act(async () => { onClick(); onClick(); });
    await act(async () => { link.resolve({ data: null, error: null }); });
    await waitFor(() => expect(count("apply-datasheet-update")).toBe(1));
    expect(count("link")).toBe(1);
  });

  it("selskapsbytte mens koblingen venter: ingen anvendelse for den foreldede operasjonen, utfallet beholdes synlig", async () => {
    const link = deferred();
    linkImpl = () => link.promise;
    const { rerender, client } = await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ }));
    await waitFor(() => expect(count("link")).toBe(1));
    ctx.legalEntityId = "B"; ctx.canWrite = false;
    rerender(tree(client));
    await act(async () => { link.resolve({ data: null, error: null }); });
    expect(count("apply-datasheet-update")).toBe(0);
    expect(screen.getByText(/Usikre utfall fra forrige økt/)).toBeInTheDocument();
  });

  it("tapt skrivetilgang mens koblingen venter stopper anvendelsen", async () => {
    const link = deferred();
    linkImpl = () => link.promise;
    const { rerender, client } = await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ }));
    await waitFor(() => expect(count("link")).toBe(1));
    ctx.canWrite = false;
    rerender(tree(client));
    await act(async () => { link.resolve({ data: null, error: null }); });
    expect(count("apply-datasheet-update")).toBe(0);
  });

  it("selskapsbytte under opplasting/uttrekk: ingen videre AI eller matching", async () => {
    const client = qc();
    const utils = render(tree(client));
    const input = utils.container.querySelector('input[type="file"]');
    if (!input) throw new Error("mangler filvelger");
    // Bytt selskap i samme øyeblikk som opplastingen starter.
    await act(async () => {
      fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
      ctx.legalEntityId = "B";
      utils.rerender(tree(client));
    });
    await act(async () => { await Promise.resolve(); });
    expect(count("extract-datasheet")).toBe(0);
    expect(count("match-datasheet-to-raw-material")).toBe(0);
  });

  it("sen pakningsoppslag etter selskapsbytte åpner ingen dialog", async () => {
    applyImpl = async () => ({ data: { applied: true, failures: [], follow_ups: { package_suggestion: { suggested: { size: 20, unit: "kg" } } } }, error: null });
    const pkg = deferred();
    pkgImpl = () => pkg.promise;
    const { rerender, client } = await uploadOne();
    fireEvent.click(screen.getByRole("button", { name: /Gjennomgå og anvend/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: /Anvend valgte/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Bekreft pakning/ }));
    await waitFor(() => expect(count("pkg-read")).toBe(1));
    ctx.legalEntityId = "B";
    rerender(tree(client));
    await act(async () => { pkg.resolve({ data: { id: "rmA", legal_entity_id: "A", name: "Hvetemel", base_unit: "kg", category: null, current_cost_price: null }, error: null }); });
    expect(screen.queryByText("Pakningsdialog åpen")).toBeNull();
  });
});

describe("rydding — bundet til selskap og tilgang", () => {
  it("åpen bekreftelse lukkes ved selskapsbytte; ingen sletting sendes med nytt selskap", async () => {
    orphanRows = [{ id: "orphan-A", file_name: "gammel.pdf", file_path: "A/x.pdf", supplier_name: null, uploaded_at: "2026-09-01" }];
    const client = qc();
    const { rerender } = render(tree(client));
    fireEvent.click(await screen.findByRole("button", { name: "Slett gammel.pdf" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
    ctx.legalEntityId = "B"; ctx.canWrite = false;
    rerender(tree(client));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(count("delete")).toBe(0);
  });

  it("dobbelttrykk på Slett sender én betinget sletting med frosset selskap", async () => {
    orphanRows = [{ id: "orphan-A", file_name: "gammel.pdf", file_path: "A/x.pdf", supplier_name: null, uploaded_at: "2026-09-01" }];
    render(tree(qc()));
    fireEvent.click(await screen.findByRole("button", { name: "Slett gammel.pdf" }));
    const confirm = within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Slett" });
    const k = Object.keys(confirm).find((x) => x.startsWith("__reactProps"));
    if (!k) throw new Error("fant ikke React-props");
    const handler = (confirm as unknown as Record<string, { onClick: (e: { preventDefault: () => void }) => void }>)[k].onClick;
    await act(async () => { handler({ preventDefault: () => undefined }); handler({ preventDefault: () => undefined }); });
    await waitFor(() => expect(count("delete")).toBe(1));
    expect(log.find((l) => l.kind === "delete")?.payload).toEqual(expect.arrayContaining([["in", "id", ["orphan-A"]], ["eq", "legal_entity_id", "A"], ["is", "raw_material_id", null]]));
  });

  it("mobilknapper har fysisk minstehøyde 44 CSS-px (ikke rem)", async () => {
    orphanRows = [{ id: "orphan-A", file_name: "gammel.pdf", file_path: "A/x.pdf", supplier_name: null, uploaded_at: "2026-09-01" }];
    render(tree(qc()));
    for (const name of ["Åpne gammel.pdf", "Slett gammel.pdf", "Slett alle (1)"]) {
      expect((await screen.findByRole("button", { name })).className).toContain("min-h-[44px]");
    }
  });
});
