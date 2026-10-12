-- Atferdstest for stage3 revisjon 2. Kjøres etter grunnlagets test (samme økt) av scripts/test-varetelling-sql.mjs.
-- Seriell; ingen ekte parallellitet. Låsrekkefølge er resonnert, ikke bevist med to økter.
RESET ROLE;
\i 20261012_varetelling_stage3.PENDING.sql

SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT set_config('test.c3', (vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','OCR-test','2026-10-12','ved_start',null,ARRAY[current_setting('test.t2')]::uuid[])->>'count_id'), false);
SELECT vt_start_count(gen_random_uuid(), current_setting('test.c3')::uuid, 1);
SELECT set_config('test.list3', (SELECT id::text FROM vt_count_lists WHERE count_id=current_setting('test.c3')::uuid LIMIT 1), false);
SELECT set_config('test.line3', (SELECT id::text FROM vt_count_lines WHERE count_list_id=current_setting('test.list3')::uuid AND snap_base_unit IS NOT NULL ORDER BY sort_order LIMIT 1), false);
CREATE FUNCTION pg_temp.files(c text, n int DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('sha256', repeat(c,63) || i, 'size', 1000, 'mime', 'image/jpeg')) FROM generate_series(1, n) i $$;
GRANT EXECUTE ON FUNCTION pg_temp.files(text,int) TO authenticated, service_role;

-- ===== Rapport-øyeblikksbilde =====
SELECT pg_temp.ok((SELECT jsonb_array_length(vt_report_snapshot(current_setting('test.c3')::uuid)->'lines') = (SELECT count(*) FROM vt_count_lines WHERE count_id=current_setting('test.c3')::uuid)), 'øyeblikksbilde inneholder alle linjer');
SELECT pg_temp.ok(vt_report_snapshot(current_setting('test.c3')::uuid) = vt_report_snapshot(current_setting('test.c3')::uuid), 'samme data ⇒ samme øyeblikksbilde (stabil hash)');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_error($q$SELECT vt_report_snapshot(current_setting('test.c3')::uuid)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);

-- ===== Jobb: flere sider, duplikat, ugyldige filer, tilgang =====
SELECT set_config('test.job', (vt_ocr_create_job('88888888-0000-0000-0000-000000000001', current_setting('test.list3')::uuid, pg_temp.files('a', 2))->>'job_id'), false);
SELECT pg_temp.ok((SELECT jsonb_array_length(originals) = 2 AND originals->1->>'path' LIKE 'aaaaaaaa-0000-0000-0000-000000000000/%/side-2.jpg' FROM vt_ocr_jobs WHERE id=current_setting('test.job')::uuid), 'to sider i én jobb; stier bestemt av server');
SELECT pg_temp.ok((vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, pg_temp.files('a', 2))->>'duplicate')::boolean, 'samme sider (SHA+størrelse) på samme liste = eksisterende jobb');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, '[{"sha256":"x","size":1,"mime":"image/jpeg"}]')$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, '[{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","size":1,"mime":"image/webp"}]')$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, '[]')$q$, '22023');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, pg_temp.files('c'))$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '42501');
SELECT set_config('test.uid','',false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_status(gen_random_uuid())$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.expect_error($q$UPDATE vt_ocr_jobs SET status='klar'$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT csv FROM vt_report_mail_ops$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_record_result(current_setting('test.job')::uuid, gen_random_uuid(), true, '[]', '[]')$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_claim(gen_random_uuid())$q$, '42501');

-- ===== Lease og forsøksidentitet =====
SELECT set_config('test.att1', vt_ocr_claim(current_setting('test.job')::uuid)->>'attempt_id', false);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '55000');
SET ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT vt_ocr_record_result(current_setting('test.job')::uuid, gen_random_uuid(), true, '[]', '[]')$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.job')::uuid)$q$, '42501');
SELECT vt_ocr_record_result(current_setting('test.job')::uuid, current_setting('test.att1')::uuid, true, '[]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 0, 'page', 1, 'row_code', 'r1',
    'entries', jsonb_build_array(jsonb_build_object('unit_id', null, 'unit_known', true, 'label', 'kg', 'value', 12.5, 'reason', null, 'raw', '12,5'))),
  jsonb_build_object('line_id', current_setting('test.l1'), 'line_revision_at_job', 0, 'page', 1, 'row_code', 'x', 'entries', '[]'::jsonb)));
