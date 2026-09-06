import { describe, expect, it } from "vitest";
import {
  emptyQueueState,
  peekUndo,
  queueReducer,
  type QueueLineSnapshot,
  type QueueState,
} from "@/fakturaer/lib/queueReducer";
import {
  allowedInvoiceActions,
  canDoInvoiceAction,
  canReplaceInvoiceLines,
  invoiceActionBlockedReason,
} from "@/fakturaer/lib/statusGuards";
import { resolveTolerance, FALLBACK_TOLERANCE_PCT } from "@/fakturaer/hooks/useMatchTolerances";
import { creditNoteOriginalRef } from "@/fakturaer/lib/inbox";

const snap: QueueLineSnapshot = {
  raw_material_id: null,
  match_confidence: null,
  requires_review: true,
  review_reason: "unmatched",
};

function stateWith(ids: string[], activeId: string | null): QueueState {
  return { ids, activeId, undo: [] };
}

describe("queueReducer", () => {
  it("synker liste og beholder aktiv linje når den fortsatt finnes", () => {
    const s1 = queueReducer(emptyQueueState, { type: "sync", ids: ["a", "b", "c"] });
    expect(s1.activeId).toBe("a");
    const s2 = queueReducer({ ...s1, activeId: "b" }, { type: "sync", ids: ["b", "c"] });
    expect(s2.activeId).toBe("b");
    const s3 = queueReducer(s2, { type: "sync", ids: ["c"] });
    expect(s3.activeId).toBe("c");
  });

  it("flytter markering opp og ned uten å gå utenfor listen", () => {
    let s = stateWith(["a", "b", "c"], "a");
    s = queueReducer(s, { type: "prev" });
    expect(s.activeId).toBe("a");
    s = queueReducer(s, { type: "next" });
    expect(s.activeId).toBe("b");
    s = queueReducer(s, { type: "next" });
    s = queueReducer(s, { type: "next" });
    expect(s.activeId).toBe("c");
  });

  it("går automatisk videre når en linje er behandlet", () => {
    let s = stateWith(["a", "b", "c"], "b");
    s = queueReducer(s, { type: "resolved", id: "b", snapshot: snap, label: "Hvetemel" });
    expect(s.ids).toEqual(["a", "c"]);
    expect(s.activeId).toBe("c");
    expect(peekUndo(s)?.label).toBe("Hvetemel");
  });

  it("velger siste linje når den behandlede var nederst", () => {
    let s = stateWith(["a", "b"], "b");
    s = queueReducer(s, { type: "resolved", id: "b", snapshot: snap, label: "x" });
    expect(s.activeId).toBe("a");
  });

  it("angrer og legger linjen tilbake på samme plass", () => {
    let s = stateWith(["a", "b", "c"], "b");
    s = queueReducer(s, { type: "resolved", id: "b", snapshot: snap, label: "x" });
    s = queueReducer(s, { type: "undo" });
    expect(s.ids).toEqual(["a", "b", "c"]);
    expect(s.activeId).toBe("b");
    expect(peekUndo(s)).toBeNull();
  });

  it("angre uten historikk gjør ingenting", () => {
    const s = stateWith(["a"], "a");
    expect(queueReducer(s, { type: "undo" })).toBe(s);
  });

  it("fokus på ukjent linje ignoreres", () => {
    const s = stateWith(["a"], "a");
    expect(queueReducer(s, { type: "focus", id: "z" })).toBe(s);
  });
});

describe("statusvern", () => {
  it("flagget faktura tillater bare å fjerne flagget", () => {
    expect(allowedInvoiceActions("flagged")).toEqual(["unflag"]);
    expect(canDoInvoiceAction("flagged", "match")).toBe(false);
    expect(canDoInvoiceAction("flagged", "unflag")).toBe(true);
    expect(invoiceActionBlockedReason("flagged", "reconcile")).toMatch(/flagget/i);
  });

  it("avstemt faktura tillater ingenting", () => {
    expect(allowedInvoiceActions("reconciled")).toEqual([]);
    expect(invoiceActionBlockedReason("reconciled", "match")).toMatch(/avstemt/i);
  });

  it("åpen faktura tillater hele arbeidsflyten", () => {
    for (const status of ["imported", "needs_review", "ready"]) {
      expect(canDoInvoiceAction(status, "match")).toBe(true);
      expect(canDoInvoiceAction(status, "reconcile")).toBe(true);
      expect(invoiceActionBlockedReason(status, "resolve")).toBeNull();
    }
  });

  it("linjer kan ikke erstattes når fakturaen har matcher eller er avstemt", () => {
    expect(canReplaceInvoiceLines({ status: "needs_review", matchedLineCount: 3 }).allowed).toBe(false);
    expect(canReplaceInvoiceLines({ status: "reconciled", matchedLineCount: 0 }).allowed).toBe(false);
    const ok = canReplaceInvoiceLines({ status: "imported", matchedLineCount: 0 });
    expect(ok.allowed).toBe(true);
    expect(ok.requiresConfirm).toBe(true);
  });
});

describe("resolveTolerance", () => {
  it("kategori slår global, global slår fallback", () => {
    expect(resolveTolerance("Mel", 3, { Mel: 8 })).toBe(8);
    expect(resolveTolerance("Smør", 3, { Mel: 8 })).toBe(3);
    expect(resolveTolerance(null, 3, {})).toBe(3);
    expect(resolveTolerance(null, null, {})).toBe(FALLBACK_TOLERANCE_PCT);
    expect(resolveTolerance("Mel", null, { Mel: Number.NaN })).toBe(FALLBACK_TOLERANCE_PCT);
  });

  it("null-toleranse på kategori faller tilbake på global", () => {
    expect(resolveTolerance("Mel", 4, {})).toBe(4);
    expect(resolveTolerance("Mel", 0, { Mel: 0 })).toBe(0);
  });
});

describe("creditNoteOriginalRef", () => {
  it("leser fakturanummeret fra notatet", () => {
    expect(creditNoteOriginalRef("Opprinnelig faktura: 12345")).toBe("12345");
    expect(creditNoteOriginalRef("Retur\nOpprinnelig faktura: A-77")).toBe("A-77");
  });

  it("gir null når koblingen mangler", () => {
    expect(creditNoteOriginalRef(null)).toBeNull();
    expect(creditNoteOriginalRef("Retur av varer")).toBeNull();
  });
});
