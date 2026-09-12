import { describe, it, expect } from "vitest";

import { sanitizeEditorHref } from "@/ordre/lib/linkSanitize";

describe("sanitizeEditorHref", () => {
  it("godtar http, https, mailto og tel", () => {
    expect(sanitizeEditorHref("https://nbhub.no/varer")).toBe("https://nbhub.no/varer");
    expect(sanitizeEditorHref("http://nbhub.no/")).toBe("http://nbhub.no/");
    expect(sanitizeEditorHref("mailto:post@nbhub.no")).toBe("mailto:post@nbhub.no");
    expect(sanitizeEditorHref("tel:+4712345678")).toBe("tel:+4712345678");
  });

  it("antar https når brukeren limer inn bare et domene", () => {
    expect(sanitizeEditorHref("nbhub.no/priser")).toBe("https://nbhub.no/priser");
  });

  it("avviser skript- og datalenker", () => {
    expect(sanitizeEditorHref("javascript:alert(1)")).toBeNull();
    expect(sanitizeEditorHref("  JavaScript:alert(1)")).toBeNull();
    expect(sanitizeEditorHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(sanitizeEditorHref("vbscript:msgbox(1)")).toBeNull();
    expect(sanitizeEditorHref("java\u0000script:alert(1)")).toBeNull();
  });

  it("avviser tomt innhold", () => {
    expect(sanitizeEditorHref("")).toBeNull();
    expect(sanitizeEditorHref("   ")).toBeNull();
  });

  it("beholder interne stier, men ikke protokoll-relative", () => {
    expect(sanitizeEditorHref("/ordre/ordrer")).toBe("/ordre/ordrer");
    expect(sanitizeEditorHref("//evil.example")).toBeNull();
  });

  it("bevarer norske tegn i stien", () => {
    expect(sanitizeEditorHref("https://nbhub.no/søk?q=grovbrød")).toContain("s%C3%B8k");
  });
});