SELECT pg_temp.expect_error($q$SELECT vt_ocr_record_failure(current_setting('test.job')::uuid, current_setting('test.att1')::uuid, 'sent')$q$, '55000');
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*) = 1 FROM vt_ocr_proposals WHERE job_id=current_setting('test.job')::uuid), 'fremmed linje avvist ved registrering');
SELECT pg_temp.ok((SELECT document_ok = false FROM vt_ocr_jobs WHERE id=current_setting('test.job')::uuid), 'fremmed linje gjør dokumentet ikke godkjennbart');
SELECT pg_temp.ok((SELECT state='ikke_talt' FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid), 'lesing skriver aldri tellede verdier');

-- Utløpt lease: status viser det, godkjenner kan bekrefte ny kjøring; gammelt forsøk kan ikke registrere.
SET ROLE authenticated;
SELECT set_config('test.jobL', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, pg_temp.files('9'))->>'job_id'), false);
SELECT set_config('test.attL', vt_ocr_claim(current_setting('test.jobL')::uuid)->>'attempt_id', false);
RESET ROLE; UPDATE vt_ocr_jobs SET lease_until = now() - interval '1 minute' WHERE id = current_setting('test.jobL')::uuid;
SET ROLE authenticated;
SELECT pg_temp.ok((vt_ocr_job_status(current_setting('test.jobL')::uuid)->>'lease_expired')::boolean, 'utløpt lease synlig (skrivebeskyttet)');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_reset_unknown(gen_random_uuid(), current_setting('test.jobL')::uuid, true)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT vt_ocr_reset_unknown(gen_random_uuid(), current_setting('test.jobL')::uuid, true);
SET ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT vt_ocr_record_unknown(current_setting('test.jobL')::uuid, current_setting('test.attL')::uuid, 'sen')$q$, '55000');
RESET ROLE;
SELECT pg_temp.ok((SELECT status='opprettet' AND attempt_id IS NULL FROM vt_ocr_jobs WHERE id=current_setting('test.jobL')::uuid), 'gammelt forsøk overskriver ikke ny tilstand');

-- ===== Godkjenning: ny jobb med bekreftet identitet =====
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT set_config('test.job2', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, pg_temp.files('d'))->>'job_id'), false);
SELECT set_config('test.att2', vt_ocr_claim(current_setting('test.job2')::uuid)->>'attempt_id', false);
SET ROLE service_role;
SELECT vt_ocr_record_result(current_setting('test.job2')::uuid, current_setting('test.att2')::uuid, true, '[]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 0, 'page', 1, 'row_code', 'r1',
    'entries', jsonb_build_array(jsonb_build_object('unit_id', null, 'unit_known', true, 'label', 'kg', 'value', 12.5, 'reason', null, 'raw', '12,5')))));
