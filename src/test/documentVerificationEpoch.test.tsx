import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

// Bare eksterne kilder stubbes: nettverk (rpc/signering/fetch), innlogget bruker og PDF.js-tegning.
type RpcResult = { data: unknown; error: unknown };
const rpcImpl = vi.fn<() => Promise<RpcResult>>();
const thenable = (p: Promise<RpcResult>) => Object.assign(p, { abortSignal: () => p });
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: () => thenable(rpcImpl()),
    storage: { from: () => ({ createSignedUrl: async (path: string) => ({ data: { signedUrl: `https://signed/${path}?t=${Math.random()}` }, error: null }) }) },
  },
}));
let userId: string | null = "u1";
vi.mock("@/hooks/useAuth", () => ({ useAuthUserId: () => userId }));
const getDocument = vi.fn(() => ({ promise: new Promise(() => undefined), destroy: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ getDocument: (...a: unknown[]) => (getDocument as (...x: unknown[]) => unknown)(...a), GlobalWorkerOptions: {} }));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "" }));

import { InvoiceDocumentPanel } from "@/fakturaer/components/InvoiceDocumentPanel";
import { DOC_VERSION_KEY } from "@/fakturaer/hooks/useInvoiceDocumentVersion";

const PATH = "c1/doc.pdf";
const meta = (version: string) => ({ data: { available: true, invoice_id: "i1", path: PATH, object_id: "o1", version, storage_version: version, updated_at: "2026-10-11T10:00:00.000001+00:00" }, error: null });
const pdfBytes = () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3]);
const fetchMock = vi.fn(async () => new Response(pdfBytes(), { headers: { "content-type": "application/pdf" } }));

function setup(warm: { version?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(["company"], { id: "c1" });
  if (warm.version) {
    const old = Date.now() - 60_000;
    qc.setQueryData([DOC_VERSION_KEY, "i1", "c1", "u1"], meta(warm.version).data, { updatedAt: old });
    qc.setQueryData(["invoice-doc-url", PATH, warm.version, "u1|c1"], "https://signed/old");
    qc.setQueryData(["invoice-document-render", PATH, warm.version, "u1|c1"], { kind: "pdf", bytes: pdfBytes(), type: "application/pdf", fingerprint: "old" });
  }
  const ui = (): ReactNode => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InvoiceDocumentPanel invoiceId="i1" onClose={() => undefined} invoice={{ invoice_number: "1", invoice_date: "2026-10-01", supplier_name: "L", source_document_url: PATH }} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const r = render(<>{ui()}</>);
  return { qc, rerender: () => r.rerender(<>{ui()}</>) };
}

beforeEach(() => {
  userId = "u1";
  rpcImpl.mockReset(); getDocument.mockClear(); fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

describe("InvoiceDocumentPanel + PdfDocumentViewer: verifiseringsepoke", () => {
  it("varm gammel cache mens fersk metadata venter: ingen gammel visning; ny versjon tegnes etterpå", async () => {
    let resolve!: (v: RpcResult) => void;
    rpcImpl.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    setup({ version: "v1" });
    await waitFor(() => expect(rpcImpl).toHaveBeenCalled());
    expect(getDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Åpne/ })).toBeNull();
    rpcImpl.mockImplementation(async () => meta("v2"));
    await act(async () => { resolve(meta("v2")); });
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1); // nye bytes, ikke den varme v1-cachen
  });

  it("varm match etterfulgt av feilet oppfrisking: ingen original, ingen åpne-lenke", async () => {
    rpcImpl.mockImplementation(async () => ({ data: null, error: new Error("nett") }));
    setup({ version: "v1" });
    await screen.findByText("Kunne ikke hente dokumentet.");
    expect(getDocument).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /Åpne/ })).toBeNull();
  });

  it("bekreftet uendret identitet gjenbruker bytes uten ny nedlasting", async () => {
    rpcImpl.mockImplementation(async () => meta("v1"));
    setup({ version: "v1" });
    await waitFor(() => expect(getDocument).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erstattet under nedlasting: bytes publiseres ikke, «Originalen er endret» vises", async () => {
    const seq = [meta("v1"), meta("v1"), meta("v2")]; // metadata, før nedlasting, etter nedlasting
    rpcImpl.mockImplementation(async () => seq.shift() ?? meta("v2"));
    setup();
    await screen.findByText(/Originalen er endret mens den ble hentet/);
    expect(getDocument).not.toHaveBeenCalled();
  });

  it("brukerbytte mens metadata venter: sen svar for forrige bruker tegnes ikke", async () => {
    let resolve!: (v: RpcResult) => void;
    rpcImpl.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    const { rerender } = setup({ version: "v1" });
    await waitFor(() => expect(rpcImpl).toHaveBeenCalled());
    rpcImpl.mockImplementation(() => new Promise(() => undefined)); // ny brukers oppslag venter
    userId = "u2";
    rerender();
    await act(async () => { resolve(meta("v1")); });
    await new Promise((r) => setTimeout(r, 20));
    expect(getDocument).not.toHaveBeenCalled();
  });
});
