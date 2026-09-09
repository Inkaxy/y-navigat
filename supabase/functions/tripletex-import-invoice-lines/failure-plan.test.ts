import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { planLineExtractionFailure } from "./failure-plan.ts";

Deno.test("failure-plan: forsøk 3 gir failed + needs_review", () => {
  const result = planLineExtractionFailure({
    attempts: 3,
    message: "Tripletex 500: feil",
    status: "imported",
    pdfFail: false,
  });
  assertEquals(result.gaveOpp, true);
  assertEquals(result.patch.line_extraction_status, "failed");
  assertEquals(result.patch.status, "needs_review");
  assertEquals(result.patch.line_extraction_error, "Tripletex 500: feil");
});

Deno.test("failure-plan: forsøk 3 med pdfFail setter pdf_status failed", () => {
  const result = planLineExtractionFailure({
    attempts: 3,
    message: "Tom PDF",
    status: "needs_review",
    pdfFail: true,
  });
  assertEquals(result.patch.pdf_status, "failed");
  // status er allerede needs_review — skal ikke endres til noe annet uventet
  assertEquals(result.patch.status, "needs_review");
});

Deno.test("failure-plan: forsøk under grensen gir pending med tellertekst", () => {
  const result = planLineExtractionFailure({
    attempts: 1,
    message: "Nettverksfeil",
    status: "imported",
    pdfFail: false,
  });
  assertEquals(result.gaveOpp, false);
  assertEquals(result.patch.line_extraction_status, "pending");
  assertEquals(result.patch.line_extraction_error, "Forsøk 1/3: Nettverksfeil");
  assertEquals("status" in result.patch, false);
});