RESET ROLE;
SELECT set_config('test.prop2', (SELECT id::text FROM vt_ocr_proposals WHERE job_id=current_setting('test.job2')::uuid), false);
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
-- Utelatelse uten begrunnelse avvises.
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop2')::uuid, 0, 'talt', 13, '[{"unit_id":null,"amount":13}]', null, '[{"label":"sekk","reason":""}]')$q$, '22023');
-- En tidligere manuell op med samme parametre kan ikke «gjenbrukes» som godkjenning: egen op-type + forslag i forespørselen.
SELECT vt_save_line('77777777-aaaa-0000-0000-000000000001', current_setting('test.line3')::uuid, 0, 'talt', 13, '[{"unit_id":null,"amount":13}]', null);
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept('77777777-aaaa-0000-0000-000000000001', current_setting('test.prop2')::uuid, 0, 'talt', 13, '[{"unit_id":null,"amount":13}]', null, '[]')$q$, '23505');
-- Linjen endret etter opplasting ⇒ 40001, ingen stille overskriving, forslaget fortsatt åpent.
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop2')::uuid, 0, 'talt', 12.5, '[{"unit_id":null,"amount":12.5}]', null, '[]')$q$, '40001');
SELECT pg_temp.ok((SELECT counted_base = 13 FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid) AND (SELECT status='foreslatt' FROM vt_ocr_proposals WHERE id=current_setting('test.prop2')::uuid), 'manuell verdi bevart, forslag uendret');

-- Ren jobb (revisjon 1) — godkjenn med rettet verdi og utelatelse; eksakt gjentakelse; deretter avvis = avgjort.
SELECT set_config('test.job3', (vt_ocr_create_job(gen_random_uuid(), current_setting('test.list3')::uuid, pg_temp.files('e'))->>'job_id'), false);
SELECT set_config('test.att3', vt_ocr_claim(current_setting('test.job3')::uuid)->>'attempt_id', false);
SET ROLE service_role;
SELECT vt_ocr_record_result(current_setting('test.job3')::uuid, current_setting('test.att3')::uuid, true, '[]'::jsonb, jsonb_build_array(
  jsonb_build_object('line_id', current_setting('test.line3'), 'line_revision_at_job', 1, 'page', 1, 'row_code', 'r1',
    'entries', jsonb_build_array(jsonb_build_object('unit_id', null, 'unit_known', true, 'label', 'kg', 'value', 12.5, 'reason', null, 'raw', '12,5'),
                                 jsonb_build_object('unit_id', null, 'unit_known', false, 'label', 'kasse', 'value', null, 'reason', 'velg enhet', 'raw', '2')))));
RESET ROLE;
SELECT set_config('test.prop3', (SELECT id::text FROM vt_ocr_proposals WHERE job_id=current_setting('test.job3')::uuid), false);
SET ROLE authenticated;
SELECT pg_temp.ok((vt_ocr_accept('88888888-0000-0000-0000-000000000009', current_setting('test.prop3')::uuid, 1, 'talt', 14, '[{"unit_id":null,"amount":14}]', null, '[{"label":"kasse","reason":"Ukjent pakning, talt løst"}]')->>'ok')::boolean, 'bekreftet verdi lagret');
SELECT pg_temp.ok((SELECT status='godkjent' AND accepted_entry @> '[{"amount":14}]' AND accepted_exclusions->0->>'reason' LIKE 'Ukjent%' AND save_op_id IS NOT NULL FROM vt_ocr_proposals WHERE id=current_setting('test.prop3')::uuid), 'godkjenning + utelatelse revidert med lagringsoperasjon');
SELECT pg_temp.ok((SELECT counted_base = 14 AND revision = 2 FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid), 'linje og revisjonsspor i samme transaksjon');
SELECT pg_temp.ok((vt_ocr_accept('88888888-0000-0000-0000-000000000009', current_setting('test.prop3')::uuid, 1, 'talt', 14, '[{"unit_id":null,"amount":14}]', null, '[{"label":"kasse","reason":"Ukjent pakning, talt løst"}]')->>'replayed')::boolean, 'samme op-id = lagret kvittering');
SELECT pg_temp.ok((SELECT revision = 2 FROM vt_count_lines WHERE id=current_setting('test.line3')::uuid), 'gjentakelse skrev ikke på nytt');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_reject(gen_random_uuid(), current_setting('test.prop3')::uuid, 'for sent')$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop3')::uuid, 2, 'null', 0, '[]', null, '[]')$q$, '55000');
-- Avvist forslag kan ikke godkjennes etterpå.
SELECT vt_ocr_reject(gen_random_uuid(), current_setting('test.prop2')::uuid, 'feil');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_accept(gen_random_uuid(), current_setting('test.prop2')::uuid, 0, 'null', 0, '[]', null, '[]')$q$, '55000');

