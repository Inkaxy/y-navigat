import { describe, expect, it, vi, beforeEach } from "vitest";

const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (...a: unknown[]) => from(...(a as [])) },
}));

const { markLabelUnitsPrinted } = await import(
  "@/produksjon/features/etiketter/hooks/useLabelUnits"
);

type Unit = Parameters<typeof markLabelUnitsPrinted>[0][number];

const unit = (number: number): Unit =>
  ({
    id: `u-${number}`,
    legal_entity_id: "le-1",
    seq_date: "2026-09-12",
    number,
    unit_key: `k-${number}`,
    label_mode: "per_unit",
    product_id: "p-1",
    order_id: null,
    order_line_id: null,
    unit_index: null,
    note_text: null,
    status: "reserved",
    first_printed_at: null,
    print_count: 0,
  }) as Unit;

describe("registrering av skrevet ut", () => {
  beforeEach(() => {
    eq.mockReset();
    update.mockClear();
    from.mockClear();
  });

  it("oppdaterer hver etikett når alt går bra", async () => {
    eq.mockResolvedValue({ error: null });
    await expect(markLabelUnitsPrinted([unit(1), unit(2)])).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("kaster med etikettnumrene når databasen avviser oppdateringen", async () => {
    eq.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({
      error: { message: "permission denied" },
    });
    await expect(markLabelUnitsPrinted([unit(1), unit(2)])).rejects.toThrow(/etikett 2/);
  });

  it("melder aldri suksess når alle oppdateringene feiler", async () => {
    eq.mockResolvedValue({ error: { message: "nei" } });
    await expect(markLabelUnitsPrinted([unit(4), unit(5)])).rejects.toThrow(/4–5/);
  });
});
