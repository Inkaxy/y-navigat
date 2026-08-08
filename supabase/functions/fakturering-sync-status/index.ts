// fakturering-sync-status — polls Tripletex for invoice status on transferred basis rows.
// Called by pg_cron every 30 min via CRON_SECRET header. Also callable ad-hoc with the same secret.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { getSessionToken, tripletexFetch } from "../_shared/tripletex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const provided = (req.headers.get("x-cron-secret") ?? "").trim();
  const expectedEnv = Deno.env.get("CRON_SECRET");
  let authorized = Boolean(expectedEnv) && provided === expectedEnv;
  if (!authorized && provided.length >= 16) {
    const { data, error } = await admin.rpc("verify_cron_secret", { p_secret: provided });
    if (error) console.error("verify_cron_secret feilet", error.message);
    authorized = data === true;
  }
  if (!authorized) return json(401, { error: "Unauthorized" });


  try {
    const { data: rows, error } = await admin
      .from("invoice_basis")
      .select("id, basis_number, legal_entity_id, tripletex_order_id, transferred_at, basis_number")
      .eq("status", "transferred")
      .not("tripletex_order_id", "is", null);
    if (error) throw error;

    if (!rows || rows.length === 0) return json(200, { ok: true, checked: 0, invoiced: 0 });

    // Group by legal_entity_id to reuse session tokens
    const byEntity = new Map<string, any[]>();
    for (const r of rows) {
      if (!byEntity.has(r.legal_entity_id)) byEntity.set(r.legal_entity_id, []);
      byEntity.get(r.legal_entity_id)!.push(r);
    }

    let checked = 0;
    let invoiced = 0;
    const errors: any[] = [];

    for (const [entityId, list] of byEntity.entries()) {
      let sessionToken: string;
      try {
        sessionToken = await getSessionToken(admin, entityId);
      } catch (e) {
        errors.push({ entity: entityId, error: (e as Error).message });
        continue;
      }
      for (const basis of list) {
        checked++;
        try {
          const res = await tripletexFetch(`/v2/order/${basis.tripletex_order_id}`, {
            sessionToken,
            query: { fields: "id,number,invoice(id,invoiceNumber,invoiceDate)" },
          });
          const inv = res?.value?.invoice;
          if (inv?.id) {
            await admin
              .from("invoice_basis")
              .update({
                status: "invoiced",
                tripletex_invoice_id: inv.id,
                tripletex_invoice_number: inv.invoiceNumber ? String(inv.invoiceNumber) : null,
                tripletex_invoice_date: inv.invoiceDate ?? null,
                invoiced_at: new Date().toISOString(),
              })
              .eq("id", basis.id);
            invoiced++;
          }
        } catch (e) {
          errors.push({ basis_id: basis.id, error: (e as Error).message });
        }
      }
    }

    return json(200, { ok: true, checked, invoiced, errors });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("fakturering-sync-status error", msg);
    return json(500, { error: msg });
  }
});