-- ===== E-post =====
CREATE FUNCTION pg_temp.reserve(op uuid, rcpt text DEFAULT 'henrik@nottero-bakeri.no', rev int DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$
  SELECT vt_report_mail_reserve(op, current_setting('test.c3')::uuid, coalesce(rev, (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid)), repeat('1',64),
    rcpt, 'Rapport', 'Hei', vt_report_snapshot(current_setting('test.c3')::uuid), 'csv', 'cGRm', 'varetelling', false, 'post@nottero-bakeri.no') $$;
GRANT EXECUTE ON FUNCTION pg_temp.reserve(uuid,text,int) TO authenticated;
SELECT pg_temp.ok((pg_temp.reserve('99999999-1111-0000-0000-000000000001')->>'state') = 'reservert', 'reservert med øyeblikksbilde og vedlegg');
SELECT pg_temp.ok((vt_report_mail_status('99999999-1111-0000-0000-000000000001')->>'state') = 'reservert', 'status er skrivebeskyttet oppslag');
SELECT pg_temp.ok((pg_temp.reserve('99999999-1111-0000-0000-000000000001')->>'replayed')::boolean, 'samme reservasjon gjentatt');
SELECT pg_temp.expect_error($q$SELECT pg_temp.reserve('99999999-1111-0000-0000-000000000001', 'annen@nottero-bakeri.no')$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT pg_temp.reserve(gen_random_uuid(), 'henrik@nottero-bakeri.no', 999)$q$, '40001');
SELECT pg_temp.expect_error($q$SELECT pg_temp.reserve(gen_random_uuid(), 'ikke-en-adresse')$q$, '23514');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.expect_error($q$SELECT pg_temp.reserve(gen_random_uuid())$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_report_mail_status('99999999-1111-0000-0000-000000000001')$q$, '42501');
-- Linje endres etter reservasjon: lagret vedlegg gjelder fortsatt (reservasjonen er uendret).
SET ROLE service_role;
SELECT pg_temp.ok((vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'csv') = 'csv', 'claim returnerer LAGRET vedlegg');
SELECT pg_temp.ok(NOT (vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'claimed')::boolean, 'andre claim sender ikke');
SELECT vt_report_mail_finish('99999999-1111-0000-0000-000000000001', 'ukjent', 'Tidsavbrudd');
SELECT pg_temp.ok((vt_report_mail_claim('99999999-1111-0000-0000-000000000001')->>'state') = 'ukjent', 'ukjent utfall sendes aldri automatisk på nytt');
RESET ROLE;

-- ===== Tildeling og historikk =====
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a1', 'teller', false);
SELECT pg_temp.expect_error($q$SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a4', 'teller', false)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT pg_temp.expect_error($q$SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a3', 'teller', false)$q$, '22023');
SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a4', 'teller', false);
SELECT pg_temp.ok((SELECT count(*) = 2 FROM vt_list_assignments WHERE count_list_id=current_setting('test.list3')::uuid), 'to tellere tildelt');
SELECT vt_transition_count(gen_random_uuid(), current_setting('test.c3')::uuid, (SELECT revision FROM vt_counts WHERE id=current_setting('test.c3')::uuid), 'avbrutt', 'testavbrudd');
SELECT pg_temp.expect_error($q$SELECT vt_assign_list(gen_random_uuid(), current_setting('test.list3')::uuid, '00000000-0000-0000-0000-0000000000a4', 'teller', true)$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_ocr_claim(current_setting('test.jobL')::uuid)$q$, '55000');
RESET ROLE;
SELECT 'ALLE VARETELLING-SQL-TESTER BESTÅTT' AS resultat;
