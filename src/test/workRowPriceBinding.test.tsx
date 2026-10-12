// @vitest-environment jsdom
/** WorkRowPrice: ekte hook og gate; kvittering for annen råvare enn kortets vises aldri. Mocket I/O. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorkItem } from "@/ravarer/lib/workRpcTypes";

const V = "2026-10-11T12:00:00.123456+00:00";
let lineRm = "rmA";
let lineLookupSignal: AbortSignal | null = null;
let lineLookupFails = false;

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    let cols = "";
    let head = false;
    const c = {
      select: (s: string, o?: { head?: boolean }) => { cols = s; head = !!o?.head; return c; },
      eq: () => c, limit: () => c, order: () => c, gt: () => c,
      abortSignal: (s: AbortSignal) => { if (table === "invoice_lines" && cols === "id, invoice_id") lineLookupSignal = s; return c; },
      maybeSingle: () => c,
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) => {
        let v: unknown;
        if (table === "invoices") v = { data: { id: "inv1", legal_entity_id: "le" }, error: null };
        else if (cols === "id, invoice_id") v = lineLookupFails ? { data: null, error: { message: "x", code: "500" } } : { data: { id: "l1", invoice_id: "inv1" }, error: null };
        else if (head) v = { count: 1, error: null };
        else v = { data: [{ id: "l1", updated_at: V, raw_material_id: lineRm }], error: null };
        return Promise.resolve(v).then(ok, bad);
      },
    };
    return c;
  };
  const rpc = () => ({
    abortSignal: () => rpc(),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: {
      schema_version: 2, invoice_id: "inv1", legal_entity_id: "le", checked_at: new Date().toISOString(),
      lines: [{ line_id: "l1", line_version: V, raw_material_id: lineRm, can_compare: true, effect_nok: 10, reason_code: null,
        reference_source: "agreement", reference_id: "ag1", reference_date: "2026-01-01", base_unit: "kg", currency: "NOK",
        expected_price_per_base_unit: 10, price_per_base_unit: 11, base_quantity: 5 }],
    }, error: null }).then(ok),
  });
  return { supabase: { from: chain, rpc } };
});

import { WorkRowPrice } from "@/ravarer/pages/priskontroll/gjore/WorkRowPrice";

const item = (rm: string | null): WorkItem => ({
  key: "k", grp: "pris", type: "varekort", kind: "prisavvik", supplier_id: "s", supplier_name: "S", item_key: "sku:1", invoice_id: null,
  invoice_number: null, title: "Mel", sku: null, rm_id: rm, rm_name: "Mel", open_lines: 1, open_invoices: 1, invoice_count: 1, amount: 0,
  impact_nok: null, last_date: null, last_open_line_id: "l1", reasons: [], effect_status: "unknown", effect_label: null,
  read_integrity: "checked", read_integrity_flags: [], unknown_effect_lines: null, amount_kind: null, action_required: null,
});

const tree = (it: WorkItem) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><WorkRowPrice it={it} /></QueryClientProvider>;

beforeEach(() => { lineRm = "rmA"; lineLookupSignal = null; lineLookupFails = false; });

describe("WorkRowPrice", () => {
  it("samme råvare: forventet → faktura og fortegnsprosent vises", async () => {
    render(tree(item("rmA")));
    expect(await screen.findByText(/\+10/)).toBeInTheDocument();
    expect(screen.getByText(/Faktura: 11/)).toBeInTheDocument();
    expect(lineLookupSignal).not.toBeNull();
  });
  it("foreldet kort for A, fersk linje/kvittering for B: ingen sammenligning, stille status", async () => {
    lineRm = "rmB";
    render(tree(item("rmA")));
    expect(await screen.findByText("Prisgrunnlag ikke kontrollert")).toBeInTheDocument();
    expect(screen.queryByText(/Faktura:/)).toBeNull();
  });
  it("oppslag feiler: stille «ikke kontrollert», ingen tall", async () => {
    lineLookupFails = true;
    render(tree(item("rmA")));
    await waitFor(() => expect(screen.getByText("Prisgrunnlag ikke kontrollert")).toBeInTheDocument());
    expect(screen.queryByText(/%/)).toBeNull();
  });
});
