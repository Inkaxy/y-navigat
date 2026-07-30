import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export type EnsureSessionResult = {
  ok: boolean;
  reason?: "missing_env" | "auth_failed";
  error?: string;
};

/**
 * Logger inn den delte kiosk-brukeren.
 *
 * Legitimasjonen ligger IKKE lenger i klienten — edge-funksjonen `kiosk-session`
 * holder e-post/passord som server-secrets og returnerer kun ferdige tokens.
 */
export async function ensureKioskSession(): Promise<EnsureSessionResult> {
  const { data } = await kioskSupabase.auth.getSession();
  if (data.session?.user) return { ok: true };

  const { data: res, error } = await kioskSupabase.functions.invoke("kiosk-session", {
    body: {},
  });

  if (error) {
    return { ok: false, reason: "auth_failed", error: error.message };
  }
  const tokens = res as { access_token?: string; refresh_token?: string; error?: string } | null;
  if (!tokens?.access_token || !tokens.refresh_token) {
    return { ok: false, reason: "auth_failed", error: tokens?.error ?? "Ugyldig svar fra kiosk-session" };
  }

  const { error: setErr } = await kioskSupabase.auth.setSession({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  if (setErr) return { ok: false, reason: "auth_failed", error: setErr.message };

  return { ok: true };
}
