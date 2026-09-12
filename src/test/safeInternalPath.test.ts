/**
 * Tester mot react-router-varselet GHSA-wrjc-x8rr-h8h6: en angriperstyrt
 * navigasjonssti skal aldri kunne sende brukeren til en ekstern vert.
 */
import { describe, it, expect } from "vitest";

import { resolveInternalPath } from "@/lib/safeInternalPath";

describe("resolveInternalPath", () => {
  it("godtar vanlige interne stier med query og fragment", () => {
    expect(resolveInternalPath("/ordre/ordrer")).toBe("/ordre/ordrer");
    expect(resolveInternalPath("/ordre/ordrer?deliveryFrom=2026-09-12")).toBe(
      "/ordre/ordrer?deliveryFrom=2026-09-12",
    );
    expect(resolveInternalPath("/varer/vareliste#topp")).toBe("/varer/vareliste#topp");
  });

  it("avviser protokoll-relative mål", () => {
    expect(resolveInternalPath("//evil.example")).toBeNull();
    expect(resolveInternalPath("///evil.example")).toBeNull();
  });

  it("avviser backslash-varianten fra varselet", () => {
    expect(resolveInternalPath("/\\evil.example")).toBeNull();
    expect(resolveInternalPath("/\\/evil.example")).toBeNull();
    expect(resolveInternalPath("/ordre\\..\\evil")).toBeNull();
  });

  it("avviser absolutte og skjemabaserte adresser", () => {
    expect(resolveInternalPath("https://evil.example")).toBeNull();
    expect(resolveInternalPath("javascript:alert(1)")).toBeNull();
    expect(resolveInternalPath("data:text/html,<script>")).toBeNull();
    expect(resolveInternalPath("/https://evil.example")).toBeNull();
  });

  it("avviser relative stier, tomt og kontrolltegn", () => {
    expect(resolveInternalPath("ordre/ordrer")).toBeNull();
    expect(resolveInternalPath("")).toBeNull();
    expect(resolveInternalPath("   ")).toBeNull();
    expect(resolveInternalPath(null)).toBeNull();
    expect(resolveInternalPath(undefined)).toBeNull();
    expect(resolveInternalPath("/ordre\nhttps://evil.example")).toBeNull();
    expect(resolveInternalPath("/\u0000/ordre")).toBeNull();
  });

  it("normaliserer uten å bytte vert", () => {
    expect(resolveInternalPath(" /ordre/ordrer ")).toBe("/ordre/ordrer");
    expect(resolveInternalPath("/ordre/../varer")).toBe("/varer");
  });
});

describe("normalisert resultat kan ikke bli protokoll-relativt", () => {
  it("avviser /ordre/..//evil.example", () => {
    expect(resolveInternalPath("/ordre/..//evil.example")).toBeNull();
  });

  it("avviser prosentkodet variant /ordre/%2e%2e//evil.example", () => {
    expect(resolveInternalPath("/ordre/%2e%2e//evil.example")).toBeNull();
  });

  it("avviser flere nivåer som ender protokoll-relativt", () => {
    expect(resolveInternalPath("/ordre/a/../..//evil.example")).toBeNull();
    expect(resolveInternalPath("/ordre/%2E%2E//evil.example")).toBeNull();
  });

  it("godtar vanlig opptrinn som blir en ekte intern rute", () => {
    expect(resolveInternalPath("/ordre/../varer")).toBe("/varer");
    expect(resolveInternalPath("/ordre/ordrer/../nye?fane=alle")).toBe("/ordre/nye?fane=alle");
  });
});
