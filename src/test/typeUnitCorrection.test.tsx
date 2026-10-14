// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { parseTypeUnitApply, parseTypeUnitPreview } from "@/fakturaer/lib/typeUnitCorrection";

const RM = "11111111-1111-4111-8111-111111111111";
const calls: Record<string, unknown>[] = [];
let applyImpl: () => Promise<{ data: unknown; error: unknown }> = async () => ({ data: null, error: null });
const preview = (blockers: unknown[] = []) => ({ ok: true, dry_run: true, raw_material_id: RM, updated_at: "2026-10-14T08:54:00.123456+00:00", from: { item_type: "emballasje", base_unit: "stk" }, unit_changes: true, type_changes: true, blockers, compatible_recipe_lines: 7, price_history_to_supersede: 11, package_confirmations_to_reset: 2, open_invoices: 6 });
let previewData: unknown = preview();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: RM, item_type: "emballasje", base_unit: "stk" }, error: null }) }) }) }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return args.p_dry_run ? { data: previewData, error: null } : applyImpl();
    },
  },
}));

import { TypeUnitCorrectionDialog } from "@/fakturaer/components/supplier-item/TypeUnitCorrectionDialog";

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>;

describe("parsere", () => {
  it("ukjent sperrekode tolkes aldri som «ingen sperre»", () => {
    expect(parseTypeUnitPreview(preview([{ code: "noe_nytt" }]), RM)).toBeNull();
    expect(parseTypeUnitPreview(preview(), "annen-id")).toBeNull();
  });
  it("tomt/ukjent svar = ukjent utfall", () => {
    expect(parseTypeUnitApply({}, RM).kind).toBe("unknown");
    expect(parseTypeUnitApply({ ok: false, error: "rar" }, RM).kind).toBe("unknown");
    expect(parseTypeUnitApply({ ok: false, error: "versjon_endret" }, RM).kind).toBe("rejected");
  });
});

describe("Rett varetype og måleenhet", () => {
  beforeEach(() => { calls.length = 0; previewData = preview(); });
  const open = () => render(<TypeUnitCorrectionDialog rawMaterialId={RM} rawMaterialName="Florapan" open onOpenChange={() => {}} canWrite />, { wrapper: wrap });

  it("viser konsekvenser, krever begrunnelse, sender eksakt revisjon; ukjent utfall gjentas med samme opId", async () => {
    applyImpl = async () => ({ data: null, error: new Error("nett") });
    open();
    fireEvent.click(await screen.findByRole("button", { name: "Råvare" }));
    fireEvent.click(screen.getByRole("button", { name: "kg" }));
    expect(await screen.findByText(/7 oppskriftslinje\(r\) er allerede i vekt/)).toBeTruthy();
    expect(screen.getByText(/2 bekreftet pakning i stk gjelder ikke lenger/)).toBeTruthy();
    const save = screen.getByRole("button", { name: "Lagre retting" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Begrunnelse/), { target: { value: "Leveres i poser à 100 gram" } });
    await waitFor(() => expect((screen.getByRole("button", { name: "Lagre retting" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Lagre retting" }));
    expect(await screen.findByText(/Utfallet er ukjent/)).toBeTruthy();
    applyImpl = async () => ({ data: { ok: true, already: true, raw_material_id: RM, updated_at: "x", item_type: "ravare", base_unit: "kg", package_confirmations_reset: 2 }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Prøv igjen" }));
    expect(await screen.findByText(/Lagret: Råvare · grunnenhet kg/)).toBeTruthy();
    const applies = calls.filter((c) => c.p_dry_run === false);
    expect(applies).toHaveLength(2);
    expect(applies[0].p_op_id).toBe(applies[1].p_op_id);
    expect(applies[0]).toMatchObject({ p_item_type: "ravare", p_base_unit: "kg", p_expected_updated_at: "2026-10-14T08:54:00.123456+00:00" });
  });

  it("stk-oppskrift sperrer lagring med forklaring", async () => {
    previewData = preview([{ code: "oppskrift_krever_mapping", lines: [{ recipe_line_id: "a", recipe_id: "b", unit: "stk" }] }]);
    open();
    fireEvent.click(await screen.findByRole("button", { name: "kg" }));
    expect(await screen.findByText(/må rettes først – mengdene endres ikke automatisk/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Begrunnelse/), { target: { value: "Leveres i poser à 100 gram" } });
    expect((screen.getByRole("button", { name: "Lagre retting" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
