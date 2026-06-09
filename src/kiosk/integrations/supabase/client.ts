// Separat Supabase-klient for hele Kiosk-modulen.
// Bruker egen storageKey ('pos-kiosk-auth') slik at Kiosk-bruker
// kan sameksistere med NBhub-bruker i samme nettleser uten konflikt.
//
// ALLE Supabase-kall inni src/kiosk/* MÅ bruke `kioskSupabase`,
// ikke `@/integrations/supabase/client`.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string);

export const kioskSupabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storageKey: "pos-kiosk-auth",
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
