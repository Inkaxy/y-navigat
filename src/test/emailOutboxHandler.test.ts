import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyGraphSendResponse } from "../../supabase/functions/_shared/outboxOutcome.ts";

/**
 * Kjører den FAKTISKE process-email-outbox-handleren med stubbet klient og stubbet
 * transport (fetch). Ingen ekte e-post sendes.
 */
const SERVICE = "service-role-test-key";
let handler: (req: Request) => Promise<Response>;
type Update = { id: string; patch: Record<string, unknown> };
let updates: Update[] = [];
let claimRows: Array<Record<string, unknown>> = [];

function fakeAdmin() {
  return {
    rpc: async (name: string) => (name.startsWith("claim_email_outbox") ? { data: claimRows, error: null } : { data: false, error: null }),
    from: (_t: string) => ({
      update: (patch: Record<string, unknown>) => {
        const conds: Record<string, unknown> = {};
        const chain = {
          eq: (k: string, v: unknown) => {
            conds[k] = v;
            if (k === "status") updates.push({ id: String(conds.id), patch });
            return chain;
          },
        };
        return chain;
      },
    }),
  };
}

beforeAll(async () => {
  const env = new Map([["SUPABASE_URL", "http://localhost"], ["SUPABASE_SERVICE_ROLE_KEY", SERVICE]]);
  (globalThis as Record<string, unknown>).Deno = { env: { get: (k: string) => env.get(k) }, serve: (fn: (r: Request) => Promise<Response>) => { handler = fn; } };
  (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__ = () => fakeAdmin();
  const modulePath = ["..", "..", "supabase", "functions", "process-email-outbox", "index.ts"].join("/");
  await import(/* @vite-ignore */ modulePath);
});
afterAll(() => {
  delete (globalThis as Record<string, unknown>).Deno;
  delete (globalThis as Record<string, unknown>).__EDGE_SUPABASE_FACTORY__;
  vi.unstubAllGlobals();
});
beforeEach(() => {
  updates = [];
  claimRows = [{ id: "o1", template_key: "t", recipient_email: "henrik@nottero-bakeri.no", variables: {}, attempt_count: 1 }];
});

async function run(transport: () => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(transport));
  const res = await handler(new Request("http://x", { method: "POST", headers: { Authorization: `Bearer ${SERVICE}` }, body: "" }));
  return { status: res.status, body: await res.json(), patch: updates[0]?.patch };
}

describe("process-email-outbox: leveringsutfall", () => {
  it("bekreftet sending → sent", async () => {
    const r = await run(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    expect(r.patch?.status).toBe("sent");
  });
  it("5xx → failed, ukjent utfall, ikke nytt forsøk", async () => {
    const r = await run(async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }));
    expect(r.patch?.status).toBe("failed");
    expect(String(r.patch?.error_message)).toContain("Kontroller Sendte elementer");
    expect(r.body.results[0].status).toBe("unknown");
  });
  it("2xx med ugyldig JSON → ukjent, ikke nytt forsøk", async () => {
    const r = await run(async () => new Response("<html>ok</html>", { status: 200 }));
    expect(r.patch?.status).toBe("failed");
  });
  it("2xx uten success → ukjent", async () => {
    const r = await run(async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
    expect(r.patch?.status).toBe("failed");
  });
  it("delivery_unknown fra graph-send (502) → ukjent", async () => {
    const r = await run(async () => new Response(JSON.stringify({ success: false, delivery_unknown: true, error: "x" }), { status: 502 }));
    expect(r.patch?.status).toBe("failed");
  });
  it("nettverksfeil → ukjent", async () => {
    const r = await run(async () => { throw new Error("timeout"); });
    expect(r.patch?.status).toBe("failed");
  });
  it("kjent avvisning før sending (4xx) → nytt forsøk", async () => {
    const r = await run(async () => new Response(JSON.stringify({ success: false, delivery_unknown: false, error: "Microsoft 365 er ikke koblet til" }), { status: 412 }));
    expect(r.patch?.status).toBe("pending");
    expect(r.body.results[0].status).toBe("retry");
  });
  it("uten autorisasjon → 401", async () => {
    const res = await handler(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});

describe("classifyGraphSendResponse", () => {
  it("4xx med delivery_unknown=true er ukjent", () => expect(classifyGraphSendResponse(422, JSON.stringify({ delivery_unknown: true })).kind).toBe("unknown"));
  it("4xx uten JSON er kjent avvisning", () => expect(classifyGraphSendResponse(400, "bad").kind).toBe("rejected"));
});
