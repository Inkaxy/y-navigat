import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  chunkComplete,
  nextCursor,
  pagesTruncated,
  planExistingUpdate,
  statusSummary,
  syncStatus,
  type ChunkResult,
} from "./syncState.ts";

const chunk = (p: Partial<ChunkResult> = {}): ChunkResult => ({
  from: "2026-01-01",
  to: "2026-02-01",
  failed: 0,
  truncated: false,
  ...p,
});

Deno.test("20 fulle sider regnes som ufullstendig henting", () => {
  assertEquals(pagesTruncated(20, 20, 1000, 1000), true);
  assertEquals(pagesTruncated(20, 20, 999, 1000), false);
  assertEquals(pagesTruncated(3, 20, 1000, 1000), false);
});

Deno.test("en bit er fullført kun uten feil og uten avkorting", () => {
  assertEquals(chunkComplete(chunk()), true);
  assertEquals(chunkComplete(chunk({ failed: 1 })), false);
  assertEquals(chunkComplete(chunk({ truncated: true })), false);
});

Deno.test("cursor stopper på første mislykkede bit", () => {
  const chunks = [
    chunk({ from: "2026-01-01", to: "2026-02-01" }),
    chunk({ from: "2026-02-01", to: "2026-03-01", failed: 2 }),
    chunk({ from: "2026-03-01", to: "2026-04-01" }),
  ];
  assertEquals(
    nextCursor(chunks, "2026-01-01", "2026-06-01", { isBackfill: false, hasExplicitFrom: false }),
    "2026-02-01",
  );
});

Deno.test("cursor stopper også ved ufullstendig henting", () => {
  const chunks = [chunk({ truncated: true })];
  assertEquals(nextCursor(chunks, null, "2026-06-01", { isBackfill: false, hasExplicitFrom: false }), null);
});

Deno.test("cursor flyttes ikke bakover, men korrigeres ned fra framtiden", () => {
  const chunks = [chunk({ to: "2026-02-01" })];
  assertEquals(nextCursor(chunks, "2026-05-01", "2026-06-01", { isBackfill: false, hasExplicitFrom: false }), null);
  assertEquals(
    nextCursor([chunk({ to: "2026-07-01" })], "2027-01-01", "2026-06-01", { isBackfill: false, hasExplicitFrom: false }),
    "2026-06-01",
  );
});

Deno.test("etterhenting og eksplisitt vindu rører aldri cursor", () => {
  const chunks = [chunk()];
  assertEquals(nextCursor(chunks, null, "2026-06-01", { isBackfill: true, hasExplicitFrom: false }), null);
  assertEquals(nextCursor(chunks, null, "2026-06-01", { isBackfill: false, hasExplicitFrom: true }), null);
});

Deno.test("status er ikke «success» når noe feilet eller manglet", () => {
  assertEquals(syncStatus([chunk()]), "success");
  assertEquals(syncStatus([chunk({ failed: 1 })]), "partial");
  assertEquals(syncStatus([chunk({ truncated: true })]), "partial");
  assertEquals(statusSummary([chunk()]), null);
  assertEquals(statusSummary([chunk({ failed: 3 })]), "3 fakturaer feilet");
  assertEquals(
    statusSummary([chunk({ truncated: true })]),
    "ufullstendig henting for 2026-01-01–2026-02-01",
  );
});

const existing = {
  id: "inv-1",
  invoice_date: "2026-01-05",
  total_amount: 1000,
  is_credit_note: false,
  tripletex_voucher_id: null,
  tripletex_voucher_number: null,
  tripletex_supplier_id: null,
  line_extraction_status: "not_requested",
};

Deno.test("eksisterende faktura får TT-felt uten at matching nullstilles", () => {
  const plan = planExistingUpdate(existing, {
    invoice_date: "2026-01-05",
    total_amount: 1000,
    is_credit_note: false,
    tripletex_voucher_id: "v1",
    tripletex_voucher_number: "42",
    tripletex_supplier_id: "s9",
  }, { trackLines: true });
  assertEquals(plan.patch, {
    tripletex_voucher_id: "v1",
    tripletex_voucher_number: "42",
    tripletex_supplier_id: "s9",
    line_extraction_status: "pending",
  });
  assertEquals(plan.conflicts.length, 0);
});

Deno.test("avvik i beløp, dato og kreditnota rapporteres som konflikt, ikke overskriving", () => {
  const plan = planExistingUpdate(existing, {
    invoice_date: "2026-01-09",
    total_amount: -1200,
    is_credit_note: true,
    tripletex_voucher_id: null,
    tripletex_voucher_number: null,
    tripletex_supplier_id: null,
  }, { trackLines: false });
  assertEquals(Object.keys(plan.patch).length, 0);
  assertEquals(plan.conflicts.map((c) => c.field).sort(), ["invoice_date", "is_credit_note", "total_amount"]);
});

// Simulert API: to biter, feil i den første. Kjøringen skal rapportere «partial»
// og la cursor stå igjen på starten av den mislykkede perioden.
Deno.test("simulert kjøring: feil i første bit gir partial og uendret cursor", async () => {
  const pages: Record<string, unknown[][]> = {
    "2026-01-01": [[{ id: 1, bad: true }]],
    "2026-02-01": [[{ id: 2 }]],
  };
  const fetchPage = (from: string) => Promise.resolve({ values: pages[from][0] });

  const results: ChunkResult[] = [];
  for (const from of ["2026-01-01", "2026-02-01"]) {
    const res = await fetchPage(from);
    let failed = 0;
    for (const inv of res.values as Record<string, unknown>[]) {
      if (inv.bad) failed++;
    }
    results.push({ from, to: from === "2026-01-01" ? "2026-02-01" : "2026-03-01", failed, truncated: false });
  }

  assertEquals(syncStatus(results), "partial");
  assertEquals(nextCursor(results, null, "2026-06-01", { isBackfill: false, hasExplicitFrom: false }), null);
});
