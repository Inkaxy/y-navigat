-- Atferdstest for 20261012_varetelling_foundation.PENDING.sql.
-- Kjøres KUN mot en lokal, tom PostgreSQL (scripts/test-varetelling-sql.mjs).
-- Stubber auth.uid(), roller, access_level, raw_materials og has_ravarer_access.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
CREATE TYPE public.access_level AS ENUM ('none','read','write','approve','admin');
CREATE TABLE public.raw_materials (id uuid PRIMARY KEY, legal_entity_id uuid NOT NULL, name text NOT NULL, sku text,
  base_unit text, current_cost_price numeric, cost_basis_status text, cost_source_history_id uuid);
CREATE TABLE public.raw_material_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raw_material_id uuid, unit_label text, units_in_base numeric, sort_order int DEFAULT 0);
CREATE TABLE public.test_access (user_id uuid, legal_entity_id uuid, level public.access_level);
CREATE FUNCTION public.has_ravarer_access(_user_id uuid, _legal_entity_id uuid, _min_level public.access_level)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM test_access WHERE user_id = _user_id AND legal_entity_id = _legal_entity_id AND level >= _min_level) $$;
GRANT EXECUTE ON FUNCTION public.has_ravarer_access(uuid,uuid,public.access_level) TO authenticated;
GRANT SELECT ON public.raw_materials TO authenticated;

\i 20261012_varetelling_foundation.PENDING.sql

-- Firma A/B, brukere: writer (A write), boss (A approve), reader (A read), other (B write)
INSERT INTO test_access VALUES
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000','write'),
 ('00000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000000','approve'),
 ('00000000-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-000000000000','read'),
 ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','write');
INSERT INTO raw_materials VALUES
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Hvetemel','M1','kg',10,'verifisert','99999999-0000-0000-0000-000000000001'),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Sukker','S1','kg',20,'mangler',NULL),
 ('11111111-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000000','B-vare',NULL,'stk',5,'verifisert',NULL);
INSERT INTO raw_material_units (raw_material_id, unit_label, units_in_base) VALUES ('11111111-0000-0000-0000-000000000001','sekk 25 kg',25);

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state THEN RAISE EXCEPTION 'Forventet % fikk % (%): %', p_state, SQLSTATE, SQLERRM, p_sql; END IF;
    RAISE NOTICE 'OK avvist % : %', p_state, left(p_sql, 70); RETURN;
  END;
  RAISE EXCEPTION 'Forventet feil % men lyktes: %', p_state, p_sql;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO authenticated;
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FEIL: %', msg; END IF; RAISE NOTICE 'OK %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean,text) TO authenticated;

-- ===== Som writer i firma A =====
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
INSERT INTO vt_locations (id, legal_entity_id, department, name) VALUES
 ('22222222-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Bakeri','Tørrlager'),
 ('22222222-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Bakeri','Produksjon');
