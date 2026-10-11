// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { deliverySteps, nextInvoiceStep, type NextStepInput } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
import { normalizePriskontrollSearch, parseVisning, fakturaBackHref } from "@/ravarer/pages/priskontroll/fakturaer/visning";
import { chipCount } from "@/ravarer/pages/priskontroll/fakturaer/VisningChips";
import { matchesSearch, parseFilters, toCsv } from "@/ravarer/pages/priskontroll/fakturaer/fakturaListLogic";
import { workspaceKey, type WorkspaceKeys } from "@/ravarer/pages/priskontroll/faktura/useWorkspaceHotkeys";
import { paths } from "@/ravarer/lib/paths";
import type { InboxInvoice } from "@/fakturaer/hooks/useInboxInvoices";

import type { DeliveryInvoice } from "@/ravarer/pages/priskontroll/faktura/invoiceSteps";
const base: DeliveryInvoice = { status: "needs_review", received_at: "2026-10-01", line_count: 3, lines_source: "pdf_extracted", line_extraction_status: "done", open_count: 0, lines_sum_status: "ok", reconciled_mode: null };
const done = (inv: typeof base, ex = { approved: false, costPosted: false }) => deliverySteps(inv, ex).filter((s) => s.done).map((s) => s.key);

describe("deliverySteps", () => {
  it("mottatt alltid, lest når linjer finnes", () => {
    expect(done({ ...base, line_count: 0, line_extraction_status: "pending", open_count: 0 })).toEqual(["mottatt"]);
  });
  it("manuell linjekilde teller som lest", () => {
    expect(done({ ...base, line_count: 0, lines_source: "manual" })).toContain("lest");
  });
  it("kontrollert krever ingen åpne linjer og sum ok", () => {
    expect(done({ ...base, open_count: 1 })).not.toContain("kontrollert");
    expect(done({ ...base, lines_sum_status: "mismatch" })).not.toContain("kontrollert");
    expect(done({ ...base, lines_sum_status: null })).not.toContain("kontrollert");
    expect(done(base)).toContain("kontrollert");
  });
  it("avstemt, godkjent og kostpris", () => {
    const steps = deliverySteps({ ...base, status: "reconciled", reconciled_mode: "auto" }, { approved: true, costPosted: true });
    expect(steps.every((s) => s.done)).toBe(true);
    expect(steps.find((s) => s.key === "avstemt")?.detail).toBe("Avstemt automatisk");
  });
});

const ni = (o: Partial<NextStepInput>): NextStepInput => ({
  ...base, approved: false, costPosted: false, source: "tripletex", canReconcile: true, reconcileBlockedReason: null,
  canWrite: true, canReconcileRight: true, canApprove: true, ...o,
});

describe("nextInvoiceStep", () => {
  it("følger leveransen steg for steg", () => {
    expect(nextInvoiceStep(ni({ line_count: 0, line_extraction_status: "pending" })).key).toBe("hent_linjer");
    expect(nextInvoiceStep(ni({ line_count: 0, source: "manual", lines_source: null })).key).toBe("registrer_linjer");
    expect(nextInvoiceStep(ni({ lines_sum_status: "mismatch", open_count: 2 })).key).toBe("rett_sum");
    expect(nextInvoiceStep(ni({ open_count: 2 })).label).toBe("Avklar 2 linjer");
    expect(nextInvoiceStep(ni({})).key).toBe("kostpris");
    expect(nextInvoiceStep(ni({ costPosted: true })).key).toBe("avstem");
    expect(nextInvoiceStep(ni({ status: "reconciled", costPosted: true })).key).toBe("godkjenn");
    expect(nextInvoiceStep(ni({ status: "reconciled", approved: true })).key).toBe("ferdig");
    const f = nextInvoiceStep(ni({ status: "reconciled", approved: true, costPosted: true }));
    expect([f.key, f.enabled]).toEqual(["ferdig", false]);
  });
  it("sperrer uten rettigheter", () => {
    expect(nextInvoiceStep(ni({ costPosted: true, canReconcile: false, reconcileBlockedReason: "x" })).enabled).toBe(false);
    expect(nextInvoiceStep(ni({ status: "reconciled", canApprove: false })).enabled).toBe(false);
  });
  it("flagget faktura: fjern flagg først", () => {
    expect(nextInvoiceStep(ni({ status: "flagged" })).key).toBe("flagget");
  });
});

