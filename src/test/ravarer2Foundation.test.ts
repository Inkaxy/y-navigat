// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_KIND_LABELS, FALLBACK_LABEL, INVOICE_STATUS_LABELS, LINE_KIND_LABELS, NEGOTIATION_STATUS_LABELS,
  PRICE_SOURCE_LABELS, REVIEW_REASON_LABELS, SUPPLIER_ITEM_STATUS_LABELS, WORK_GROUP_LABELS, WORK_KIND_LABELS,
  invoiceStatusLabel, labelFor,
} from "@/ravarer/lib/labels";
import { DERIVED_REASON_CODES, LINE_REASON_CODES } from "@/fakturaer/lib/reviewReasons";
import { SUPPLIER_ITEM_STATUSES } from "@/fakturaer/lib/supplierItems";
import { ACTIVITY_KINDS, WORK_GROUPS, WORK_KINDS } from "@/ravarer/lib/workRpcTypes";
import { parseWorkSummary, parseWorkItems, parseAcceptPrice } from "@/ravarer/lib/workRpc";
import { matchBinding, shouldIgnoreShortcut } from "@/ravarer/ui/hotkeys";
import { activeTabFrom, nextTabSearch, stepTab } from "@/ravarer/ui/sectionTabsLogic";
import { sortRows, stepRow, toggleSelection } from "@/ravarer/ui/dataTableLogic";
import { paths } from "@/ravarer/lib/paths";

const has = (map: Record<string, { label: string }>, codes: readonly string[]) => {
  for (const c of codes) {
    expect(map[c]?.label, c).toBeTruthy();
    expect(map[c].label).not.toBe(c);
  }
};

describe("etikettkilden", () => {
  it("alle kjente koder har norsk etikett", () => {
    has(SUPPLIER_ITEM_STATUS_LABELS, SUPPLIER_ITEM_STATUSES);
    has(WORK_GROUP_LABELS, WORK_GROUPS);
    has(WORK_KIND_LABELS, WORK_KINDS);
    has(REVIEW_REASON_LABELS, [...LINE_REASON_CODES, ...DERIVED_REASON_CODES, "start_price"]);
    has(INVOICE_STATUS_LABELS, ["imported", "needs_review", "ready", "reconciled", "flagged", "cancelled"]);
    has(PRICE_SOURCE_LABELS, ["agreement", "start_price", "last_purchase", "conflict", "none"]);
    has(LINE_KIND_LABELS, ["vare", "frakt", "gebyr", "rabatt", "avrunding"]);
    has(NEGOTIATION_STATUS_LABELS, ["draft", "in_progress", "concluded", "cancelled"]);
    has(ACTIVITY_KIND_LABELS, ACTIVITY_KINDS);
  });
  it("ukjent kode gir pen fallback, aldri rå kode", () => {
    expect(labelFor(REVIEW_REASON_LABELS, "helt_ukjent").label).toBe(FALLBACK_LABEL);
    expect(labelFor(REVIEW_REASON_LABELS, null).label).toBe(FALLBACK_LABEL);
    expect(invoiceStatusLabel("rar_status").label).toBe("Ukjent status");
    expect(invoiceStatusLabel("reconciled", "auto").label).toBe("Avstemt automatisk");
  });
});

describe("parse av arbeidsoppslag", () => {
  it("uten fakturatilgang er fakturadelene null", () => {
    const s = parseWorkSummary({ invoice_access: false, invoices: { open_total: 4 }, todo_total: 9, data_quality: { missing_package: 2 } });
    expect(s.invoices).toBeNull();
    expect(s.todo_total).toBeNull();
    expect(s.data_quality.missing_package).toBe(2);
    expect(s.data_quality.missing_nutrition).toBe(0);
  });
  it("manglende tellernøkler blir 0 og ugyldige rader forkastes", () => {
    const r = parseWorkItems({ total: 2, counts: { alle: 2 }, items: [{ key: "a", grp: "pris", kind: "prisavvik", title: "Mel" }, { key: "b", grp: "x", kind: "y" }] });
    expect(r.counts.kobling).toBe(0);
    expect(r.items).toHaveLength(1);
  });
  it("ukjent hopp-årsak blir «feil»", () => {
    const r = parseAcceptPrice({ ok: true, skipped_lines: [{ id: "l1", reason: "noe" }] });
    expect(r.skipped_lines[0].reason).toBe("feil");
  });
});

