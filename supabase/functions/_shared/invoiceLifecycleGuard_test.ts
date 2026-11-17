import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { invoiceLifecycle, type LifecycleReader } from "./invoiceLifecycleGuard.ts";

const reader = (rows: { id: string }[] | null, error: string | null = null, calls = { n: 0 }): LifecycleReader => ({
  activeApproval: () => { calls.n++; return Promise.resolve({ data: rows, error: error ? { message: error } : null }); },
});
const open = { id: "i", status: "needs_review", excluded_at: null };

Deno.test("åpen faktura uten godkjenning kjører", async () => {
  assertEquals((await invoiceLifecycle(open, reader([]))).kind, "open");
});
Deno.test("aktiv godkjenning låser", async () => {
  assertEquals(await invoiceLifecycle(open, reader([{ id: "a" }])), { kind: "locked", reason: "internally_approved", status: "needs_review" });
});
Deno.test("endelig status og utelatt låser uten å lese godkjenning", async () => {
  for (const s of ["flagged", "reconciled", "cancelled", "excluded"]) {
    const c = { n: 0 };
    assertEquals((await invoiceLifecycle({ ...open, status: s }, reader([], null, c))).kind, "locked");
    assertEquals(c.n, 0);
  }
  assertEquals((await invoiceLifecycle({ ...open, excluded_at: "2026-10-01" }, reader([]))).kind, "locked");
});
Deno.test("lesefeil er fail-closed", async () => {
  assertEquals((await invoiceLifecycle(open, reader(null, "boom"))).kind, "error");
  assertEquals((await invoiceLifecycle(open, reader(null))).kind, "error");
  const throwing: LifecycleReader = { activeApproval: () => Promise.reject(new Error("net")) };
  assertEquals((await invoiceLifecycle(open, throwing)).kind, "error");
});
Deno.test("manglende eller ukjent status sperres uten å lese godkjenning; åpne statuser kjører", async () => {
  for (const s of [null, "", "draft", "NEEDS_REVIEW", "paid"]) {
    const c = { n: 0 };
    assertEquals(await invoiceLifecycle({ ...open, status: s }, reader([], null, c)), { kind: "locked", reason: "status_unknown", status: s === "" ? "" : s });
    assertEquals(c.n, 0);
  }
  for (const s of ["imported", "needs_review", "ready"]) assertEquals((await invoiceLifecycle({ ...open, status: s }, reader([]))).kind, "open");
  assertEquals((await invoiceLifecycle({ ...open, status: "ready" }, reader(null, "boom"))).kind, "error");
});

import { approvedLinesOnlyAllowed, isFreshManualLink } from "./invoiceLifecycleGuard.ts";
const approved = { kind: "locked", reason: "internally_approved", status: "needs_review" } as const;
Deno.test("godkjent faktura: linjeomregning bare med linjeutvalg og bekreftet markør", () => {
  assertEquals(approvedLinesOnlyAllowed(approved, ["l1"], true), true);
  assertEquals(approvedLinesOnlyAllowed(approved, ["l1"], null), false);
  assertEquals(approvedLinesOnlyAllowed(approved, ["l1"], false), false);
  assertEquals(approvedLinesOnlyAllowed(approved, [], true), false);
  assertEquals(approvedLinesOnlyAllowed(approved, undefined, true), false);
  assertEquals(approvedLinesOnlyAllowed(approved, "l1", true), false);
});
Deno.test("avstemt, utelatt, ukjent status og åpen faktura gir aldri unntaket", () => {
  for (const reason of ["excluded", "final_status", "status_unknown"] as const) {
    assertEquals(approvedLinesOnlyAllowed({ kind: "locked", reason, status: "reconciled" }, ["l1"], true), false);
  }
  assertEquals(approvedLinesOnlyAllowed({ kind: "open" }, ["l1"], true), false);
  assertEquals(approvedLinesOnlyAllowed({ kind: "error", message: "x" }, ["l1"], true), false);
});
Deno.test("bare nettopp manuelt koblede linjer omregnes", () => {
  assertEquals(isFreshManualLink({ match_confidence: "manual", review_reason: "recalculation_pending" }), true);
  assertEquals(isFreshManualLink({ match_confidence: "manual", review_reason: "unknown_package_size, recalculation_pending" }), true);
  assertEquals(isFreshManualLink({ match_confidence: "manual", review_reason: "price_variance" }), false);
  assertEquals(isFreshManualLink({ match_confidence: "auto_high", review_reason: "recalculation_pending" }), false);
  assertEquals(isFreshManualLink({ match_confidence: "manual", review_reason: null }), false);
});
