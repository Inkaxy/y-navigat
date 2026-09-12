/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Regresjon: et pågående utskriftsforsøk skal rendres uavhengig av den levende
 * planen. Bytter brukeren dato, eller feiler en bakgrunnsoppdatering etter at
 * forsøket er fryst, skal utskriften fortsatt vise det frosne grunnlaget —
 * aldri bli blank.
 */

const planState = {
  data: undefined as unknown,
  isLoading: false,
  isError: false,
  error: null as unknown,
  refetch: vi.fn(),
  isFetching: false,
};

const printJobState: { printJob: unknown } = { printJob: null };

vi.mock("@/produksjon/features/produksjonsplan/hooks/useProductionPlan", () => ({
  useProductionPlan: () => planState,
}));
vi.mock("@/produksjon/features/produksjonsplan/hooks/usePrintJob", () => ({
  usePrintJob: () => ({
    printJob: printJobState.printJob,
    confirmPrint: null,
    preparingPrint: false,
    savingBaseline: false,
    printBusy: !!printJobState.printJob,
    startPrint: vi.fn(),
    confirmPrinted: vi.fn(),
    dismissConfirm: vi.fn(),
  }),
}));
vi.mock("@/produksjon/features/produksjonsplan/hooks/useTemplateCategories", () => ({
  useTemplateCategories: () => ({ data: [], isLoading: false }),
  useSaveTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/produksjon/features/produksjonsplan/hooks/useReferenceData", () => ({
  useMainCategories: () => ({ data: [], isLoading: false }),
  useSubCategories: () => ({ data: [], isLoading: false }),
}));
vi.mock("@/providers/SelectionProvider", () => ({
  useSelection: () => ({ legalEntityId: "le-1", departmentId: "d-1" }),
}));
vi.mock("@/hooks/useUiPreference", () => ({
  useUiPreference: <T,>(_k: string, fallback: T) => ({
    value: fallback,
    setValue: vi.fn(),
    isLoading: false,
  }),
}));
vi.mock("@/produksjon/features/produksjonsplan/components/ProductionPlanTable", () => ({
  ProductionPlanTable: ({ rows }: { rows: Array<{ product_name: string }> }) => (
    <div data-testid="plan-table">{rows.map((r) => r.product_name).join(",")}</div>
  ),
}));
vi.mock("@/produksjon/features/produksjonsplan/components/CorrectionPlanTable", () => ({
  CorrectionPlanTable: () => <div data-testid="correction-table" />,
}));
vi.mock("@/produksjon/features/produksjonsplan/components/SettKriteriaDialog", () => ({
  SettKriteriaDialog: () => null,
}));
vi.mock("@/produksjon/features/produksjonsplan/components/HentKriteriaDialog", () => ({
  HentKriteriaDialog: () => null,
}));
vi.mock("@/produksjon/features/produksjonsplan/components/SaveTemplateDialog", () => ({
  SaveTemplateDialog: () => null,
}));
vi.mock("@/produksjon/features/produksjonsplan/components/OverforePakkesystemDialog", () => ({
  OverforePakkesystemDialog: () => null,
}));

const ProduksjonsplanPage = (await import("@/produksjon/pages/ProduksjonsplanPage")).default;
const { buildPrintAttempt } = await import(
  "@/produksjon/features/produksjonsplan/lib/printAttempt"
);
const { DEFAULT_CRITERIA } = await import("@/produksjon/features/produksjonsplan/types");
const { DEFAULT_PRINT_PRODUKSJON_OPTIONS } = await import(
  "@/produksjon/features/produksjonsplan/components/PrintProduksjonslisteDialog"
);

type Row = Parameters<typeof buildPrintAttempt>[0]["rows"][number];
const row = (name: string): Row =>
  ({
    product_id: name,
    product_code: null,
    product_name: name,
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
    quantity_ordered: 3,
    quantity_from_stock: 0,
    quantity_to_produce: 3,
    trays_full: 0,
    trays_partial: 0,
    liters: null,
    on_stock: null,
    tour_number: null,
  }) as unknown as Row;

function frozenAttempt() {
  return buildPrintAttempt({
    attemptId: "attempt-1",
    legalEntityId: "le-1",
    dateStr: "2026-09-12",
    date: new Date("2026-09-12T00:00:00Z"),
    rows: [row("Grovbrød")],
    criteria: { ...DEFAULT_CRITERIA },
    counts: { fast: 1, datert: 1, pakkseddel: 0 },
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
    options: { ...DEFAULT_PRINT_PRODUKSJON_OPTIONS },
    now: new Date("2026-09-12T05:30:00Z"),
    prev: null,
    wantCorrection: false,
  });
}

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProduksjonsplanPage />
    </MemoryRouter>,
  );

describe("ProduksjonsplanPage – utskriftsområdet", () => {
  beforeEach(() => {
    planState.isError = false;
    planState.data = { rows: [row("Loff")], counts: { fast: 0, datert: 1, pakkseddel: 0 } };
    printJobState.printJob = null;
  });

  it("viser det frosne grunnlaget selv når planen feiler etterpå", () => {
    printJobState.printJob = frozenAttempt();
    planState.isError = true;
    planState.data = undefined;

    renderPage();

    const area = screen.getByTestId("print-area");
    expect(area).toHaveAttribute("data-print-date", "2026-09-12");
    expect(area.textContent).toContain("Grovbrød");
  });

  it("viser det frosne grunnlaget, ikke levende rader, mens utskriften pågår", () => {
    printJobState.printJob = frozenAttempt();
    planState.data = { rows: [row("Helt annen vare")], counts: null };

    renderPage();

    const area = screen.getByTestId("print-area");
    expect(area.textContent).toContain("Grovbrød");
    expect(area.textContent).not.toContain("Helt annen vare");
  });

  it("bruker levende data i utskriftsområdet når ingen utskrift pågår", () => {
    renderPage();
    const area = screen.getByTestId("print-area");
    expect(area.textContent).toContain("Loff");
  });
});
