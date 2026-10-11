import { describe, expect, it, vi } from "vitest";
import { settleManualSave } from "@/fakturaer/lib/manualPdfSave";

const ok = { ok: true, invoice_id: "i1", supplier_id: "s1", replayed: false, lines: 3, status: "imported", match_queued: true };

async function run(resp: () => Promise<{ data: unknown; error: unknown }>, uploaded: string | null = "le/new.pdf") {
  const remove = vi.fn(async () => {});
  const out = await settleManualSave(resp, uploaded, remove);
  return { out, remove };
}

describe("settleManualSave – PDF slettes bare ved sikker avvisning", () => {
  it("eksplisitt kjent avvisning sletter opplastingen", async () => {
    const { out, remove } = await run(async () => ({ data: { ok: false, code: "duplikat", invoice_id: "x" }, error: null }));
    expect(out).toEqual({ kind: "rejected", code: "duplikat", removedUpload: true });
    expect(remove).toHaveBeenCalledWith("le/new.pdf");
  });
  it.each([
    ["null-svar", async () => ({ data: null, error: null })],
    ["ugyldig 2xx", async () => ({ data: "<html>", error: null })],
    ["ok uten felter", async () => ({ data: { ok: true }, error: null })],
    ["ok:false ukjent kode", async () => ({ data: { ok: false, code: "noe_nytt" }, error: null })],
    ["mangler ok-felt", async () => ({ data: { code: "duplikat" }, error: null })],
    ["rpc-feil", async () => ({ data: null, error: { message: "timeout" } })],
    ["nettverk kaster", async () => { throw new TypeError("Failed to fetch"); }],
  ])("%s → ukjent utfall, ingen sletting", async (_n, resp) => {
    const { out, remove } = await run(resp);
    expect(out).toEqual({ kind: "unknown" });
    expect(remove).not.toHaveBeenCalled();
  });
  it("gyldig replay er lagret og sletter ingenting", async () => {
    const { out, remove } = await run(async () => ({ data: { ...ok, replayed: true, match_queued: true }, error: null }), null);
    expect(out.kind).toBe("committed");
    if (out.kind === "committed") { expect(out.result.replayed).toBe(true); expect(out.result.matchQueued).toBe(true); }
    expect(remove).not.toHaveBeenCalled();
  });
  it("avvisning uten ny opplasting (gjenbrukt sti) sletter ikke", async () => {
    const { out, remove } = await run(async () => ({ data: { ok: false, code: "duplikat" }, error: null }), null);
    expect(out).toEqual({ kind: "rejected", code: "duplikat", removedUpload: false });
    expect(remove).not.toHaveBeenCalled();
  });
});
