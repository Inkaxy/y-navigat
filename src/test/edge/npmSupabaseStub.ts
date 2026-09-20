// Teststubb for `npm:@supabase/supabase-js@2.95.0` i edge-funksjoner.
// Klienten hentes fra en global fabrikk som testen setter, slik at den
// FAKTISKE handleren kjøres mot en mocket transport.
type Factory = (url: string, key: string, opts?: unknown) => unknown;

export function createClient(url: string, key: string, opts?: unknown): unknown {
  const factory = (globalThis as { __EDGE_SUPABASE_FACTORY__?: Factory }).__EDGE_SUPABASE_FACTORY__;
  if (!factory) throw new Error("__EDGE_SUPABASE_FACTORY__ er ikke satt i testen");
  return factory(url, key, opts);
}
