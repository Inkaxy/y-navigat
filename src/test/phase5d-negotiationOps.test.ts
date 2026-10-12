import { describe, expect, it, vi } from "vitest";
import {
  canReplaceNegotiationItems,
  classifyApplyOutcome,
  parseRfqCredentials,
  portalUrlFor,
  runPrimaryTasks,
  sameItemSet,
} from "@/ravarer/lib/negotiationOps";

const A = { id: "rA", supplier_id: "sA" };
const B = { id: "rB", supplier_id: "sB" };
const cred = (r: { id: string; supplier_id: string }, extra: Record<string, unknown> = {}) => ({
  recipient_id: r.id, supplier_id: r.supplier_id, supplier_name: r.id, contact_email: `${r.id}@x.test`,
  access_token: `tok-${r.id}`, password: `pw-${r.id}`, portal_url: `https://x/tilbud/tok-${r.id}`, ...extra,
});

describe("parseRfqCredentials", () => {
  it("binder til mottaker-ID uavhengig av rekkefølge", () => {
    for (const list of [[cred(A), cred(B)], [cred(B), cred(A)]]) {
      const p = parseRfqCredentials({ success: true, credentials: list }, [A, B]);
      expect(p.kind).toBe("ok");
      if (p.kind !== "ok") return;
      const b = p.byRecipient.get("rB")!;
      expect(b.password).toBe("pw-rB");
      expect(b.contact_email).toBe("rB@x.test");
      expect(portalUrlFor("https://o", "bekreftelse", b)).toBe("https://o/bekreftelse/tok-rB");
    }
  });
  it("manglende, duplisert, feil leverandør eller manglende token gir ugyldig – ingen fallback", () => {
    expect(parseRfqCredentials({ success: true, credentials: [cred(A)] }, [A, B]).kind).toBe("malformed");
    expect(parseRfqCredentials({ success: true, credentials: [cred(A), cred(A), cred(B)] }, [A, B]).kind).toBe("malformed");
    expect(parseRfqCredentials({ success: true, credentials: [cred(A), cred(B, { supplier_id: "sA" })] }, [A, B]).kind).toBe("malformed");
    expect(parseRfqCredentials({ success: true, credentials: [cred(A), cred(B, { access_token: undefined, portal_url: "https://x/tilbud/undefined" })] }, [A, B]).kind).toBe("malformed");
    expect(parseRfqCredentials({ success: true, credentials: [cred(A), cred(B), cred({ id: "rC", supplier_id: "sC" })] }, [A, B]).kind).toBe("malformed");
    expect(parseRfqCredentials({ error: "internal_error" }, [A, B]).kind).toBe("malformed");
  });
});

describe("classifyApplyOutcome", () => {
  it("suksess krever bare kontraktens felt", () => {
    expect(classifyApplyOutcome({ success: true, applied: 2 }, null).kind).toBe("success");
    expect(classifyApplyOutcome({}, null).kind).toBe("unknown");
  });
  it("500 med feil er delvis; applied-tallet brukes ikke", () => {
    const err = { context: { status: 500 } };
    const o = classifyApplyOutcome(null, err, { error: "x", failures: ["primær", "historikk"], applied: -1 });
    expect(o).toEqual({ kind: "partial", failures: ["primær", "historikk"], linksOpen: false });
  });
  it("avsluttet men lenker åpne skilles ut", () => {
    const o = classifyApplyOutcome(null, { context: { status: 500 } }, { error: "Forhandlingen er avsluttet, men lenkene ble ikke stengt" });
    expect(o).toEqual({ kind: "partial", failures: [], linksOpen: true });
  });
  it("4xx er avvisning, transportfeil er ukjent", () => {
    expect(classifyApplyOutcome(null, { context: { status: 403 } }, { error: "Mangler skrivetilgang" })).toEqual({ kind: "rejected", message: "Mangler skrivetilgang" });
    expect(classifyApplyOutcome(null, new Error("network")).kind).toBe("unknown");
  });
});

describe("runPrimaryTasks", () => {
  it("returnerer bare de som feilet, med eksakt identitet", async () => {
    const set = vi.fn(async (rm: string) => { if (rm === "m2") throw new Error("x"); });
    const { failed } = await runPrimaryTasks([{ rawMaterialId: "m1", supplierId: "s" }, { rawMaterialId: "m2", supplierId: "s" }], set);
    expect(failed).toEqual([{ rawMaterialId: "m2", supplierId: "s" }]);
    const again = await runPrimaryTasks(failed, vi.fn(async () => undefined));
    expect(again.failed).toEqual([]);
  });
});

describe("vareidentitet", () => {
  it("erstatning bare i ekte utkast uten utstedte lenker", () => {
    expect(canReplaceNegotiationItems("draft", [])).toBe(true);
    expect(canReplaceNegotiationItems("draft", [{ invited_at: "2026-10-01" }])).toBe(false);
    expect(canReplaceNegotiationItems("draft", [{ password_set_at: "2026-10-01" }])).toBe(false);
    expect(canReplaceNegotiationItems("invited", [])).toBe(false);
  });
  it("uendret utvalg (også omsortert) skriver ingenting", () => {
    expect(sameItemSet([{ raw_material_id: "a" }, { raw_material_id: "b" }], ["b", "a"])).toBe(true);
    expect(sameItemSet([{ raw_material_id: "a" }], ["a", "b"])).toBe(false);
  });
});
