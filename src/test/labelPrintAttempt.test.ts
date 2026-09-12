import { describe, expect, it, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const { buildLabelPrintAttempt, submitLabelPrintAttempt, attemptNumbers } = await import(
  "@/produksjon/features/etiketter/lib/labelPrintAttempt"
);

type Unit = Parameters<typeof buildLabelPrintAttempt>[0]["units"][number];

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
    order_line_id: `ol-${number}`,
    unit_index: null,
    note_text: null,
    status: "reserved",
    first_printed_at: null,
    print_count: 0,
  }) as Unit;

const base = {
  legalEntityId: "le-1",
  departmentId: "d-1",
  profileId: "pr-1",
  productId: "p-1",
};

describe("fryst utskriftsforsøk", () => {
  beforeEach(() => rpc.mockReset());

  it("fryser numrene og gir hver etikett en egen jobb-id", () => {
    const a = buildLabelPrintAttempt({ ...base, units: [unit(1), unit(2)] });
    expect(attemptNumbers(a)).toEqual([1, 2]);
    expect(new Set(a.units.map((u) => u.jobId)).size).toBe(2);
  });

  it("sender samme jobb-id på nytt ved gjentatt bekreftelse — teller ikke dobbelt", async () => {
    const a = buildLabelPrintAttempt({ ...base, units: [unit(1)] });
    rpc.mockResolvedValueOnce({ data: { counted: 1, already_logged: 0 }, error: null });
    rpc.mockResolvedValueOnce({ data: { counted: 0, already_logged: 1 }, error: null });

    const first = await submitLabelPrintAttempt(a, "printed");
    const second = await submitLabelPrintAttempt(a, "printed");

    expect(first.counted).toBe(1);
    expect(second.counted).toBe(0);
    expect(second.alreadyLogged).toBe(1);
    const jobs1 = (rpc.mock.calls[0][1] as { p_jobs: { job_id: string }[] }).p_jobs;
    const jobs2 = (rpc.mock.calls[1][1] as { p_jobs: { job_id: string }[] }).p_jobs;
    expect(jobs1).toEqual(jobs2);
  });

  it("bekreftelsen bruker det fryste settet, ikke et senere endret utvalg", async () => {
    const a = buildLabelPrintAttempt({ ...base, units: [unit(3), unit(4)] });
    rpc.mockResolvedValue({ data: { counted: 2, already_logged: 0 }, error: null });
    await submitLabelPrintAttempt(a, "printed");
    const jobs = (rpc.mock.calls[0][1] as { p_jobs: { label_unit_id: string }[] }).p_jobs;
    expect(jobs.map((j) => j.label_unit_id)).toEqual(["u-3", "u-4"]);
  });

  it("kaster når serveren avviser forsøket", async () => {
    const a = buildLabelPrintAttempt({ ...base, units: [unit(1)] });
    rpc.mockResolvedValue({ data: null, error: { message: "Mangler skriverettighet" } });
    await expect(submitLabelPrintAttempt(a, "printed")).rejects.toBeTruthy();
  });

  it("nekter å sende et tomt forsøk", async () => {
    const a = buildLabelPrintAttempt({ ...base, units: [] });
    await expect(submitLabelPrintAttempt(a, "printed")).rejects.toThrow(/ingen etikettnumre/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("logger mislykket utskrift uten å telle", async () => {
    const a = buildLabelPrintAttempt({ ...base, units: [unit(1)] });
    rpc.mockResolvedValue({ data: { counted: 0, already_logged: 0 }, error: null });
    const res = await submitLabelPrintAttempt(a, "failed");
    expect(res.counted).toBe(0);
    expect((rpc.mock.calls[0][1] as { p_status: string }).p_status).toBe("failed");
  });
});
