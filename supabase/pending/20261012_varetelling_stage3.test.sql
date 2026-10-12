-- Atferdstest for stage3. Kjøres etter grunnlagets test (samme økt) av scripts/test-varetelling-sql.mjs.
-- Forutsetter test.count2/test.list2/test.l2a fra oppsettet under. Seriell; ingen ekte parallellitet.
RESET ROLE;
\i 20261012_varetelling_stage3.PENDING.sql

-- Ny åpen telling i firma A med én liste (bruker grunnlagets mal t2).
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT set_config('test.c3', (vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','OCR-test','2026-10-12','ved_start',null,ARRAY[current_setting('test.t2')]::uuid[])->>'count_id'), false);
SELECT vt_start_count(gen_random_uuid(), current_setting('test.c3')::uuid, 1);
SELECT set_config('test.list3', (SELECT id::text FROM vt_count_lists WHERE count_id=current_setting('test.c3')::uuid LIMIT 1), false);
SELECT set_config('test.line3', (SELECT id::text FROM vt_count_lines WHERE count_list_id=current_setting('test.list3')::uuid AND snap_base_unit IS NOT NULL ORDER BY sort_order LIMIT 1), false);

-- Opprett jobb; samme fil = duplikat; bilde uten PDF-kopi avvises; anonym/annet firma avvises.
SELECT set_config('test.job', (vt_ocr_create_job('88888888-0000-0000-0000-000000000001', current_setting('test.list3')::uuid, repeat('a',64), 'application/pdf', 1000, false)->>'job_id'), false);
SELECT pg_temp.ok((vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('a',64), 'application/pdf', 1000, false)->>'duplicate')::boolean, 'samme SHA-256 på samme liste = eksisterende jobb');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('b',64), 'image/jpeg', 1000, false)$q$, '22023');
SELECT pg_temp.ok((SELECT pdf_path LIKE 'aaaaaaaa-0000-0000-0000-000000000000/%/original.pdf' FROM vt_ocr_jobs WHERE id=current_setting('test.job')::uuid), 'sti bestemt av server under firma/telling/liste/jobb');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('c',64), 'application/pdf', 10, false)$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '42501');
SELECT set_config('test.uid','',false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '42501');
-- Direkte skriving og service-funksjoner er stengt for klient.
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.expect_error($q$UPDATE vt_ocr_jobs SET status='klar'$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_record_result(current_setting('test.job')::uuid, true, '[]', '[]')$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_claim(gen_random_uuid())$q$, '42501');

-- Claim én gang; ny claim = 55000 (ingen ny betalt kjøring).
SELECT pg_temp.ok((vt_ocr_claim(current_setting('test.job')::uuid)->>'list_id') = current_setting('test.list3'), 'claim gir manifest for nøyaktig listen');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '55000');

-- Service registrerer: ett gyldig forslag, ett for fremmed linje (fra annen telling) og ett med feil revisjon.
RESET ROLE;
SELECT vt_ocr_record_result(current_setting('test.job')::uuid, true, '[]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 0, 'page', 1, 'row_code', left(current_setting('test.line3'),8),
    'entries', jsonb_build_array(jsonb_build_object('unit_id', null, 'label', 'kg', 'value', 12.5, 'reason', null, 'raw', '12,5'))),
  jsonb_build_object('line_id', current_setting('test.l1'), 'line_revision_at_job', 0, 'page', 1, 'row_code', 'xxxxxxxx', 'entries', '[]'::jsonb)));
SELECT pg_temp.ok((SELECT count(*) = 1 FROM vt_ocr_proposals WHERE job_id=current_setting('test.job')::uuid), 'fremmed linje avvist ved registrering');
SELECT pg_temp.ok((SELECT state='ikke_talt' FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid), 'lesing skriver aldri tellede verdier');
SELECT set_config('test.prop', (SELECT id::text FROM vt_ocr_proposals WHERE job_id=current_setting('test.job')::uuid), false);

-- Samtidig manuell registrering etter opplasting: godkjenning avvises (40001), ingen stille overskriving.
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT vt_save_line(gen_random_uuid(), current_setting('test.line3')::uuid, 0, 'talt', 3, '[{"unit_id":null,"amount":3}]', null);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop')::uuid, 1, 'talt', 12.5, '[{"unit_id":null,"amount":12.5}]', null)$q$, '40001');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop')::uuid, 0, 'talt', 12.5, '[{"unit_id":null,"amount":12.5}]', null)$q$, '40001');
SELECT pg_temp.ok((SELECT counted_base = 3 FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid), 'manuell verdi 3 bevart');

-- Ny jobb uten manuell konflikt: godkjenning med korrigert verdi lagres via vt_save_line og revideres.
SELECT set_config('test.job2', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('d',64), 'application/pdf', 1000, false)->>'job_id'), false);
SELECT vt_ocr_claim(current_setting('test.job2')::uuid);
RESET ROLE;
SELECT vt_ocr_record_result(current_setting('test.job2')::uuid, true, '[]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 1, 'page', 1, 'row_code', left(current_setting('test.line3'),8),
    'entries', jsonb_build_array(jsonb_build_object('unit_id', null, 'label', 'kg', 'value', 12.5, 'reason', null, 'raw', '12,5')))));
