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
