// @vitest-environment jsdom
/** Fase 5C: faktiske innstillingskomponenter med mocket I/O. Bare syntetiske verdier; ingen ekte nøkler eller skriving. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[] | null>,
  fail: new Set<string>(),
  writes: [] as { table: string; op: string; payload?: unknown }[],
  writeFail: new Set<string>(),
  invoke: [] as { fn: string; body: unknown }[],
  invokeImpl: (async () => ({ data: null, error: null })) as (fn: string, body: unknown) => Promise<{ data: unknown; error: unknown }>,
  cap: 1000,
  authGate: null as null | Promise<void>,
  access: { canWrite: true, accessLevel: "admin" as string },
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    let op = "select";
    let payload: unknown;
    const result = () => {
      if (op !== "select") {
        db.writes.push({ table, op, payload });
        return Promise.resolve({ data: null, error: db.writeFail.has(`${table}:${op}`) ? { message: "nekt", code: "42501" } : null });
      }
      if (db.fail.has(table)) return Promise.resolve({ data: null, error: { message: "nede" }, count: null });
      return Promise.resolve({ data: db.tables[table] ?? [], error: null, count: (db.tables[table] ?? []).length });
    };
    for (const m of ["select", "eq", "not", "order", "in", "limit"]) b[m] = () => b;
    for (const m of ["upsert", "insert", "update", "delete"]) b[m] = (p?: unknown) => { op = m; payload = p; return b; };
    b.maybeSingle = () => (db.fail.has(table) ? Promise.resolve({ data: null, error: { message: "nede" } }) : Promise.resolve({ data: (db.tables[table] ?? [])[0] ?? null, error: null }));
    b.range = (from: number, to: number) => {
      if (db.fail.has(table)) return Promise.resolve({ data: null, error: { message: "nede" }, count: null });
      const all = db.tables[table] ?? [];
      return Promise.resolve({ data: all.slice(from, Math.min(to + 1, from + db.cap)), error: null, count: all.length });
    };
    b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
    return b;
  };
  return {
    supabase: {
      from: (t: string) => builder(t),
      auth: { getUser: async () => { if (db.authGate) await db.authGate; return { data: { user: { id: "U" } } }; } },
      rpc: async () => ({ data: [{ has_consumer_token: false, has_employee_token: true }], error: null }),
      functions: { invoke: (fn: string, opts: { body: unknown }) => { db.invoke.push({ fn, body: opts.body }); return db.invokeImpl(fn, opts.body); } },
    },
  };
});
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: "LE", ...db.access, user: null }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/lib/errorLog", () => ({ createErrorId: () => "E1", logAppError: () => undefined }));
vi.mock("@/ravarer/components/RavarerHeaderBanner", () => ({ RavarerHeaderBanner: () => null }));
vi.mock("@/fakturaer/components/StartPriceCandidatesCard", () => ({ StartPriceCandidatesCard: () => <div>startpriskandidater</div> }));
vi.mock("@/ravarer/components/RematchAllDialog", () => ({ RematchAllDialog: () => null }));
vi.mock("@/fakturaer/hooks/useRematchStatus", () => ({ useRematchStatus: () => ({ data: undefined }) }));
vi.mock("@/fakturaer/hooks/useFakturaerLegalEntities", () => ({ useFakturaerLegalEntities: () => ({ data: [{ id: "LE", name: "Bakeri", status: "active" }], isLoading: false }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() }) }));

import MatchToleranserPage from "@/ravarer/pages/innstillinger/MatchToleranser";
import KategorierSettingsPage from "@/ravarer/pages/innstillinger/KategorierSettings";
import TripletexSettings from "@/ravarer/pages/innstillinger/TripletexSettings";
import AiServicesSettings from "@/ravarer/pages/innstillinger/AiServicesSettings";
import { summarizeCategoryUsage } from "@/ravarer/lib/categoryUsage";
import { draftFrom, planIsEmpty, planSave } from "@/ravarer/lib/priceSettingsDraft";
import { isTripletexSaved, tripletexSaveBlock, tripletexSavePayload } from "@/ravarer/lib/tripletexSettings";
import type { TripletexCredentialRow } from "@/ravarer/hooks/useTripletex";
import type { MatchSettings } from "@/fakturaer/hooks/useMatchTolerances";

const settingsRow = {
  default_price_tolerance_pct: 3, fuzzy_match_threshold: 0.5, fuzzy_auto_match_threshold: 0.85, fuzzy_auto_match_dominance_threshold: 0.65,
  auto_approve_within_tolerance: false, auto_reconcile_clean_imports: true, use_first_confirmed_price_as_start: false, auto_check_against_start_price: false,
  auto_check_against_last_purchase: false, start_price_tolerance_pct: 2, start_price_max_impact_nok: null, price_min_impact_nok: 50, price_hard_cap_pct: 15,
  auto_accept_first_price: true, auto_confirm_inferred_package: true, auto_exclude_line_kinds: ["frakt", "gebyr"],
};
const qcNew = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
let qc = qcNew();
const Wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;

beforeEach(() => {
  qc = qcNew();
  db.tables = {
    invoice_match_settings: [settingsRow],
    invoice_match_category_tolerances: [{ id: "C1", category: "Mel og korn", price_tolerance_pct: 4 }],
    raw_materials: [{ id: "r1", category: "Mel og korn", categories: ["Mel og korn", "Drikke"], is_active: true }],
  };
  db.fail = new Set(); db.writes = []; db.writeFail = new Set(); db.invoke = []; db.cap = 1000; db.authGate = null;
  db.access = { canWrite: true, accessLevel: "admin" };
  db.invokeImpl = async () => ({ data: null, error: null });
});

const saveBtn = () => screen.getByRole("button", { name: "Lagre endringer" });

describe("Priskontroll — én kladd", () => {
  it("felt, brytere, linjetyper og kategoriendringer skriver ingenting før Lagre; Avbryt gjenoppretter uten kall", async () => {
    render(<MatchToleranserPage />, { wrapper: Wrap });
    const tol = await screen.findByLabelText("Toleranse (%)");
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(tol, { target: { value: "4" } });
    fireEvent.click(screen.getByRole("switch", { name: "Godkjenn automatisk innenfor toleranse" }));
    fireEvent.click(screen.getByRole("button", { name: "Rabatt" }));
    fireEvent.click(screen.getByRole("button", { name: "Fjern toleranse for Mel og korn" }));
    expect(screen.getByText("Ulagrede endringer")).toBeTruthy();
    expect(db.writes).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Avbryt" }));
    expect((screen.getByLabelText("Toleranse (%)") as HTMLInputElement).value).toBe("3");
    expect(screen.getByText("Mel og korn")).toBeTruthy();
    expect(db.writes).toHaveLength(0);
  });

  it("feilet lesing gir ingen skrivbar standardkladd, bare «Prøv igjen»", async () => {
    db.fail.add("invoice_match_settings");
    render(<MatchToleranserPage />, { wrapper: Wrap });
    expect(await screen.findByRole("button", { name: /prøv igjen/i })).toBeTruthy();
    expect(screen.queryByLabelText("Toleranse (%)")).toBeNull();
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
  });

  it("vellykket lest uten innstillinger: standardverdier vises, ingenting lagres uendret", async () => {
    db.tables.invoice_match_settings = [];
    render(<MatchToleranserPage />, { wrapper: Wrap });
    expect(((await screen.findByLabelText("Toleranse (%)")) as HTMLInputElement).value).toBe("3");
    expect(screen.getByRole("note").textContent).toMatch(/ingen lagrede innstillinger/);
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
  });

  it("bakgrunnslesing overskriver ikke påbegynt kladd", async () => {
    render(<MatchToleranserPage />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("Toleranse (%)"), { target: { value: "7" } });
    db.tables.invoice_match_settings = [{ ...settingsRow, default_price_tolerance_pct: 9 }];
    await act(async () => { await qc.refetchQueries(); });
    expect((screen.getByLabelText("Toleranse (%)") as HTMLInputElement).value).toBe("7");
  });

  it("avvist lagring beholder kladden og viser feilet steg", async () => {
    db.writeFail.add("invoice_match_settings:upsert");
    render(<MatchToleranserPage />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("Toleranse (%)"), { target: { value: "4" } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText("Ingenting ble bekreftet lagret.")).toBeTruthy();
    expect((screen.getByLabelText("Toleranse (%)") as HTMLInputElement).value).toBe("4");
  });

  it("delvis lagring rapporteres per steg, aldri «alt lagret»", async () => {
    db.writeFail.add("invoice_match_category_tolerances:delete");
    render(<MatchToleranserPage />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("Toleranse (%)"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Fjern toleranse for Mel og korn" }));
    fireEvent.click(saveBtn());
    expect(await screen.findByText("Bare noe ble lagret.")).toBeTruthy();
    expect(screen.queryByText("Alle endringer er lagret.")).toBeNull();
    expect(screen.getByText(/Feilet eller ukjent: Fjern kategoritoleranse/)).toBeTruthy();
  });

  it("uten godkjenner-/admintilgang: ingen lagringslinje og låste felt", async () => {
    db.access = { canWrite: true, accessLevel: "write" };
    render(<MatchToleranserPage />, { wrapper: Wrap });
    expect(((await screen.findByLabelText("Toleranse (%)")) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
  });

  it("uendret rundtur gir tom plan; null/0/false bevares", () => {
    const s = { ...settingsRow, fuzzy_match_threshold: null } as unknown;
    const ms = s as MatchSettings;
    const rows = [{ id: "C1", category: "Mel og korn", price_tolerance_pct: 4 }];
    const plan = planSave(ms, rows, draftFrom(ms, rows));
    expect(plan && planIsEmpty(plan)).toBe(true);
  });
});

describe("Kategorier", () => {
  it("dedupliserer category + categories, teller uten kategori separat", () => {
    const u = summarizeCategoryUsage([
      { id: "1", category: "Mel og korn", categories: ["Mel og korn", "Drikke", "Drikke"], is_active: true },
      { id: "2", category: " Drikke ", categories: null, is_active: false },
      { id: "3", category: null, categories: [], is_active: true },
      { id: "4", category: "", categories: ["  "], is_active: true },
    ]);
    expect(u.categories).toEqual([{ category: "Drikke", active: 1, inactive: 1 }, { category: "Mel og korn", active: 1, inactive: 0 }]);
    expect(u.uncategorized).toEqual({ active: 2, inactive: 0 });
  });
  it("komplett over gammel grense og servertak; lenker til varefilteret; ingen tom kategorirad", async () => {
    db.cap = 200;
    db.tables.raw_materials = Array.from({ length: 2101 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}`, category: i === 2100 ? null : "Drikke", categories: null, is_active: true }));
    render(<KategorierSettingsPage />, { wrapper: Wrap });
    const link = await screen.findByRole("link", { name: "Drikke" });
    expect(link.getAttribute("href")).toContain("kat=Drikke");
    const row = link.closest("tr")!;
    expect(within(row).getByText("2100")).toBeTruthy();
    expect(screen.getByText("Uten kategori")).toBeTruthy();
  });
});

describe("Tripletex", () => {
  const cred = (p: Partial<TripletexCredentialRow> = {}): TripletexCredentialRow => ({
    legal_entity_id: "LE", mode: "jwt", has_consumer_token: false, has_employee_token: true, sync_enabled: true, sync_frequency_minutes: 240,
    last_synced_at: null, last_sync_status: null, last_sync_error: null, last_supplier_sync_at: null, last_invoice_synced_date: null, initial_import_done: null, ...p,
  });
  it("samme modus uten ny nøkkel beholder; modusbytte krever ny nøkkel; automatikk sendes alltid", () => {
    expect(tripletexSaveBlock(cred(), { mode: "jwt", syncEnabled: false, frequency: 240 }, { jwt: "", consumer: "", employee: "" })).toBeNull();
    expect(tripletexSaveBlock(cred(), { mode: "private", syncEnabled: true, frequency: 240 }, { jwt: "", consumer: "", employee: "" })).toMatch(/bytte av modus/);
    expect(tripletexSaveBlock(cred({ has_consumer_token: null, mode: "standard" }), { mode: "standard", syncEnabled: true, frequency: 240 }, { jwt: "", consumer: "", employee: "x" })).toMatch(/kunne ikke lese/);
    const p = tripletexSavePayload("LE", { mode: "jwt", syncEnabled: true, frequency: 240 }, { jwt: "  ", consumer: "", employee: "" });
    expect(p).toMatchObject({ sync_enabled: true, sync_frequency_minutes: 240, jwt_token: undefined });
  });
  it("bare { ok: true } er lagret", () => {
    expect(isTripletexSaved({ ok: true })).toBe(true);
    for (const v of [null, {}, { ok: "true" }, { ok: true, error: "x" }]) expect(isTripletexSaved(v)).toBe(false);
  });
  it("nøkkel v2 skrevet under lagring overlever suksess for v1", async () => {
    db.tables.tripletex_credentials = [{ legal_entity_id: "LE", mode: "jwt", sync_enabled: true, sync_frequency_minutes: 240, last_synced_at: null, last_sync_status: null, last_sync_error: null, last_supplier_sync_at: null, last_invoice_synced_date: null, initial_import_done: true }];
    db.tables.tripletex_sync_log = [];
    let release!: () => void;
    db.invokeImpl = (fn) => (fn === "tripletex-save-credentials" ? new Promise((r) => { release = () => r({ data: { ok: true }, error: null }); }) : Promise.resolve({ data: null, error: null }));
    render(<TripletexSettings />, { wrapper: Wrap });
    const key = await screen.findByLabelText("API-nøkkel");
    fireEvent.change(key, { target: { value: "syntetisk-v1" } });
    fireEvent.click(saveBtn());
    await waitFor(() => expect(db.invoke.some((c) => c.fn === "tripletex-save-credentials")).toBe(true));
    fireEvent.change(key, { target: { value: "syntetisk-v2" } });
    await act(async () => { release(); });
    await waitFor(() => expect(screen.getByText(/Konfigurasjonen er lagret/)).toBeTruthy());
    expect((screen.getByLabelText("API-nøkkel") as HTMLInputElement).value).toBe("syntetisk-v2");
    const sent = db.invoke.find((c) => c.fn === "tripletex-save-credentials")!.body;
    expect(sent).toMatchObject({ jwt_token: "syntetisk-v1", sync_enabled: true, sync_frequency_minutes: 240 });
    expect(db.invoke.some((c) => c.fn === "tripletex-test-connection")).toBe(false);
  });
  it("tomt svar er ukjent utfall og beholder nøkkelfeltet", async () => {
    db.tables.tripletex_credentials = [{ legal_entity_id: "LE", mode: "jwt", sync_enabled: false, sync_frequency_minutes: 60, last_synced_at: null, last_sync_status: null, last_sync_error: null, last_supplier_sync_at: null, last_invoice_synced_date: null, initial_import_done: true }];
    db.tables.tripletex_sync_log = [];
    db.invokeImpl = async () => ({ data: {}, error: null });
    render(<TripletexSettings />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("API-nøkkel"), { target: { value: "syntetisk" } });
    fireEvent.click(saveBtn());
    expect(await screen.findByText(/Utfallet av lagringen er/)).toBeTruthy();
    expect((screen.getByLabelText("API-nøkkel") as HTMLInputElement).value).toBe("syntetisk");
  });
});

describe("AI-tjenester", () => {
  const cfg = { id: "11111111-1111-4111-8111-111111111111", provider: "openai", model: "gpt-5-egen", max_tokens: 0, temperature: 0, is_active: true, purpose: "invoice_extraction", azure_endpoint: null, azure_deployment: null, created_at: "", updated_at: "" };
  const setup = () => {
    db.invokeImpl = async (fn, body) => {
      if (fn === "ai-config" && (body as { action: string }).action === "list") return { data: { configs: [cfg] }, error: null };
      if (fn === "ai-config" && (body as { action: string }).action === "usage_summary") return { data: { entries: [] }, error: null };
      if (fn === "ai-config" && (body as { action: string }).action === "save") return { data: {}, error: null };
      return { data: { ok: true, sample_response: "ok" }, error: null };
    };
  };
  it("lagret modell utenfor listen beholdes; null-grenser bevares; lagring krever nøkkel", async () => {
    setup();
    render(<AiServicesSettings />, { wrapper: Wrap });
    await screen.findByText(/gpt-5-egen \(lagret\)/, { selector: "span" });
    expect((screen.getByLabelText(/Maks antall tokens/) as HTMLInputElement).value).toBe("0");
    fireEvent.change(screen.getByLabelText(/Maks antall tokens/), { target: { value: "3000" } });
    expect(screen.getByText(/står ikke i godkjent modelliste/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Lagre modell og grenser" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("modell/grenser uten ny nøkkel: update_settings med eksakt revisjon, ingen nøkkel/provider/endepunkt", async () => {
    const rev = "2026-10-14T08:00:00.123456+00:00";
    setup();
    const prev = db.invokeImpl!;
    db.invokeImpl = async (fn, body) => {
      if (fn === "ai-config" && (body as { action: string }).action === "list") return { data: { configs: [{ ...cfg, model: "gpt-4o", max_tokens: 2000, updated_at: rev }] }, error: null };
      if (fn === "ai-config" && (body as { action: string }).action === "update_settings") return { data: { config: { id: cfg.id } }, error: null };
      return prev(fn, body);
    };
    render(<AiServicesSettings />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText(/Maks antall tokens/), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Lagre modell og grenser" }));
    await waitFor(() => expect(db.invoke.some((c) => (c.body as { action?: string }).action === "update_settings")).toBe(true));
    const body = db.invoke.find((c) => (c.body as { action?: string }).action === "update_settings")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ id: cfg.id, provider: "openai", purpose: "invoice_extraction", expected_updated_at: rev, model: "gpt-4o", max_tokens: 3000 });
    expect("api_key" in body || "azure_endpoint" in body).toBe(false);
    expect(db.invoke.some((c) => (c.body as { action?: string }).action === "save")).toBe(false);
  });
  it("test uten ny nøkkel sender nøyaktig lagret konfigurasjon og lagrer ingenting", async () => {
    setup();
    render(<AiServicesSettings />, { wrapper: Wrap });
    fireEvent.click(await screen.findByRole("button", { name: "Test lagret konfigurasjon" }));
    await waitFor(() => expect(db.invoke.some((c) => c.fn === "ai-config-test")).toBe(true));
    const body = db.invoke.find((c) => c.fn === "ai-config-test")!.body as Record<string, unknown>;
    expect(body).toMatchObject({ model: "gpt-5-egen", config_id: cfg.id });
    expect("api_key" in body || "provider" in body || "azure_endpoint" in body).toBe(false);
    expect(db.invoke.some((c) => (c.body as { action?: string }).action === "save")).toBe(false);
  });
  it("lagring med uventet svar er ukjent/delvis, nøkkel beholdes, ingen automatisk nytt forsøk", async () => {
    setup();
    render(<AiServicesSettings />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("API-nøkkel"), { target: { value: "syntetisk-nokkel" } });
    fireEvent.change(screen.getByLabelText(/Maks antall tokens/), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Erstatt konfigurasjon" }));
    expect(await screen.findByText(/Utfallet av lagringen er/)).toBeTruthy();
    expect((screen.getByLabelText("API-nøkkel") as HTMLInputElement).value).toBe("syntetisk-nokkel");
    expect(db.invoke.filter((c) => (c.body as { action?: string }).action === "save")).toHaveLength(1);
  });
  it("feilet liste vises som feil, ikke som «ikke konfigurert»", async () => {
    db.invokeImpl = async () => ({ data: null, error: new Error("nede") });
    render(<AiServicesSettings />, { wrapper: Wrap });
    expect((await screen.findAllByRole("button", { name: /prøv igjen/i })).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Ikke konfigurert/)).toBeNull();
  });
});

describe("5C reparasjon", () => {
  const credRow = { legal_entity_id: "LE", mode: "jwt", sync_enabled: true, sync_frequency_minutes: 240, last_synced_at: null, last_sync_status: null, last_sync_error: null, last_supplier_sync_at: null, last_invoice_synced_date: null, initial_import_done: true };

  it("P1: avmontering mens lagring venter på innlogging starter ingen nye skrivinger", async () => {
    let releaseAuth!: () => void;
    db.authGate = new Promise((r) => { releaseAuth = r; });
    const view = render(<MatchToleranserPage />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("Toleranse (%)"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Fjern toleranse for Mel og korn" }));
    fireEvent.click(saveBtn());
    view.unmount();
    await act(async () => { releaseAuth(); await new Promise((r) => setTimeout(r, 10)); });
    expect(db.writes).toHaveLength(0);
  });

  it("P2: kategoritoleranser hentes komplett forbi servertaket (201 rader, tak 200)", async () => {
    db.cap = 200;
    db.tables.invoice_match_category_tolerances = Array.from({ length: 201 }, (_, i) => ({ id: `C${String(i).padStart(3, "0")}`, category: `Kat ${String(i).padStart(3, "0")}`, price_tolerance_pct: 4 }));
    render(<MatchToleranserPage />, { wrapper: Wrap });
    await screen.findByLabelText("Toleranse (%)");
    expect(await screen.findByRole("button", { name: "Fjern toleranse for Kat 200" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Fjern toleranse for Kat / })).toHaveLength(201);
  });

  it("P2: feilet kategorilesing gir feil, ikke et avkortet grunnlag", async () => {
    db.fail.add("invoice_match_category_tolerances");
    render(<MatchToleranserPage />, { wrapper: Wrap });
    expect(await screen.findByRole("button", { name: /prøv igjen/i })).toBeTruthy();
    expect(screen.queryByTestId("settings-save-bar")).toBeNull();
  });

  it("AI: ukjent utfall holder lagring sperret til ny lesing lykkes; feilet lesing holder sperren, ingen andre lagring", async () => {
    const cfg = { id: "11111111-1111-4111-8111-111111111111", provider: "openai", model: "gpt-4o", max_tokens: 2000, temperature: 0.1, is_active: true, purpose: "invoice_extraction", azure_endpoint: null, azure_deployment: null, created_at: "", updated_at: "" };
    let listGate: null | Promise<void> = null; let listFail = false;
    db.invokeImpl = async (fn, body) => {
      const a = (body as { action?: string }).action;
      if (a === "list") { if (listGate) await listGate; return listFail ? { data: null, error: new Error("nede") } : { data: { configs: [cfg] }, error: null }; }
      if (a === "usage_summary") return { data: { entries: [] }, error: null };
      if (a === "save") return { data: null, error: new Error("nett") };
      return { data: null, error: null };
    };
    render(<AiServicesSettings />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("API-nøkkel"), { target: { value: "syntetisk" } });
    let releaseList!: () => void;
    listGate = new Promise((r) => { releaseList = r; }); listFail = true;
    const btn = () => screen.getByRole("button", { name: "Erstatt konfigurasjon" }) as HTMLButtonElement;
    fireEvent.click(btn());
    expect((await screen.findAllByText(/Leser gjeldende konfigurasjon/)).length).toBeGreaterThan(0);
    expect(btn().disabled).toBe(true);
    fireEvent.click(btn());
    await act(async () => { releaseList(); });
    expect(await screen.findByRole("button", { name: "Les konfigurasjonen på nytt" })).toBeTruthy();
    expect(btn().disabled).toBe(true);
    expect((screen.getByLabelText("API-nøkkel") as HTMLInputElement).value).toBe("syntetisk");
    listGate = null; listFail = false;
    fireEvent.click(screen.getByRole("button", { name: "Les konfigurasjonen på nytt" }));
    expect(await screen.findByText(/fortsatt ukjent/)).toBeTruthy();
    expect(btn().disabled).toBe(false);
    expect(db.invoke.filter((c) => (c.body as { action?: string }).action === "save")).toHaveLength(1);
  });

  it("Tripletex: ukjent utfall + feilet ny lesing holder lagring sperret og beholder nøkkel", async () => {
    db.tables.tripletex_credentials = [credRow]; db.tables.tripletex_sync_log = [];
    db.invokeImpl = async (fn) => { if (fn === "tripletex-save-credentials") { db.fail.add("tripletex_credentials"); return { data: {}, error: null }; } return { data: null, error: null }; };
    render(<TripletexSettings />, { wrapper: Wrap });
    fireEvent.change(await screen.findByLabelText("API-nøkkel"), { target: { value: "syntetisk" } });
    fireEvent.click(saveBtn());
    expect(await screen.findByRole("button", { name: "Les konfigurasjonen på nytt" })).toBeTruthy();
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("API-nøkkel") as HTMLInputElement).value).toBe("syntetisk");
    db.fail.delete("tripletex_credentials");
    fireEvent.click(screen.getByRole("button", { name: "Les konfigurasjonen på nytt" }));
    expect(await screen.findByText(/fortsatt ukjent/)).toBeTruthy();
    expect((saveBtn() as HTMLButtonElement).disabled).toBe(false);
    expect(db.invoke.filter((c) => c.fn === "tripletex-save-credentials")).toHaveLength(1);
  });

  it("Tripletex: synk-knapper er sperret uten admin og kaller ingenting", async () => {
    db.access = { canWrite: true, accessLevel: "approve" };
    db.tables.tripletex_credentials = [credRow]; db.tables.tripletex_sync_log = [];
    render(<TripletexSettings />, { wrapper: Wrap });
    const inv = await screen.findByRole("button", { name: "Kjør fakturasynk nå" }) as HTMLButtonElement;
    const sup = screen.getByRole("button", { name: "Kjør leverandørsynk nå" }) as HTMLButtonElement;
    expect(inv.disabled && sup.disabled).toBe(true);
    fireEvent.click(inv); fireEvent.click(sup);
    expect(db.invoke.some((c) => c.fn.startsWith("tripletex-sync"))).toBe(false);
  });
});
