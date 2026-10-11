import { describe, expect, it } from "vitest";
import { APPROVAL_BLOCKER_CODES, APPROVAL_BLOCKER_LABEL } from "@/ravarer/lib/labels";
import { approveMany, blockerLabel, type ApproveResult, type OverviewRow } from "@/fakturaer/lib/approval";
import { approvalReport, countByStatus, filterApprovalRows, parseGodkjenningStatus } from "@/ravarer/pages/priskontroll/godkjenning/approvalLogic";
import { caseSums, countSaker, isFollowUpDue, matchesSakFilter, parseSakFilter } from "@/ravarer/pages/priskontroll/saker/caseLogic";

const row = (p: Partial<OverviewRow>): OverviewRow => ({
  invoice_id: "i", invoice_number: "1", invoice_date: null, supplier_id: "s", supplier_name: "Lev", total_amount: 100, total_vat: 25,
  currency: "NOK", status: "reconciled", is_credit_note: false, approved_at: null, approved_by: null, blockers: [], open_material_lines: 0, cost_posted_lines: 0, ...p,
});

describe("blokkeringskoder", () => {
  it("alle koder fra invoice_approval_blockers har norsk etikett", () => {
    for (const c of APPROVAL_BLOCKER_CODES) {
      expect(APPROVAL_BLOCKER_LABEL[c]).toBeTruthy();
      expect(blockerLabel(c)).not.toBe("Kan ikke godkjennes ennå");
    }
  });
  it("ukjent kode gir pen fallback", () => expect(blockerLabel("x_y")).toBe("Kan ikke godkjennes ennå"));
});

describe("godkjenning — hurtigfiltre", () => {
  const rows = [
    row({ invoice_id: "a" }), row({ invoice_id: "b" }),
    row({ invoice_id: "c", blockers: ["sumavvik"] }), row({ invoice_id: "d", blockers: ["prisavvik"] }),
    row({ invoice_id: "e", approved_at: "2026-10-01T10:00:00Z" }),
  ];
  it("teller klare/avventer/godkjent/kostpris", () => expect(countByStatus(rows)).toEqual({ klare: 2, avventer: 2, godkjent: 1, kostpris: 1 }));
  it("mapper gamle statusverdier", () => {
    expect(parseGodkjenningStatus("waiting")).toBe("avventer");
    expect(parseGodkjenningStatus("done")).toBe("godkjent");
    expect(parseGodkjenningStatus(null)).toBe("klare");
  });
  it("filtrerer på leverandør og søk", () => {
    expect(filterApprovalRows(rows, { status: "klare", q: "", leverandor: "annen" })).toHaveLength(0);
    expect(filterApprovalRows(rows, { status: "klare", q: "lev", leverandor: null })).toHaveLength(2);
  });
});

describe("massegodkjenning", () => {
  it("fortsetter ved feil og rapporterer per faktura", async () => {
    const progress: number[] = [];
    const fake = async (id: string): Promise<ApproveResult> => {
      if (id === "b") throw new Error("nett");
      if (id === "c") return { invoiceId: id, ok: false, already: false, message: "Prisavvik er ikke avklart" };
      return { invoiceId: id, ok: true, already: id === "d", message: null };
    };
    const res = await approveMany(["a", "b", "c", "d"], null, fake, (d) => progress.push(d));
    expect(res.map((r) => r.ok)).toEqual([true, false, false, true]);
    expect(progress).toEqual([1, 2, 3, 4]);
    const rep = approvalReport(res, (id) => `F-${id}`);
    expect(rep.title).toBe("2 av 4 godkjent, 2 feilet");
    expect(rep.items).toContain("F-b: Kunne ikke godkjenne");
    expect(rep.items).toContain("F-c: Prisavvik er ikke avklart");
    expect(rep.items).toContain("1 var allerede godkjent");
  });
});

describe("leverandørsaker", () => {
  it("krav − kreditert = gjenstår", () => {
    const m = caseSums(
      [{ case_id: "x", amount_excl_vat: 100.1 }, { case_id: "x", amount_excl_vat: "50.2" }, { case_id: "y", amount_excl_vat: 10 }],
      [{ case_id: "x", amount_excl_vat: 40.15 }],
    );
    expect(m.get("x")).toEqual({ krav: 150.3, kreditert: 40.15, gjenstar: 110.15 });
    expect(m.get("y")).toEqual({ krav: 10, kreditert: 0, gjenstar: 10 });
    for (const s of m.values()) expect(Math.round((s.krav - s.kreditert) * 100) / 100).toBe(s.gjenstar);
  });
  it("oppfølging er passert bare for åpne saker", () => {
    expect(isFollowUpDue({ status: "open", follow_up_on: "2026-10-01" }, "2026-10-11")).toBe(true);
    expect(isFollowUpDue({ status: "resolved", follow_up_on: "2026-10-01" }, "2026-10-11")).toBe(false);
    expect(matchesSakFilter({ status: "cancelled", follow_up_on: null }, "avbrutt", "2026-10-11")).toBe(true);
    expect(parseSakFilter("tull")).toBe("apne");
    expect(countSaker([{ status: "open", follow_up_on: "2026-10-01" }, { status: "resolved", follow_up_on: null }, { status: "open", follow_up_on: null }], "2026-10-11"))
      .toEqual({ apne: 2, oppfolging: 1, lost: 1, avbrutt: 0, alle: 3 });
  });
});
