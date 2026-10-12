# Speil av utrullede varetelling-Edge-funksjoner (ikke auto-utrulling)
Utrullet av root 12.10.2026, verify_jwt=true. Byte-identisk med kanonisk kilde:
- `vt-count-ocr/` — v1, `42b9835d` (`supabase/pending/functions/vt-count-ocr/`)
- `vt-count-report-email/` — v1, `d753fa8d`
- `_shared/vtReport.ts` — identisk i `42b9835d` og `d753fa8d`
Øvrige relative avhengigheter (`_shared/ai-providers.ts`, `crypto.ts`, `graph-mail.ts`) er de uendrede filene i `supabase/functions/_shared/`.
Kjente Deno-typefeil finnes bare i de delte filene; ingen nye.