describe("hurtigfiltre og gamle parametre", () => {
  const v = (s: string) => parseVisning(new URLSearchParams(s));
  it("standard er «Trenger meg»", () => expect(v("fane=fakturaer").visning).toBe("trenger"));
  it("gamle innboksfaner mappes", () => {
    expect(v("visning=innboks").visning).toBe("trenger");
    expect(v("visning=innboks&innboks=klar").visning).toBe("klar");
    expect(v("innboks=fullfort").visning).toBe("avstemt");
    expect(v("visning=alle").visning).toBe("alle");
    expect(v("visning=avstemt&modus=auto").modus).toBe("auto");
    expect(v("visning=alle&modus=auto").modus).toBeNull();
  });
  it("normaliserer URL-er", () => {
    expect(normalizePriskontrollSearch("?fane=fakturaer&visning=innboks&faktura=abc")).toBe("/ravarer/priskontroll/faktura/abc");
    expect(normalizePriskontrollSearch("?fane=fakturaer&visning=innboks&innboks=klar&q=x")).toBe("/ravarer/priskontroll?fane=fakturaer&visning=klar&q=x");
    expect(normalizePriskontrollSearch("?fane=fakturaer&visning=alle")).toBeNull();
    expect(normalizePriskontrollSearch("?fane=gjore")).toBeNull();
  });
  it("stibyggere peker på ny form", () => {
    expect(paths.fakturaInnboks({ innboks: "klar" })).toBe("/ravarer/priskontroll?fane=fakturaer&visning=klar");
    expect(paths.importFaktura({ tab: "pdf" })).toBe("/ravarer/priskontroll?importer=pdf");
  });
  it("tilbake-lenken godtar bare spørrestreng", () => {
    expect(fakturaBackHref("?fane=fakturaer&visning=klar")).toBe("/ravarer/priskontroll?fane=fakturaer&visning=klar");
    expect(fakturaBackHref("//evil.com")).toBe("/ravarer/priskontroll?fane=fakturaer");
    expect(fakturaBackHref(null)).toBe("/ravarer/priskontroll?fane=fakturaer");
  });
  it("tall per chip", () => {
    expect(chipCount("trenger", { trenger: 3, inv: null, alle: null })).toBe(3);
    expect(chipCount("klar", { klar: 2, inv: null, alle: null })).toBe(2);
    expect(chipCount("alle", { inv: null, alle: 12 })).toBe(12);
  });
});

const row = (o: Partial<InboxInvoice>): InboxInvoice => ({
  id: "i", invoice_number: "526301", invoice_date: "2026-10-01", received_at: "2026-10-02T10:00:00Z", due_date: null, status: "needs_review",
  legal_entity_id: "le", supplier_id: "s", supplier_name: "A/S Pals", is_credit_note: false, total_amount: 1234.5, total_vat: 0,
  lines_sum_status: "ok", lines_sum_variance_pct: 0, source_document_url: null, line_extraction_status: "done", source: "tripletex", notes: null,
  paid_at: null, tripletex_is_paid: false, line_extraction_attempts: 1, line_extraction_error: null, extraction_confidence: 0.9, reconciled_mode: null,
  lines_source: "pdf_extracted", tripletex_voucher_number: "B-77", line_count: 2,
  assessment: { issues: [], unmatchedCount: 0, reviewCount: 0, varianceCount: 0, openCount: 0, doneCount: 2, canReconcile: true, reconcileBlockedReason: null },
  tab: "ready", ...o,
});

describe("liste: filtre og CSV", () => {
  it("søk på leverandør, fakturanr og bilagsnr", () => {
    expect(matchesSearch(row({}), "pals")).toBe(true);
    expect(matchesSearch(row({}), "b-77")).toBe(true);
    expect(matchesSearch(row({}), "zzz")).toBe(false);
  });
  it("filtre leses fra adressen", () => {
    const f = parseFilters(new URLSearchParams("avvik=1&lav=1&betalt=ubetalt"));
    expect([f.avvik, f.lavSikkerhet, f.betalt]).toEqual([true, true, "ubetalt"]);
  });
  it("CSV med norske kolonner og verdier", () => {
    const csv = toCsv([row({})]);
    expect(csv.split("\n")[0]).toContain("Leverandør;Fakturanr;Bilagsnr");
    expect(csv).toContain("Krever gjennomgang");
    expect(csv).toContain("Nei");
  });
});

describe("hurtigtaster i arbeidsflaten", () => {
  const k = (over: Partial<WorkspaceKeys> = {}) => {
    const calls: string[] = [];
    const h: WorkspaceKeys = {
      enabled: true, canWrite: true, activeLine: null, next: () => calls.push("next"), prev: () => calls.push("prev"), enter: () => calls.push("enter"),
      editMaterial: () => calls.push("m"), create: () => calls.push("n"), notItem: () => calls.push("x"), undo: () => calls.push("u"),
      toggleDoc: () => calls.push("d"), escape: () => calls.push("esc"), help: () => calls.push("?"), ...over,
    };
    return { h, calls };
  };
  it("J/K, U, D, ? og Esc", () => {
    const { h, calls } = k();
    for (const key of ["j", "k", "u", "d", "?", "Escape"]) workspaceKey(new KeyboardEvent("keydown", { key }), h);
    expect(calls).toEqual(["next", "prev", "u", "d", "?", "esc"]);
  });
  it("M/N/X krever valgt linje, og ingenting når av", () => {
    const { h, calls } = k();
    expect(workspaceKey(new KeyboardEvent("keydown", { key: "m" }), h)).toBe(false);
    const off = k({ enabled: false });
    workspaceKey(new KeyboardEvent("keydown", { key: "j" }), off.h);
    expect([calls, off.calls]).toEqual([[], []]);
  });
});
