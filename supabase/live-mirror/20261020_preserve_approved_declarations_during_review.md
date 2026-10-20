# 20261020 preserve_approved_declarations_during_review — utrullingsnotis

- `20261020_preserve_approved_declarations_during_review.sql` er en byte-identisk kopi av
  `supabase/pending/20261020_label_approved_version_claims.PENDING.sql`, inkludert den
  opprinnelige «PENDING»-kommentaren.
- Root har anvendt dette innholdet mot live 20.10.2026 som migrasjonen
  `preserve_approved_declarations_during_review`. **Skal ikke kjøres igjen.**
- Testskriptet `supabase/pending/20261020_label_approved_version_claims.test.sql`
  (skriver syntetiske rader i produksjonsdatabasen) er **ikke kjørt** mot live.
- Root har lesekontrollert resultatet og funnet null avvik. `push_products_to_nettside`
  er ikke kjørt som en del av utrullingen.
