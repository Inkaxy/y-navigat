import { describe, expect, it } from "vitest";
import { isLinkableOpenLine, lockedForLink, packageFixLocked } from "@/ravarer/lib/fraFaktura/linkOutcome";

// Henrik 17.11: kobling er lov på internt godkjente fakturaer; avstemt, flagget og ført kostpris er fortsatt låst.
const line = (o: Partial<{ requires_review: boolean; invoice_status: string; flagged_at: string | null; match_confidence: string | null; invoice_approved: boolean; cost_posted: boolean }>) => ({
  requires_review: true, invoice_status: "needs_review", flagged_at: null, match_confidence: "unmatched", invoice_approved: false, cost_posted: false, ...o,
});

describe("isLinkableOpenLine – samme utvalg som koblingen", () => {
  it("åpen linje på åpen faktura kan sendes", () => expect(isLinkableOpenLine(line({}))).toBe(true));
  it("avstemt faktura sendes aldri", () => expect(isLinkableOpenLine(line({ invoice_status: "reconciled" }))).toBe(false));
  it("flagget faktura sendes aldri", () => expect(isLinkableOpenLine(line({ flagged_at: "2026-11-17" }))).toBe(false));
  it("utelatt faktura sendes aldri", () => expect(isLinkableOpenLine(line({ invoice_status: "excluded" }))).toBe(false));
  it("«ikke vare» sendes aldri", () => expect(isLinkableOpenLine(line({ match_confidence: "not_applicable" }))).toBe(false));
  it("løst linje sendes aldri", () => expect(isLinkableOpenLine(line({ requires_review: false }))).toBe(false));
  it("internt godkjent faktura avgjøres ikke her", () => expect(isLinkableOpenLine(line({ invoice_approved: true }))).toBe(true));
});

describe("lockedForLink – godkjent låst bare til databasen godtar det", () => {
  it("godkjent + markør bekreftet = kan kobles", () => expect(lockedForLink("approved", true)).toBe(false));
  it("godkjent + markør ukjent = låst", () => expect(lockedForLink("approved", null)).toBe(true));
  it("ført kostpris er alltid låst", () => expect(lockedForLink("cost", true)).toBe(true));
});

describe("packageFixLocked – «Feil pakning» i Prishopp", () => {
  it("godkjent faktura, markør bekreftet: åpen", () => expect(packageFixLocked([line({ invoice_approved: true })], true)).toBe(false));
  it("godkjent faktura, markør ukjent: låst", () => expect(packageFixLocked([line({ invoice_approved: true })], null)).toBe(true));
  it("alle åpne linjer kostført: låst også med markør", () => expect(packageFixLocked([line({ cost_posted: true, invoice_approved: true })], true)).toBe(true));
  it("én linje kan tas: åpen", () => expect(packageFixLocked([line({ cost_posted: true }), line({})], null)).toBe(false));
});