SELECT set_config('test.prop2', (SELECT id::text FROM vt_ocr_proposals WHERE job_id=current_setting('test.job2')::uuid), false);
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.ok((vt_ocr_accept('88888888-0000-0000-0000-000000000009', current_setting('test.prop2')::uuid, 1, 'talt', 13, '[{"unit_id":null,"amount":13}]', null)->>'ok')::boolean, 'bekreftet (korrigert) verdi lagret');
SELECT pg_temp.ok((SELECT status='godkjent' AND corrected AND accepted_entry @> '[{"amount":13}]' FROM vt_ocr_proposals WHERE id=current_setting('test.prop2')::uuid), 'korrigering revidert mot forslag 12,5');
SELECT pg_temp.ok((vt_ocr_accept('88888888-0000-0000-0000-000000000009', current_setting('test.prop2')::uuid, 1, 'talt', 13, '[{"unit_id":null,"amount":13}]', null)->>'replayed')::boolean, 'samme op-id = lagret kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop2')::uuid, 2, 'talt', 1, '[{"unit_id":null,"amount":1}]', null)$q$, '55000');

-- Dokument uten bekreftet identitet kan ikke godkjennes.
SELECT set_config('test.job3', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('e',64), 'application/pdf', 1000, false)->>'job_id'), false);
SELECT vt_ocr_claim(current_setting('test.job3')::uuid);
RESET ROLE;
SELECT vt_ocr_record_result(current_setting('test.job3')::uuid, false, '["Side 2 av 2 mangler"]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 2, 'page', 1, 'row_code', 'x', 'entries', '[]'::jsonb)));
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.expect_error(format($q$SELECT vt_ocr_accept(gen_random_uuid(), %L::uuid, 2, 'null', 0, '[]', null)$q$, (SELECT id FROM vt_ocr_proposals WHERE job_id=current_setting('test.job3')::uuid)), '55000');

-- Ukjent AI-utfall: ingen ny claim; ny betalt kjøring bare med eksplisitt bekreftelse av godkjenner.
SELECT set_config('test.job4', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, repeat('f',64), 'application/pdf', 1000, false)->>'job_id'), false);
SELECT vt_ocr_claim(current_setting('test.job4')::uuid);
RESET ROLE; SELECT vt_ocr_record_unknown(current_setting('test.job4')::uuid);
SET ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job4')::uuid)$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_reset_unknown(gen_random_uuid(), current_setting('test.job4')::uuid, true)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_reset_unknown(gen_random_uuid(), current_setting('test.job4')::uuid, false)$q$, '22023');
SELECT vt_ocr_reset_unknown(gen_random_uuid(), current_setting('test.job4')::uuid, true);
SELECT pg_temp.ok((SELECT status='opprettet' FROM vt_ocr_jobs WHERE id=current_setting('test.job4')::uuid), 'ny kjøring bare etter bekreftelse');

-- E-post: reserver idempotent; endret innhold med samme op-id avvises; claim én gang; ukjent blir stående.
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.ok((vt_report_mail_reserve('99999999-1111-0000-0000-000000000001', current_setting('test.c3')::uuid,
  (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid), repeat('1',64), 'henrik@nottero-bakeri.no', 'Rapport', 'Hei')->>'state') = 'reservert', 'reservert');
SELECT pg_temp.ok((vt_report_mail_reserve('99999999-1111-0000-0000-000000000001', current_setting('test.c3')::uuid,
  (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid), repeat('1',64), 'henrik@nottero-bakeri.no', 'Rapport', 'Hei')->>'replayed')::boolean, 'samme reservasjon gjentatt');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_reserve('99999999-1111-0000-0000-000000000001', current_setting('test.c3')::uuid, (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid), repeat('1',64), 'annen@nottero-bakeri.no', 'Rapport', 'Hei')$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_reserve(gen_random_uuid(), current_setting('test.c3')::uuid, 999, repeat('1',64), 'henrik@nottero-bakeri.no', 'Rapport', 'Hei')$q$, '40001');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_reserve(gen_random_uuid(), current_setting('test.c3')::uuid, (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid), repeat('1',64), 'ikke-en-adresse', 'Rapport', 'Hei')$q$, '23514');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_reserve(gen_random_uuid(), current_setting('test.c3')::uuid, 1, repeat('1',64), 'x@y.no', 'R', '')$q$, '42501');
RESET ROLE;
SELECT pg_temp.ok((vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'claimed')::boolean, 'første claim sender');
SELECT pg_temp.ok(NOT (vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'claimed')::boolean, 'andre claim sender ikke');
SELECT vt_report_mail_finish('99999999-1111-0000-0000-000000000001', 'ukjent', 'Tidsavbrudd');
SELECT pg_temp.ok((vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'state') = 'ukjent', 'ukjent utfall sendes aldri automatisk på nytt');

-- Tildeling: ta selv; andre bare av godkjenner; bruker uten skrivetilgang kan ikke tildeles.
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a1', 'teller', false);
SELECT pg_temp.expect_error($q$SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a4', 'teller', false)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT pg_temp.expect_error($q$SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a3', 'teller', false)$q$, '22023');
SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a4', 'teller', false);
SELECT pg_temp.ok((SELECT count(*) = 2 FROM vt_list_assignments WHERE count_list_id=current_setting('test.list3')::uuid), 'to tellere tildelt');
RESET ROLE;
SELECT 'ALLE VARETELLING-SQL-TESTER BESTÅTT' AS resultat;
