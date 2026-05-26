// Summarises an image attachment using Lovable AI Gateway (vision).
// Result is stored as ai_summary on the attachment row and treated as
// REFERENCE only — never as ground truth. Staff must confirm details.
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

    const { data: att, error } = await userClient
      .from("ticket_attachments")
      .select("id, storage_path, file_name, content_type")
      .eq("id", attachment_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!att?.storage_path) return json({ error: "Vedlegg ikke tilgjengelig" }, 404);
    if (!att.content_type?.startsWith("image/")) {
      return json({ error: "Kun bildevedlegg kan oppsummeres" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const dl = await admin.storage.from("ticket-attachments").download(att.storage_path);
    if (dl.error || !dl.data) return json({ error: dl.error?.message ?? "Kunne ikke laste ned" }, 500);

    const buf = new Uint8Array(await dl.data.arrayBuffer());
    // base64 encode (chunked for large files)
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) {
      bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    }
    const b64 = btoa(bin);
    const dataUrl = `data:${att.content_type};base64,${b64}`;

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) return json({ error: "LOVABLE_API_KEY mangler" }, 500);

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "system",
            content:
              "Du oppsummerer kundebilder for et bakeri på norsk. " +
              "Beskriv kort hva bildet viser, antatt formål (inspirasjon for kake, logo, dokument), " +
              "farger, motiv, tekst, og evt. tydelige detaljer som pynt eller form. " +
              "Vær eksplisitt på at dette er en REFERANSE/INSPIRASJON og ikke en fasit. " +
              "Avslutt med én linje: 'Ansatt må bekrefte detaljer med kunden.' " +
              "Maks 5–7 setninger.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Filnavn: ${att.file_name}. Oppsummer bildet:` },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      return json({ error: `AI-feil ${aiRes.status}: ${t.slice(0, 200)}` }, aiRes.status === 429 ? 429 : 500);
    }
    const aiJson = await aiRes.json();
    const summary: string = aiJson?.choices?.[0]?.message?.content?.trim() ?? "";
    if (!summary) return json({ error: "Tomt AI-svar" }, 500);

    const { error: upErr } = await admin
      .from("ticket_attachments")
      .update({ ai_summary: summary, ai_summarized_at: new Date().toISOString() })
      .eq("id", attachment_id);
    if (upErr) return json({ error: upErr.message }, 500);

    return json({ summary });
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
