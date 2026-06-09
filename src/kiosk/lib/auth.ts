import { kioskSupabase } from "@/kiosk/integrations/supabase/client";

export function getKioskCredentials(): { email: string; password: string } | null {
  const email = import.meta.env.VITE_KIOSK_EMAIL as string | undefined;
  const password = import.meta.env.VITE_KIOSK_PASSWORD as string | undefined;
  if (!email || !password) return null;
  return { email, password };
}

export type EnsureSessionResult = {
  ok: boolean;
  reason?: "missing_env" | "auth_failed";
  error?: string;
};

export async function ensureKioskSession(): Promise<EnsureSessionResult> {
  const creds = getKioskCredentials();
  if (!creds) return { ok: false, reason: "missing_env" };

  const { data } = await kioskSupabase.auth.getSession();
  if (data.session?.user) return { ok: true };

  const { error } = await kioskSupabase.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });
  if (error) return { ok: false, reason: "auth_failed", error: error.message };
  return { ok: true };
}
