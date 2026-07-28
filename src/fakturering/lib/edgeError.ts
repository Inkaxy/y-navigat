import { FunctionsHttpError } from "@supabase/supabase-js";

/**
 * Trekker ut en lesbar feilmelding fra en supabase.functions.invoke-feil.
 * Ved FunctionsHttpError leser vi response-bodyen for å plukke ut `error`-feltet
 * som edge-funksjonene våre returnerer — ellers får UI bare
 * «Edge Function returned a non-2xx status code».
 */
export async function readEdgeError(err: unknown): Promise<string> {
  if (err instanceof FunctionsHttpError) {
    try {
      const body = await err.context.json();
      if (body && typeof body === "object") {
        const anyBody = body as Record<string, unknown>;
        const msg = anyBody.error ?? anyBody.message ?? anyBody.msg;
        if (typeof msg === "string" && msg.trim()) return msg;
      }
    } catch {
      try {
        const txt = await err.context.text();
        if (txt) return txt;
      } catch {
        /* ignore */
      }
    }
    return err.message || "Ukjent feil fra tjenesten";
  }
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : "Ukjent feil";
}
