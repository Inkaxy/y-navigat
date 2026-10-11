// Kjente avvisninger fra Postgres/PostgREST: transaksjonen er rullet tilbake, ingenting lagret.
// Alt annet (nettverk, klasse 08, 40003, manglende kode, uventet svar) er UKJENT utfall.
// Speilet byte-identisk i supabase/functions/_shared/sqlstate.ts (test vokter dette).
export const KNOWN_REJECTION_CODES: readonly string[] = [
  "P0001", "P0002",
  "22023", "22P02", "22003",
  "42501", "28000",
  "55000",
  "40001", "40P01",
  "23502", "23503", "23505", "23514",
];

export type DbErrorClass = "rejected" | "unknown";

export function classifyDbError(code: unknown): DbErrorClass {
  return typeof code === "string" && KNOWN_REJECTION_CODES.includes(code) ? "rejected" : "unknown";
}
