// Delt autorisasjon for cron-kall: service-bearer (SUPABASE_SERVICE_ROLE_KEY)
// eller X-Cron-Secret verifisert mot admin.rpc('verify_cron_secret').
// Brukes av edge-funksjoner som kjøres av pg_cron uten innlogget bruker.
export type CronAuthResult = "service" | "cron" | null;

/** Minimalt grensesnitt — unngår generiske typekonflikter mellom ulike SupabaseClient<...>-instanser. */
export interface CronAuthClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export const CRON_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Minste lengde på en gyldig cron-secret — hindrer trivielle/tomme verdier. */
const MIN_CRON_SECRET_LENGTH = 16;

/**
 * Godkjenner kallet som enten «service» (bearer = service role-nøkkelen) eller
 * «cron» (X-Cron-Secret ≥ 16 tegn og verifisert via verify_cron_secret-RPC-en).
 * Returnerer null hvis ingen av delene stemmer — kalleren avgjør selv om det da
 * skal falles videre til bruker-JWT-sjekk.
 */
export async function authorizeCron(
  req: Request,
  admin: CronAuthClient,
): Promise<CronAuthResult> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authorization = req.headers.get("Authorization") ?? "";
  const bearer = authorization.replace(/^Bearer\s+/i, "").trim();
  if (serviceKey && bearer && bearer === serviceKey) return "service";

  const cronSecret = req.headers.get("X-Cron-Secret") ?? "";
  if (cronSecret.length >= MIN_CRON_SECRET_LENGTH) {
    const { data, error } = await admin.rpc("verify_cron_secret", { p_secret: cronSecret });
    if (!error && data === true) return "cron";
  }

  return null;
}
