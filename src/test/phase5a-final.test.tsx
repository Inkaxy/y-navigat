// @vitest-environment jsdom
/** Fase 5A sluttrest: faktiske komponenter/hooks med mocket I/O. Ingen ekte opplasting, avtale eller koblingsflytt. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

const io = vi.hoisted(() => ({
  uploads: [] as string[],
  rpcCalls: [] as { fn: string; args: unknown }[],
  uploadGate: null as null | Promise<{ error: null }>,
  rpcImpl: (async () => ({ data: {}, error: null })) as (fn: string, args: unknown) => Promise<unknown>,
  linkRead: { data: [] as unknown[] | null, error: null as unknown },
  canWrite: true,
  linkGate: null as null | Promise<unknown>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const builder = () => {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in"]) b[m] = () => b;
    b.limit = () => io.linkGate ?? Promise.resolve(io.linkRead);
    return b;
  };
  return {
    supabase: {
      storage: { from: () => ({ upload: (path: string) => { io.uploads.push(path); return io.uploadGate ?? Promise.resolve({ error: null }); } }) },
      rpc: (fn: string, args: unknown) => { io.rpcCalls.push({ fn, args }); return io.rpcImpl(fn, args); },
      from: () => builder(),
    },
  };
});
vi.mock("@/ravarer/context/RavarerContext", () => ({ useRavarer: () => ({ legalEntityId: "LE", user: null, canWrite: io.canWrite }) }));
vi.mock("@/ravarer/hooks/useRawMaterials", () => ({ useRawMaterials: () => ({ data: [{ id: "RM-A", name: "Mel A", sku: "A", base_unit: "kg", is_active: true }, { id: "RM-B", name: "Mel B", sku: "B", base_unit: "kg", is_active: true }] }) }));
vi.mock("@/ravarer/hooks/useSuppliers", () => ({ useSuppliers: () => ({ data: [{ id: "SUP", name: "Lev" }] }) }));
vi.mock("@/ravarer/hooks/useSupplierDetail", () => ({ useUpdateSupplierNotes: () => ({ isPending: false, mutate: vi.fn() }) }));
vi.mock("@/fakturaer/hooks/useMaterialChoices", () => ({ useMaterialChoices: () => ({ results: { data: [{ id: "RM-NEW", name: "Ny vare", category: null, base_unit: "kg" }], isFetching: false } }) }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), message: vi.fn() }) }));

import { NewAgreementDialog } from "@/ravarer/components/NewAgreementDialog";
import { resetPendingAgreementsForTest } from "@/ravarer/lib/agreementRecovery";
import { ChangeLinkDialog } from "@/ravarer/pages/priskontroll/gjore/ChangeLinkDialog";
import { ChangeLinkUnknownError, useChangeSupplierLink } from "@/ravarer/pages/priskontroll/gjore/useGjoreMutations";
import { resetChangeLinkUnknownForTest } from "@/ravarer/pages/priskontroll/gjore/changeLinkPending";
import { latestCell } from "@/ravarer/components/supplier/SupplierItemsSection";
import { SupplierNotesSection } from "@/ravarer/components/supplier/SupplierNotesSection";
import { OrderDeskKpi } from "@/ordre/components/dashboard/OrderDeskKpi";
import type { SupplierItem } from "@/fakturaer/lib/supplierItems";
import type { SupplierRow } from "@/ravarer/hooks/useSuppliers";
import { Wallet } from "lucide-react";

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const Wrap = ({ children, qc }: { children: ReactNode; qc: QueryClient }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

beforeEach(() => {
  io.uploads = []; io.rpcCalls = []; io.uploadGate = null; io.canWrite = true; io.linkGate = null;
  io.rpcImpl = async () => ({ data: {}, error: null });
  io.linkRead = { data: [], error: null };
  resetPendingAgreementsForTest();
  resetChangeLinkUnknownForTest();
});

function AgreementHost({ qc }: { qc: QueryClient }) {
  const [open, setOpen] = useState(true);
  return (
    <Wrap qc={qc}>
      <button onClick={() => setOpen(true)}>åpne</button>
      <NewAgreementDialog open={open} onOpenChange={setOpen} defaultRawMaterialId="RM-A" defaultSupplierId="SUP" />
    </Wrap>
  );
}
const fillPrice = () => fireEvent.change(screen.getByPlaceholderText("0,00"), { target: { value: "100" } });
const save = () => screen.getByRole("button", { name: /lagre avtale/i });

describe("NewAgreementDialog — livsløp og ukjent utfall", () => {
  it("avmontering under opplasting stopper rm_apply_agreement", async () => {
    let release!: (v: { error: null }) => void;
    io.uploadGate = new Promise((r) => { release = r; });
    const qc = client();
    const { unmount } = render(<AgreementHost qc={qc} />);
    fillPrice();
    const file = new File(["%PDF"], "a.pdf", { type: "application/pdf" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    fireEvent.click(save());
    await waitFor(() => expect(io.uploads).toHaveLength(1));
    unmount();
    await act(async () => { release({ error: null }); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(io.rpcCalls).toHaveLength(0);
  });

  it("ukjent utfall overlever lukk/åpne; lagring sperret til avstemming; samsvar gir «lagret» uten nytt kall", async () => {
    const qc = client();
    render(<AgreementHost qc={qc} />);
    fillPrice();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("agreement-unknown")).toBeTruthy());
    expect(io.rpcCalls).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /avbryt/i }));
    fireEvent.click(screen.getByText("åpne"));
    await waitFor(() => expect(screen.getByTestId("agreement-unknown")).toBeTruthy());
    fillPrice();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    // Lesefeil holder låst.
    io.linkRead = { data: null, error: { message: "nede" } };
    fireEvent.click(screen.getByRole("button", { name: /kontroller lagret avtale/i }));
    await waitFor(() => expect(screen.getByText(/kunne ikke lese/i)).toBeTruthy());
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    // Lest kobling med samme innhold = lagret.
    io.linkRead = { data: [{ agreed_price: 100, agreed_price_per_base_unit: null, agreement_valid_from: (io.rpcCalls[0].args as { p_payload: { agreement_valid_from: string } }).p_payload.agreement_valid_from, agreement_valid_to: null, agreement_document_url: null }], error: null };
    fireEvent.click(screen.getByRole("button", { name: /kontroller lagret avtale/i }));
    await waitFor(() => expect(screen.queryByTestId("agreement-unknown")).toBeNull());
    expect(io.rpcCalls).toHaveLength(1);
  });

  it("ulik lagret tilstand krever eksplisitt «ny endring» før lagring", async () => {
    const qc = client();
    render(<AgreementHost qc={qc} />);
    fillPrice();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("agreement-unknown")).toBeTruthy());
    io.linkRead = { data: [{ agreed_price: 90, agreed_price_per_base_unit: null, agreement_valid_from: null, agreement_valid_to: null, agreement_document_url: null }], error: null };
    fireEvent.click(screen.getByRole("button", { name: /kontroller lagret avtale/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /lagre som ny endring/i })).toBeTruthy());
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /lagre som ny endring/i }));
    expect((save() as HTMLButtonElement).disabled).toBe(false);
    expect(io.rpcCalls).toHaveLength(1);
  });
});

function SwitchHost({ qc }: { qc: QueryClient }) {
  const [open, setOpen] = useState(true);
  const [rm, setRm] = useState("RM-A");
  return (
    <Wrap qc={qc}>
      <button onClick={() => { setOpen(false); setRm("RM-B"); setTimeout(() => setOpen(true), 0); }}>bytt til B</button>
      <NewAgreementDialog open={open} onOpenChange={setOpen} defaultRawMaterialId={rm} defaultSupplierId="SUP" />
    </Wrap>
  );
}

describe("NewAgreementDialog — sen avstemming A etter bytte til B", () => {
  it("A avstemmes og ryddes, men B forblir åpen uten toast", async () => {
    const { toast } = await import("sonner");
    const qc = client();
    const inval = vi.spyOn(qc, "invalidateQueries");
    render(<SwitchHost qc={qc} />);
    fillPrice();
    fireEvent.click(save());
    await waitFor(() => expect(screen.getByTestId("agreement-unknown")).toBeTruthy());
    let release!: (v: unknown) => void;
    io.linkGate = new Promise((r) => { release = r; });
    fireEvent.click(screen.getByRole("button", { name: /kontroller lagret avtale/i }));
    fireEvent.click(screen.getByText("bytt til B"));
    await waitFor(() => expect(screen.queryByTestId("agreement-unknown")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: /lagre avtale/i })).toBeTruthy());
    const from = (io.rpcCalls[0].args as { p_payload: { agreement_valid_from: string } }).p_payload.agreement_valid_from;
    await act(async () => { release({ data: [{ agreed_price: 100, agreed_price_per_base_unit: null, agreement_valid_from: from, agreement_valid_to: null, agreement_document_url: null }], error: null }); await Promise.resolve(); });
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.getByRole("button", { name: /lagre avtale/i })).toBeTruthy();
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(inval).toHaveBeenCalled();
    expect(io.rpcCalls).toHaveLength(1);
  });
});

describe("rm_change_supplier_link — transport", () => {
  const input = { rmsId: "RMS", oldRawMaterialId: "RM-A", newRawMaterialId: "RM-NEW", reason: "feil", lineIds: ["L1"] };
  it.each([
    ["avvist fetch", async () => { throw new TypeError("Failed to fetch"); }, true],
    ["feil uten SQL-kode", async () => ({ data: null, error: { message: "Failed to fetch" } }), true],
    ["SQL-avvisning med kode", async () => ({ data: null, error: { code: "P0001", message: "ikke tilgang" } }), false],
  ])("%s", async (_n, impl, unknown) => {
    io.rpcImpl = impl;
    const qc = client();
    const { result } = renderHook(() => useChangeSupplierLink(), { wrapper: ({ children }) => <Wrap qc={qc}>{children}</Wrap> });
    let err: unknown;
    await act(async () => { try { await result.current.mutateAsync(input); } catch (e) { err = e; } });
    expect(err instanceof ChangeLinkUnknownError).toBe(unknown);
  });

  it("dialog: nettverksfeil sperrer også etter lukk/åpne til eksplisitt kontroll", async () => {
    io.rpcImpl = async () => { throw new TypeError("Failed to fetch"); };
    const item = { rms_id: "RMS", rm_id: "RM-A", rm_name: "Mel A" } as SupplierItem;
    function Host() {
      const [open, setOpen] = useState(true);
      return <Wrap qc={client()}><button onClick={() => setOpen(true)}>åpne</button><ChangeLinkDialog open={open} onOpenChange={setOpen} item={item} lines={[]} onDone={() => undefined} /></Wrap>;
    }
    render(<Host />);
    fireEvent.click(screen.getByRole("button", { name: /ny vare/i }));
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "feil vare" } });
    fireEvent.click(screen.getByRole("button", { name: /^endre kobling$/i }));
    await waitFor(() => expect(screen.getByTestId("change-link-unknown")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /avbryt/i }));
    fireEvent.click(screen.getByText("åpne"));
    fireEvent.click(screen.getByRole("button", { name: /ny vare/i }));
    fireEvent.change(screen.getByLabelText("Begrunnelse"), { target: { value: "feil vare" } });
    expect((screen.getByRole("button", { name: /^endre kobling$/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /jeg har kontrollert koblingen/i }));
    expect((screen.getByRole("button", { name: /^endre kobling$/i }) as HTMLButtonElement).disabled).toBe(false);
    expect(io.rpcCalls).toHaveLength(1);
  });
});

describe("siste kjøpspris — enhet fra samme bevis", () => {
  it("viser bevisets enhet (kg), ikke en annen bufret enhet", () => {
    render(<div>{latestCell({ kind: "price", price: 50, date: "2026-10-01", invoiceId: "I", unit: "kg" })}</div>);
    expect(screen.getByText("/kg")).toBeTruthy();
    expect(screen.queryByText("/stk")).toBeNull();
  });
});

describe("notater — grunnlinje", () => {
  const s = (notes: string) => ({ id: "S", notes } as SupplierRow);
  function Host({ notes }: { notes: string }) { const [, set] = useState(false); return <SupplierNotesSection supplier={s(notes)} canWrite onDirtyChange={set} />; }
  it("ren ekstern oppdatering → rediger → Forkast gir fersk serververdi", () => {
    const { rerender } = render(<Host notes="gammel A" />);
    rerender(<Host notes="fersk servernotat" />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("fersk servernotat");
    fireEvent.change(ta, { target: { value: "lokal" } });
    fireEvent.click(screen.getByRole("button", { name: "Forkast" }));
    expect(ta.value).toBe("fersk servernotat");
  });
  it("skitten ekstern oppdatering beholder brukerens tekst; Forkast gir fersk serververdi", () => {
    const { rerender } = render(<Host notes="gammel A" />);
    const ta = screen.getByRole("textbox") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "lokal" } });
    rerender(<Host notes="fersk" />);
    expect(ta.value).toBe("lokal");
    fireEvent.click(screen.getByRole("button", { name: "Forkast" }));
    expect(ta.value).toBe("fersk");
  });
});

describe("oversiktskort på mobil", () => {
  it("lang forklaring brytes og kortet kan krympe", () => {
    render(<OrderDeskKpi wrapSub icon={Wallet} label="Kjøpt" value="1" sub="en svært lang forklaring som ikke skal gjøre kortet bredere enn skjermen" />);
    const g = screen.getByRole("group");
    expect(g.className).toContain("min-w-0");
    expect(screen.getByText(/svært lang/).className).toContain("break-words");
  });
});
