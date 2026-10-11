// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

// Ekte produksjonskomponenter: InvoiceDocumentPanel + LesPaNytt + PdfDocumentViewer + useInvoiceDocumentVersion.
// Stubbet: nettverk (rpc/signering/fetch/from), innlogget bruker, rettigheter, lesekjøringens nettverkshooks,
// PDF.js-tegning, og RereadView (bare for å lese `canApply` som LesPaNytt faktisk beregner).
type RpcResult = { data: unknown; error: unknown };
const rpcImpl = vi.fn<() => Promise<RpcResult>>();
const thenable = (p: Promise<RpcResult>) => Object.assign(p, { abortSignal: () => p });
const chain: Record<string, unknown> = {};
for (const k of ["select", "eq", "in", "order", "limit"]) chain[k] = () => chain;
chain.maybeSingle = async () => ({ data: { id: "i1", invoice_number: "1", source_document_url: "c1/doc.pdf", status: "ready", suppliers: { name: "L" } }, error: null });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => thenable(rpcImpl()),
    from: () => chain,
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}` }, error: null }) }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({ useAuthUserId: () => "u1", useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/fakturaer/hooks/useInvoiceRights", () => ({ useInvoiceRights: () => ({ canWrite: true }) }));
const invokeMutate = vi.fn();
const applyMutate = vi.fn();
const run = { id: "r1", invoice_id: "i1", created_by: "u1", status: "ready", created_at: "2026-10-11T10:00:00Z",
  snapshotDocument: { id: "o1", name: "c1/doc.pdf", version: "v1", updated_at: "2026-10-11T10:00:00.000001+00:00" } };
vi.mock("@/fakturaer/hooks/useInvoiceReread", () => ({
  useRereadRun: () => ({ data: run, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useBeginReread: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useInvokeRereadPreview: () => ({ mutate: invokeMutate, isPending: false, data: undefined }),
  useCancelReread: () => ({ mutate: vi.fn(), isPending: false }),
  useApplyReread: () => ({ mutate: applyMutate, isPending: false, data: undefined }),
}));
vi.mock("@/fakturaer/components/reread/RereadView", () => ({
  RereadView: ({ canApply }: { canApply: boolean }) => <div data-testid="can-apply">{String(canApply)}</div>,
  ReadingState: () => null,
}));
const getDocument = vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument: (...a: unknown[]) => (getDocument as (...x: unknown[]) => unknown)(...a), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));

import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import LesPaNytt from "@/ravarer/pages/priskontroll/faktura/LesPaNytt";
import { DOC_VERSION_KEY } from "@/fakturaer/hooks/useInvoiceDocumentVersion";

const PATH = "c1/doc.pdf";
const meta = (version: string): RpcResult => ({ data: { available: true, invoice_id: "i1", path: PATH, object_id: "o1", version, storage_version: "v1", updated_at: "2026-10-11T10:00:00.000001+00:00" }, error: null });
const fail = (): RpcResult => ({ data: null, error: new Error("nett") });
const fetchMock = vi.fn(async () => new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]), { headers: { "content-type": "application/pdf" } }));

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["company"], { id: "c1" });
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/f/i1?kjoring=r1"]}>
        <Routes><Route path="/f/:id" element={<>
          <InvoiceDocumentPanel invoiceId="i1" onClose={() => undefined} invoice={{ invoice_number: "1", invoice_date: "2026-10-01", supplier_name: "L", source_document_url: PATH }} />
          <LesPaNytt />
        </>} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(<>{ui}</>);
  return qc;
}
const canApply = () => screen.getByTestId("can-apply").textContent;

/** Rekkefølge: metadata (delt), kontroll før nedlasting, kontroll etter nedlasting; deretter `rest`. */
function sequence(seq: RpcResult[], rest: () => RpcResult) {
  rpcImpl.mockImplementation(async () => seq.shift() ?? rest());
}

beforeEach(() => {
  sessionStorage.clear();
  rpcImpl.mockReset(); getDocument.mockClear(); fetchMock.mockClear(); invokeMutate.mockClear(); applyMutate.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("delt tilbakekalling av dokumentverifisering (panel + Les på nytt)", () => {
  it("avvik etter nedlasting sperrer bruk i LesPaNytt straks, uten klikk; sen vellykket henting gjenoppretter ikke; eksplisitt «Hent på nytt» gjør", async () => {
    sequence([meta("v1"), meta("v1"), meta("v2")], () => meta("v2"));
    const qc = setup();
    await screen.findByText(/Ingenting fra den gamle versjonen vises/);
    expect(canApply()).toBe("false");
    expect(getDocument).not.toHaveBeenCalled();
    // Sen/annen fullføring av metadataoppslaget (ikke eksplisitt retry) kan ikke gjenopprette.
    rpcImpl.mockImplementation(async () => meta("v1"));
    await act(async () => { await qc.refetchQueries({ queryKey: [DOC_VERSION_KEY, "i1"] }); });
    await new Promise((r) => setTimeout(r, 30));
    expect(canApply()).toBe("false");
    // Eksplisitt fersk kontroll med uendret original gjenoppretter.
    fireEvent.click(screen.getAllByRole("button", { name: /Hent på nytt/ })[0]);
    await waitFor(() => expect(canApply()).toBe("true"));
    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(invokeMutate).not.toHaveBeenCalled(); // ingen ny AI-lesing
    expect(applyMutate).not.toHaveBeenCalled();
  });

  it("metadatafeil i kontrollen etter nedlasting sperrer bruk straks; ingen automatisk evig gjenhenting", async () => {
    sequence([meta("v1"), meta("v1")], fail);
    setup();
    await screen.findByText(/Ingenting fra den gamle versjonen vises/);
    expect(canApply()).toBe("false");
    const calls = rpcImpl.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(rpcImpl.mock.calls.length).toBeLessThanOrEqual(calls + 1); // høyst ett innebygd forsøk, ingen løkke
    expect(canApply()).toBe("false");
    rpcImpl.mockImplementation(async () => meta("v1"));
    fireEvent.click(screen.getAllByRole("button", { name: /Hent på nytt/ })[0]);
    await waitFor(() => expect(canApply()).toBe("true"));
    expect(invokeMutate).not.toHaveBeenCalled();
  });

  it("dokument fjernet (available:false) i kontrollen før nedlasting sperrer bruk", async () => {
    const gone: RpcResult = { data: { available: false, invoice_id: "i1", reason: "document_missing" }, error: null };
    let n = 0;
    // Metadataoppslagene gir v1; første kontroll i visningen (før nedlasting) finner dokumentet borte.
    rpcImpl.mockImplementation(async () => (fetchMock.mock.calls.length === 0 && getDocument.mock.calls.length === 0 && ++n > 2 ? gone : meta("v1")));
    setup();
    await screen.findByText(/Ingenting fra den gamle versjonen vises/);
    expect(canApply()).toBe("false");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