describe("hurtigtastvakt", () => {
  const ev = (key: string, target: HTMLElement, mods: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent("keydown", { key, ...mods });
    Object.defineProperty(e, "target", { value: target });
    return e;
  };
  it("ignorerer felt, dialoger og modifikatortaster", () => {
    expect(shouldIgnoreShortcut(ev("j", document.createElement("input")))).toBe(true);
    expect(shouldIgnoreShortcut(ev("j", document.createElement("textarea")))).toBe(true);
    const dlg = document.createElement("div"); dlg.setAttribute("role", "dialog");
    const inner = document.createElement("span"); dlg.appendChild(inner);
    expect(shouldIgnoreShortcut(ev("j", inner))).toBe(true);
    expect(shouldIgnoreShortcut(ev("j", document.body, { metaKey: true }))).toBe(true);
    expect(shouldIgnoreShortcut(ev("j", document.body))).toBe(false);
  });
  it("finner binding uavhengig av store/små bokstaver", () => {
    const b = [{ keys: ["j"], description: "x", handler: () => undefined }];
    expect(matchBinding(b, "J")).toBe(b[0]);
    expect(matchBinding(b, "k")).toBeNull();
  });
});

describe("SectionTabs-URL", () => {
  it("leser aktiv fane med fallback", () => {
    expect(activeTabFrom(new URLSearchParams("fane=saker"), "fane", ["gjore", "saker"], "gjore")).toBe("saker");
    expect(activeTabFrom(new URLSearchParams("fane=tull"), "fane", ["gjore", "saker"], "gjore")).toBe("gjore");
  });
  it("bevarer andre parametre, nullstiller valgt og fjerner fane-parametre", () => {
    const n = nextTabSearch(new URLSearchParams("fane=gjore&valgt=1&q=mel&status=ukoblet"), "fane", "saker", { fallback: "gjore", clear: ["status"] });
    expect(n.toString()).toBe("fane=saker&q=mel");
    expect(nextTabSearch(new URLSearchParams("fane=saker"), "fane", "gjore", { fallback: "gjore" }).toString()).toBe("");
  });
  it("piltaster går rundt", () => {
    expect(stepTab(["a", "b", "c"], "c", 1)).toBe("a");
    expect(stepTab(["a", "b", "c"], "a", -1)).toBe("c");
  });
});

describe("DataTable-logikk", () => {
  it("sorterer med tomme verdier sist", () => {
    const rows = [{ v: 2 }, { v: null }, { v: 1 }];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([1, 2, null]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([2, 1, null]);
  });
  it("shift-klikk velger et område", () => {
    const s = toggleSelection(["a", "b", "c", "d"], new Set(["a"]), "c", "a", true);
    expect([...s].sort()).toEqual(["a", "b", "c"]);
  });
  it("J/K stopper i endene", () => {
    expect(stepRow(["a", "b"], "b", 1)).toBe("b");
    expect(stepRow(["a", "b"], null, 1)).toBe("a");
  });
});

describe("stibygger", () => {
  it("bygger nye stier", () => {
    expect(paths.raavare("x", { tab: "suppliers" })).toBe("/ravarer/varer/x?tab=suppliers");
    expect(paths.fakturaInnboks({ faktura: "f" })).toBe("/ravarer/priskontroll?fane=fakturaer&visning=innboks&faktura=f");
    expect(paths.innstillinger({ seksjon: "ai" })).toBe("/ravarer/innstillinger?seksjon=ai");
  });
});