SELECT pg_temp.expect_error($q$INSERT INTO vt_locations (legal_entity_id, department, name) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','bakeri',' tørrlager ')$q$, '23505');
SELECT pg_temp.expect_error($q$INSERT INTO vt_locations (legal_entity_id, department, name) VALUES ('bbbbbbbb-0000-0000-0000-000000000000','X','Y')$q$, '42501');
INSERT INTO vt_templates (id, legal_entity_id, name, department) VALUES
 ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Tørrlager','Bakeri'),
 ('33333333-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Produksjon','Bakeri'),
 ('33333333-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','Overlapp','Bakeri');
INSERT INTO vt_template_lines (template_id, legal_entity_id, raw_material_id, location_id, sort_order) VALUES
 ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001',1),
 ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000002','22222222-0000-0000-0000-000000000001',2),
 ('33333333-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000002',1),
 ('33333333-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001',1);
-- Samme vare+sted to ganger i samme mal
SELECT pg_temp.expect_error($q$INSERT INTO vt_template_lines (template_id, legal_entity_id, raw_material_id, location_id) VALUES ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001')$q$, '23505');
-- Vare fra annet firma
SELECT pg_temp.expect_error($q$INSERT INTO vt_template_lines (template_id, legal_entity_id, raw_material_id) VALUES ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','11111111-0000-0000-0000-000000000003')$q$, '22023');
SELECT pg_temp.ok((SELECT revision FROM vt_templates WHERE id='33333333-0000-0000-0000-000000000001') = 3, 'malrevisjon økes per linje');
-- Ingen direkte skriving i tellinger
SELECT pg_temp.expect_error($q$INSERT INTO vt_counts (legal_entity_id,name,planned_date,valuation_date,create_op_id,created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','x',current_date,current_date,gen_random_uuid(),auth.uid())$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT * FROM vt_line_ops$q$, '42501');

-- Dekning viser overlapp
SELECT pg_temp.ok(jsonb_array_length(vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', ARRAY['33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000003']::uuid[])->'duplicates') = 1, 'dekning finner duplikat');
-- Start med overlapp stoppes
SELECT vt_create_count('44444444-0000-0000-0000-00000000000f','aaaaaaaa-0000-0000-0000-000000000000','Overlapp',current_date,current_date,ARRAY['33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000003']::uuid[]);
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), (SELECT id FROM vt_counts WHERE create_op_id='44444444-0000-0000-0000-00000000000f'), 1)$q$, '23505');
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines) = 0, 'avvist start etterlater ingen linjer');

-- Gyldig telling: to steder for samme vare
SELECT pg_temp.ok((vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,current_date,ARRAY['33333333-0000-0000-0000-000000000001','33333333-0000-0000-0000-000000000002']::uuid[])->>'already_created')::boolean = false, 'opprettet');
SELECT pg_temp.ok((vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,current_date,ARRAY['33333333-0000-0000-0000-000000000001']::uuid[])->>'already_created')::boolean, 'samme op-id gir samme telling');
SELECT pg_temp.ok((SELECT count(*) FROM vt_counts WHERE create_op_id='44444444-0000-0000-0000-000000000001') = 1, 'én telling');
SELECT set_config('test.count', (SELECT id::text FROM vt_counts WHERE create_op_id='44444444-0000-0000-0000-000000000001'), false);
SELECT pg_temp.ok((vt_start_count('55555555-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 1)->>'lines')::int = 3, 'start kopierer 3 linjer');
SELECT pg_temp.ok((vt_start_count('55555555-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 1)->>'already_started')::boolean, 'gjentatt start er trygg');
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), current_setting('test.count')::uuid, 2)$q$, '55000');
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lists WHERE count_id=current_setting('test.count')::uuid) = 2, '2 lister');
SELECT pg_temp.ok((SELECT snap_price_per_base FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' LIMIT 1) = 10, 'verifisert pris frosset');
SELECT pg_temp.ok((SELECT snap_price_per_base IS NULL AND snap_price_source='mangler_verifisert_pris' FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000002'), 'uverifisert pris = mangler, ikke current_cost_price');
SELECT pg_temp.ok((SELECT snap_units->0->>'label' FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' LIMIT 1) = 'sekk 25 kg', 'telleenhet frosset');
RESET ROLE;
-- Ny pris og ny pakningsfaktor etter start endrer ikke tellingen
UPDATE raw_materials SET current_cost_price = 99, name='Endret' WHERE id='11111111-0000-0000-0000-000000000001';
UPDATE raw_material_units SET units_in_base = 50;
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT bool_and(snap_price_per_base = 10 AND snap_name='Hvetemel' AND (snap_units->0->>'units_in_base')::numeric = 25) FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001'), 'snapshot uendret etter pris/pakning-endring');
-- Klient kan ikke endre snapshot
SELECT pg_temp.expect_error($q$UPDATE vt_count_lines SET snap_price_per_base = 1$q$, '42501');

-- Linjelagring: 3 + 7 på to steder
SELECT set_config('test.l1', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id='22222222-0000-0000-0000-000000000001'), false);
SELECT set_config('test.l2', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id='22222222-0000-0000-0000-000000000002'), false);
SELECT set_config('test.l3', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000002'), false);
SELECT pg_temp.ok((vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 3, '[]', null)->>'ok')::boolean, 'lagret 3');
SELECT pg_temp.ok((vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 3, '[]', null)->>'already_applied')::boolean, 'samme op-id gjentatt = ingen ny skriving');
SELECT pg_temp.expect_error($q$SELECT vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 4, '[]', null)$q$, '23505');
SELECT pg_temp.ok((vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 0, 'talt', 5, '[]', null)->>'conflict')::boolean, 'foreldet revisjon gir konflikt');
SELECT pg_temp.ok((SELECT counted_base FROM vt_count_lines WHERE id=current_setting('test.l1')::uuid) = 3, 'konflikt skrev ikke');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 7, '[]', null);
SELECT pg_temp.ok((SELECT sum(counted_base) FROM vt_count_lines WHERE count_id=current_setting('test.count')::uuid AND raw_material_id='11111111-0000-0000-0000-000000000001') = 10, '3 + 7 = 10');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l3')::uuid, 0, 'talt', -1, '[]', null)$q$, '23514');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l3')::uuid, 0, 'null', 999, '[]', null);
SELECT pg_temp.ok((SELECT counted_base = 0 FROM vt_count_lines WHERE id=current_setting('test.l3')::uuid), 'eksplisitt 0 lagres som 0');

