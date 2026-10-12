import { describe, expect, it, vi } from "vitest";
import { attachmentHash, previewHash, runStoredSend } from "../../supabase/pending/functions/vt-count-report-email/reportCore";

const op = "00000000-0000-4000-8000-000000000001";
describe("vt-count-report-email lagret sending", () => {
  it("transport-uklar claim gir ukjent, ingen Graph-kall, ingen ferdigføring", async () => {
    const graphSend = vi.fn(async () => 202); const finish = vi.fn(async () => ({ error: null }));
    const r = await runStoredSend(op, { claim: async () => ({ data: null, error: { code: undefined } }), graphSend, finish });
    expect(r.body.state).toBe("ukjent"); expect(r.body.op_id).toBe(op);
    expect(String(r.body.detail)).not.toMatch(/ingenting er sendt|reservert/i);
    expect(graphSend).not.toHaveBeenCalled(); expect(finish).not.toHaveBeenCalled();
  });
  it("kjent avvisning påstår ikke at den lagrede sendingen aldri ble sendt", async () => {
    const graphSend = vi.fn(async () => 202);
    const r = await runStoredSend(op, { claim: async () => ({ data: null, error: { code: "42501" } }), graphSend, finish: async () => ({ error: null }) });
    expect(r.status).toBe(409); expect(String(r.body.error)).not.toMatch(/ingenting er sendt/i); expect(graphSend).not.toHaveBeenCalled();
  });
  it("forhåndsvisnings-hash endres når avsender byttes", async () => {
    const a = await attachmentHash("csv", "pdf");
    expect(await previewHash(a, "a@x.no")).not.toBe(await previewHash(a, "b@x.no"));
  });
});
