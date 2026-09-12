/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const fetchLatestSnapshotItems = vi.fn();
const saveProductionPlanSnapshot = vi.fn();
const toast = vi.fn();

vi.mock("@/produksjon/features/produksjonsplan/hooks/useProductionPlanSnapshots", () => ({
  fetchLatestSnapshotItems: (...a: unknown[]) => fetchLatestSnapshotItems(...a),
  saveProductionPlanSnapshot: (...a: unknown[]) => saveProductionPlanSnapshot(...a),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => toast(...a) }));

const { usePrintJob } = await import("@/produksjon/features/produksjonsplan/hooks/usePrintJob");
const { DEFAULT_CRITERIA } = await import("@/produksjon/features/produksjonsplan/types");
const { DEFAULT_PRINT_PRODUKSJON_OPTIONS } = await import(
  "@/produksjon/features/produksjonsplan/components/PrintProduksjonslisteDialog"
);

type Source = Parameters<typeof usePrintJob>[0];
type Row = Source["rows"][number];

const row = (productId: string, qty: number): Row =>
  ({
    product_id: productId,
    product_code: null,
    product_name: productId,
    unit_of_sale: "stk",
    main_category_id: null,
    main_category_code: null,
    main_category_name: null,
    sub_category_id: null,
    production_group_id: null,
    production_group_name: null,
    dough_type: null,
    pieces_per_tray: null,
    pieces_per_liter: null,
    quantity_ordered: qty,
    quantity_from_stock: 0,
    quantity_to_produce: qty,
    trays_full: 0,
    trays_partial: 0,
    liters: null,
    on_stock: null,
    tour_number: null,
  }) as unknown as Row;

const source = (over: Partial<Source> = {}): Source => ({
  legalEntityId: "le-1",
  dateStr: "2026-09-12",
  date: new Date("2026-09-12T00:00:00Z"),
  rows: [row("p-1", 10)],
  criteria: { ...DEFAULT_CRITERIA, print_correction_last: false },
  counts: { fast: 1, datert: 2, pakkseddel: 0 },
  prefs: {
    columns: {
      mainGroup: true,
      doughType: true,
      unit: true,
      ordered: true,
      fromStock: true,
      liters: true,
      onStock: true,
    },
    showByMainGroup: true,
    showTraysWithPlus: true,
  },
  planUnavailable: false,
  ...over,
});

/** Kjører fram forbi print-forsinkelsen og bekreftelsesforsinkelsen. */
async function runTimers() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
}

