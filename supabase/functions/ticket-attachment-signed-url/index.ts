// Returns a short-lived signed URL for a ticket attachment.
// Caller must be authenticated AND have read access via tickets RLS
// (we double-check by selecting the attachment row through the user client).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { attachment_id } = await req.json();
    if (!attachment_id) return json({ error: "attachment_id påkrevd" }, 400);

    // Use user client so RLS verifies access
    const { data: att, error } = await userClient
      .from("ticket_attachments")
      .select("storage_path, file_name")
      .eq("id", attachment_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!att?.storage_path) return json({ error: "Vedlegg ikke tilgjengelig" }, 404);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: signed, error: sErr } = await admin.storage
      .from("ticket-attachments")
      .createSignedUrl(att.storage_path, 60 * 5, { download: att.file_name });
    if (sErr) return json({ error: sErr.message }, 500);

    return json({ signed_url: signed.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
