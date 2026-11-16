-- =====================================================================================
-- DATAENDRING 17.11.2026 · Variant B fase 3 · TAS SEPARAT MED HENRIK. Ikke en del av PENDING-løpet.
-- Forutsetter at 20261117_automatikk.PENDING.sql er kjørt.
--
-- Del A (planlagt kjøring): legger inn én cron-jobb som hver time kaller rm_automation_tick().
--   Den merker åpne pantlinjer uten prisobservasjon som følgevare (når «Pant er følgevare» ikke er
--   slått av) og legger gamle åpne fakturaer i omberegningskøen i bolker (bare når bryteren er på,
--   standard av). Endrer fakturalinjer når den kjører.
-- Del B (valgfri, kommentert ut): de 130 eldre pantlinjene som er auto-koblet til råvaren
--   «PANT - FLASKER PET …» og har aktiv prisobservasjon. De går i dag inn i kost. Å flytte dem ut
--   krever at prisobservasjonene erstattes (superseded) – avklar med Henrik først.
-- =====================================================================================

-- Del A
select cron.schedule('rm-automatikk-time', '17 * * * *', $$select public.rm_automation_tick()$$)
 where not exists (select 1 from cron.job where jobname = 'rm-automatikk-time');

-- Del B (IKKE KJØR uten avklaring)
-- begin;
-- update raw_material_price_history h set superseded_at = now(), superseded_reason = 'Pant er følgevare (Henrik 16.11.2026)'
--   from invoice_lines l where l.id = h.invoice_line_id and l.line_kind = 'pant' and h.superseded_at is null;
-- update invoice_lines set match_confidence = 'not_applicable', raw_material_id = null, requires_review = false, review_reason = null,
--        price_per_base_unit = null, base_quantity = null, resolution_note = 'Pant – følgevare (utenfor kost, mva-fri)'
--  where line_kind = 'pant' and match_confidence = 'auto_high'
--    and not exists (select 1 from invoice_line_cost_postings p where p.invoice_line_id = invoice_lines.id and p.revoked_at is null);
-- commit;