describe("usePrintJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchLatestSnapshotItems.mockReset();
    saveProductionPlanSnapshot.mockReset();
    toast.mockReset();
    window.print = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fryser grunnlaget selv om datoen endres under snapshot-oppslaget", async () => {
    let release: (v: unknown) => void = () => {};
    fetchLatestSnapshotItems.mockImplementation(
      () => new Promise((res) => { release = res; }),
    );
    const initial = source({ criteria: { ...DEFAULT_CRITERIA, print_correction_last: true } });
    const { result, rerender } = renderHook((p: Source) => usePrintJob(p), {
      initialProps: initial,
    });

    act(() => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });

    // Brukeren bytter dato mens oppslaget pågår.
    rerender(source({ dateStr: "2026-09-13", rows: [row("p-9", 99)] }));
    await act(async () => { release({ status: "none" }); });

    expect(result.current.printJob?.dateStr).toBe("2026-09-12");
    expect(result.current.printJob?.rows).toHaveLength(1);
    expect(result.current.printJob?.rows[0].product_id).toBe("p-1");
  });

  it("beholder det frosne forsøket selv om planen feiler underveis", async () => {
    const { result, rerender } = renderHook((p: Source) => usePrintJob(p), {
      initialProps: source(),
    });
    act(() => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    await act(async () => {});
    rerender(source({ planUnavailable: true, rows: [] }));

    expect(result.current.printJob).not.toBeNull();
    expect(result.current.printJob?.rows).toHaveLength(1);
  });

  it("blokkerer dobbeltstart", async () => {
    const { result } = renderHook((p: Source) => usePrintJob(p), {
      initialProps: source({ criteria: { ...DEFAULT_CRITERIA, print_correction_last: true } }),
    });
    fetchLatestSnapshotItems.mockResolvedValue({ status: "none" });

    await act(async () => {
      void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS);
      void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS);
    });

    expect(fetchLatestSnapshotItems).toHaveBeenCalledTimes(1);
  });

  it("lagrer ingen baseline når brukeren sier at utskriften ble avbrutt", async () => {
    const { result } = renderHook((p: Source) => usePrintJob(p), { initialProps: source() });
    await act(async () => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    await runTimers();
    expect(result.current.confirmPrint).not.toBeNull();

    act(() => result.current.dismissConfirm());

    expect(saveProductionPlanSnapshot).not.toHaveBeenCalled();
    expect(result.current.confirmPrint).toBeNull();
    expect(result.current.printBusy).toBe(false);
  });

  it("lagrer det frosne grunnlaget – ikke levende dato og rader – ved bekreftelse", async () => {
    const { result, rerender } = renderHook((p: Source) => usePrintJob(p), {
      initialProps: source(),
    });
    await act(async () => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    await runTimers();
    const attemptId = result.current.confirmPrint?.attemptId;

    // Levende kilde endrer seg etter utskriften.
    rerender(source({ dateStr: "2026-09-20", rows: [row("p-9", 99)] }));
    saveProductionPlanSnapshot.mockResolvedValue({ id: attemptId, itemCount: 1, alreadySaved: false });

    await act(async () => { await result.current.confirmPrinted(); });

    expect(saveProductionPlanSnapshot).toHaveBeenCalledTimes(1);
    const [id, entity, dateStr, , savedRows] = saveProductionPlanSnapshot.mock.calls[0];
    expect(id).toBe(attemptId);
    expect(entity).toBe("le-1");
    expect(dateStr).toBe("2026-09-12");
    expect(savedRows).toHaveLength(1);
    expect(savedRows[0].product_id).toBe("p-1");
    expect(result.current.confirmPrint).toBeNull();
  });

  it("beholder forsøket når lagringen feiler, slik at samme grunnlag kan prøves igjen", async () => {
    const { result } = renderHook((p: Source) => usePrintJob(p), { initialProps: source() });
    await act(async () => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    await runTimers();
    const attemptId = result.current.confirmPrint?.attemptId;

    saveProductionPlanSnapshot.mockRejectedValueOnce(new Error("nettverksfeil"));
    await act(async () => { await result.current.confirmPrinted(); });
    expect(result.current.confirmPrint?.attemptId).toBe(attemptId);

    saveProductionPlanSnapshot.mockResolvedValueOnce({ id: attemptId, itemCount: 1, alreadySaved: true });
    await act(async () => { await result.current.confirmPrinted(); });

    expect(saveProductionPlanSnapshot.mock.calls[1][0]).toBe(attemptId);
    expect(result.current.confirmPrint).toBeNull();
  });

  it("avbryter utskriften når forrige grunnlag ikke kunne leses", async () => {
    fetchLatestSnapshotItems.mockResolvedValue({ status: "error", message: "feil" });
    const { result } = renderHook((p: Source) => usePrintJob(p), {
      initialProps: source({ criteria: { ...DEFAULT_CRITERIA, print_correction_last: true } }),
    });

    await act(async () => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    await runTimers();

    expect(result.current.printJob).toBeNull();
    expect(result.current.confirmPrint).toBeNull();
    expect(result.current.printBusy).toBe(false);
    // Etter avbrudd skal et nytt forsøk være mulig.
    fetchLatestSnapshotItems.mockResolvedValue({ status: "none" });
    await act(async () => { void result.current.startPrint(DEFAULT_PRINT_PRODUKSJON_OPTIONS); });
    expect(fetchLatestSnapshotItems).toHaveBeenCalledTimes(2);
  });
});
