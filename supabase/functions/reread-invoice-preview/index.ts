// «Les originalen på nytt»: leser lagret original-PDF på nytt og registrerer et uforanderlig forslag.
// Skriver ALDRI til fakturaen eller linjene. Forespørsel: { run_id }.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { runPreview, type RunRow } from "./flow.ts";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, code: "metode" });
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer\s+\S+/i.test(auth) || auth.replace(/^Bearer\s+/i, "").trim() === service) return json(401, { ok: false, code: "not_authenticated" });
  const user = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, service);
  const { data: u } = await user.auth.getUser();
  if (!u?.user) return json(401, { ok: false, code: "not_authenticated" });
  const body = await req.json().catch(() => null);
  const runId = body && typeof body === "object" ? (body as { run_id?: unknown }).run_id : undefined;

  try {
    const r = await runPreview({
      readRunAsUser: async (id) => {
        const { data, error } = await user.from("invoice_reread_runs")
          .select("id, legal_entity_id, invoice_id, created_by, status, expires_at, document_path, snapshot").eq("id", id).maybeSingle();
        if (error) throw new Error("run_read");
        return (data as RunRow | null) ?? null;
      },
      hasWriteAccess: async (le) => {
        const { data } = await user.rpc("has_ravarer_invoice_access", { _legal_entity_id: le, _required_level: "write" });
        return data === true;
      },
      supplierName: async (le, sid) => {
        const { data } = await admin.from("suppliers").select("name").eq("id", sid).eq("legal_entity_id", le).maybeSingle();
        return (data as { name?: string } | null)?.name ?? null;
      },
      download: async (path) => {
        const { data, error } = await admin.storage.from("invoice-pdfs").download(path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      },
      extract: async (b) => {
        // Brukerens egen JWT: leseren sjekker selv bruker + skrivetilgang. Tjenestenøkkelen sendes ikke.
        const res = await fetch(`${url}/functions/v1/extract-invoice-from-pdf`, {
          method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: JSON.stringify(b),
        });
        const j = await res.json().catch(() => null);
        return { ok: res.ok, status: res.status, json: j };
      },
      register: async (id, sha, proposal, extractor) => {
        try {
          const { data, error } = await admin.rpc("rm_register_invoice_reread", { p_run_id: id, p_document_sha256: sha, p_proposal: proposal, p_extractor: extractor });
          if (error) {
            console.error("register", error.code, error.message);
            // Valideringsavvisning fra databasen er et kjent utfall; nettverksfeil er ukjent.
            if (error.code && /^[0-9A-Z]{5}$/.test(error.code)) { await admin.rpc("rm_fail_invoice_reread", { p_run_id: id, p_code: "forslag_avvist" }); return { ok: false, code: "forslag_avvist" }; }
            return "unknown";
          }
          const d = data as { ok?: boolean; code?: string; replayed?: boolean };
          return { ok: d?.ok === true, code: d?.code, replayed: d?.replayed };
        } catch {
          return "unknown";
        }
      },
      fail: async (id, code) => { await admin.rpc("rm_fail_invoice_reread", { p_run_id: id, p_code: code }); },
      now: () => Date.now(),
    }, u.user.id, runId);
    return json(r.status, r.body);
  } catch (e) {
    console.error("reread-invoice-preview", (e as Error).message);
    return json(500, { ok: false, code: "intern_feil", run_id: typeof runId === "string" ? runId : undefined });
  }
});