-- Andre brukere
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines) = 0, 'annet firma ser ingenting');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 1, 'talt', 1, '[]', null)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a3',false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines) = 3, 'leser ser linjer');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 1, 'talt', 1, '[]', null)$q$, '42501');

-- Avslutning: writer kan ikke; boss stoppes av manglende pris (sukker talt 0 uten pris)
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, 2, 'avsluttet', null)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, 2, 'avsluttet', null)$q$, '55000');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l3')::uuid, 1, 'ikke_her', null, '[]', 'Ikke på dette stedet');
SELECT pg_temp.ok((vt_transition_count('77777777-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 2, 'avsluttet', null)->>'status') = 'avsluttet', 'avsluttet');
SELECT pg_temp.ok((vt_transition_count('77777777-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 2, 'avsluttet', null)->>'already_applied')::boolean, 'gjentatt avslutning trygg');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 1, 'talt', 4, '[]', null)$q$, '55000');
RESET ROLE;
-- Selv en definer-feil kan ikke endre avsluttet telling
SELECT pg_temp.expect_error($q$UPDATE vt_count_lines SET counted_base = 4 WHERE id=current_setting('test.l1')::uuid$q$, '42501');
SELECT pg_temp.expect_error($q$DELETE FROM vt_counts$q$, '42501');

-- Historisk verdsettelsesdato får aldri dagens pris
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT vt_create_count('44444444-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Varetelling 31.12.2025','2025-12-31','2025-12-31',ARRAY['33333333-0000-0000-0000-000000000001']::uuid[]);
SELECT pg_temp.ok((vt_start_count(gen_random_uuid(), (SELECT id FROM vt_counts WHERE create_op_id='44444444-0000-0000-0000-000000000002'), 1)->>'historic_valuation')::boolean, 'historisk flagg');
SELECT pg_temp.ok((SELECT bool_and(snap_price_per_base IS NULL AND snap_price_source='historisk_ikke_tilgjengelig') FROM vt_count_lines l JOIN vt_counts c ON c.id=l.count_id WHERE c.create_op_id='44444444-0000-0000-0000-000000000002'), 'historisk telling bruker ikke dagens pris');
-- anon har ingen tilgang
RESET ROLE; SET ROLE anon;
SELECT pg_temp.expect_error($q$SELECT * FROM vt_counts$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', '{}')$q$, '42501');
RESET ROLE;
SELECT 'ALLE VARETELLING-SQL-TESTER BESTÅTT' AS resultat;
