-- Atferdstest for 20261012_varetelling_foundation.PENDING.sql (revisjon 2).
-- Kjøres KUN mot en lokal, tom PostgreSQL/PGlite (scripts/test-varetelling-sql.mjs). Rører aldri live.
-- Stubber: auth.uid(), roller, access_level, raw_materials, raw_material_units, has_ravarer_access,
-- has_ravarer_invoice_access og _rm_cost_candidates (kanonisk velger erstattet av en testtabell).
-- Seriell kjøring: beviser låsrekkefølge-resonnement IKKE med ekte parallelle økter.
\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
GRANT USAGE ON SCHEMA public TO authenticated, anon;
-- Etterlign Supabase: nye tabeller arver standardrettigheter til authenticated (revoke må nullstille dem).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
CREATE TYPE public.access_level AS ENUM ('none','read','write','approve','admin');
CREATE TABLE public.raw_materials (id uuid PRIMARY KEY, legal_entity_id uuid NOT NULL, name text NOT NULL, sku text,
  base_unit text, current_cost_price numeric, cost_basis_status text, cost_source_history_id uuid,
  is_active boolean DEFAULT true, stock_tracking boolean DEFAULT false);
CREATE TABLE public.raw_material_units (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), raw_material_id uuid, unit_label text, units_in_base numeric, sort_order int DEFAULT 0);
CREATE TABLE public.test_access (user_id uuid, legal_entity_id uuid, level public.access_level, invoice boolean DEFAULT true);
CREATE TABLE public.test_candidates (history_id uuid, raw_material_id uuid, price numeric, effective_date date, created_at timestamptz, source text);
CREATE FUNCTION public.has_ravarer_access(_user_id uuid, _legal_entity_id uuid, _min_level public.access_level)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM test_access WHERE user_id = _user_id AND legal_entity_id = _legal_entity_id AND level >= _min_level) $$;
CREATE FUNCTION public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text DEFAULT 'read')
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM test_access WHERE user_id = auth.uid() AND legal_entity_id = _legal_entity_id AND invoice) $$;
CREATE FUNCTION public._rm_cost_candidates(p_raw_material_id uuid, p_as_of date)
RETURNS TABLE(history_id uuid, price numeric, effective_date date, created_at timestamptz, source text, supplier_id uuid, invoice_id uuid, invoice_line_id uuid, invoice_number text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT history_id, price, effective_date, created_at, source, NULL::uuid, NULL::uuid, NULL::uuid, NULL::text
    FROM test_candidates WHERE raw_material_id = p_raw_material_id AND effective_date <= p_as_of
   ORDER BY effective_date DESC, created_at DESC, history_id DESC $$;
GRANT EXECUTE ON FUNCTION public.has_ravarer_access(uuid,uuid,public.access_level) TO authenticated;

\i 20261012_varetelling_foundation.PENDING.sql

CREATE FUNCTION pg_temp.expect_error(p_sql text, p_state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE p_sql; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE <> p_state THEN RAISE EXCEPTION 'Forventet % fikk % (%): %', p_state, SQLSTATE, SQLERRM, p_sql; END IF;
    RAISE NOTICE 'OK avvist % : %', p_state, left(p_sql, 70); RETURN;
  END;
  RAISE EXCEPTION 'Forventet feil % men lyktes: %', p_state, p_sql;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.expect_error(text,text) TO authenticated, anon;
CREATE FUNCTION pg_temp.ok(c boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF NOT coalesce(c,false) THEN RAISE EXCEPTION 'FEIL: %', msg; END IF; RAISE NOTICE 'OK %', msg; END $$;
GRANT EXECUTE ON FUNCTION pg_temp.ok(boolean,text) TO authenticated, anon;

-- Firma A/B. a1 write, a2 approve, a3 read, a4 write uten fakturatilgang, b1 write i B.
INSERT INTO test_access VALUES
 ('00000000-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000000','write',true),
 ('00000000-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000000','approve',true),
 ('00000000-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-000000000000','read',true),
 ('00000000-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-000000000000','write',false),
 ('00000000-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000000','write',true);
-- m1 bundet verifisert; m2 «verifisert» men foreldet kilde; m3 ukjent enhet; m4 annet firma; m5 lagerført=false uten pris; m6 inaktiv
INSERT INTO raw_materials VALUES
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Hvetemel','M1','kg',10,'verifisert','99999999-0000-0000-0000-000000000001',true,true),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000','Sukker','S1','kg',20,'verifisert','99999999-0000-0000-0000-000000000002',true,false),
 ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000000','Rart','R1','pose',5,'verifisert','99999999-0000-0000-0000-000000000003',true,false),
 ('11111111-0000-0000-0000-000000000004','bbbbbbbb-0000-0000-0000-000000000000','B-vare',NULL,'stk',5,'verifisert',NULL,true,true),
 ('11111111-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000000','Esker',NULL,'stk',NULL,'mangler',NULL,true,false),
 ('11111111-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000000','Gammel',NULL,'kg',NULL,'mangler',NULL,false,false);
INSERT INTO test_candidates VALUES
 ('99999999-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001',10,'2026-01-10','2026-01-11','invoice'),
 ('99999999-0000-0000-0000-0000000000a1','11111111-0000-0000-0000-000000000001',8,'2025-06-01','2026-01-11','invoice'),
 ('99999999-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002',20,'2026-01-10','2026-01-11','invoice'),
 ('99999999-0000-0000-0000-0000000000f2','11111111-0000-0000-0000-000000000002',25,'2026-02-10','2026-02-11','invoice'),
 ('99999999-0000-0000-0000-000000000003','11111111-0000-0000-0000-000000000003',5,'2026-01-10','2026-01-11','invoice');
INSERT INTO raw_material_units (id, raw_material_id, unit_label, units_in_base) VALUES
 ('88888888-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','sekk 25 kg',25),
 ('88888888-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000002','pose 1 kg',1);

-- ===== Rettigheter: ingen direkte skriving, heller ikke arvet =====
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.'||t, 'INSERT') AND NOT has_table_privilege('authenticated', 'public.'||t, 'UPDATE')
  AND NOT has_table_privilege('authenticated', 'public.'||t, 'DELETE') AND NOT has_table_privilege('anon', 'public.'||t, 'SELECT'), 'arvede rettigheter nullstilt: '||t)
  FROM unnest(ARRAY['vt_locations','vt_templates','vt_template_lines','vt_counts','vt_count_lists','vt_count_lines','vt_ops']) t;
SELECT pg_temp.ok(NOT has_table_privilege('authenticated', 'public.vt_ops', 'SELECT'), 'vt_ops uten klientlesing');
SELECT pg_temp.ok(NOT has_function_privilege('authenticated', 'public._vt_op_begin(uuid,text,uuid,uuid,jsonb)', 'EXECUTE'), 'interne hjelpere ikke kjørbare');
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT pg_temp.expect_error($q$INSERT INTO vt_locations (legal_entity_id, department, name, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','X','Y',auth.uid())$q$, '42501');
SELECT pg_temp.expect_error($q$INSERT INTO vt_templates (legal_entity_id, name, department, created_by) VALUES ('aaaaaaaa-0000-0000-0000-000000000000','X','Y',auth.uid())$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT * FROM vt_ops$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT _vt_price_evidence('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','ved_start',current_date,true)$q$, '42501');
SELECT pg_temp.ok((vt_backend_version()->>'version')::int = 2, 'sonde gir versjon 2');

-- ===== Steder =====
SELECT set_config('test.loc1', (vt_save_location('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Bakeri','Tørrlager',0,false)->'location'->>'id'), false);
SELECT set_config('test.loc2', (vt_save_location('a0000000-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Bakeri','Produksjon',1,false)->'location'->>'id'), false);
SELECT pg_temp.ok((vt_save_location('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Bakeri','Tørrlager',0,false)->>'replayed')::boolean, 'sted: samme op-id gir lagret kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_save_location('a0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Bakeri','Annet',0,false)$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_save_location(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'bakeri',' tørrlager ',0,false)$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_save_location(gen_random_uuid(),'bbbbbbbb-0000-0000-0000-000000000000',NULL,NULL,'X','Y',0,false)$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_save_location(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.loc1')::uuid,NULL,'Bakeri','Tørrlager',0,false)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_location(NULL,'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'A','B',0,false)$q$, '22023');
-- Sted i firma B
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT set_config('test.locB', (vt_save_location(gen_random_uuid(),'bbbbbbbb-0000-0000-0000-000000000000',NULL,NULL,'B','Lager',0,false)->'location'->>'id'), false);
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
-- Arkivert sted
SELECT set_config('test.loc3', (vt_save_location(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Butikk','Kjøl',2,false)->'location'->>'id'), false);
SELECT vt_save_location(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.loc3')::uuid,1,'Butikk','Kjøl',2,true);

-- ===== Listemaler =====
CREATE FUNCTION pg_temp.lines(VARIADIC p text[]) RETURNS jsonb LANGUAGE sql AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object('raw_material_id', split_part(x,'@',1), 'location_id', nullif(split_part(x,'@',2),''),
    'count_unit_ids', CASE WHEN split_part(x,'@',3) = '' THEN '[]'::jsonb ELSE jsonb_build_array(split_part(x,'@',3)) END)), '[]'::jsonb)
  FROM unnest(p) x $$;
GRANT EXECUTE ON FUNCTION pg_temp.lines(text[]) TO authenticated;
SELECT set_config('test.t1', (vt_save_template('b0000000-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Tørrlager','Bakeri',current_setting('test.loc1')::uuid,false,
  pg_temp.lines('11111111-0000-0000-0000-000000000001@'||current_setting('test.loc1')||'@88888888-0000-0000-0000-000000000001',
                '11111111-0000-0000-0000-000000000002@'||current_setting('test.loc1'),
                '11111111-0000-0000-0000-000000000003@'||current_setting('test.loc1'),
                '11111111-0000-0000-0000-000000000005@'||current_setting('test.loc1')))->'template'->>'id'), false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_template_lines WHERE template_id=current_setting('test.t1')::uuid) = 4, 'mal med 4 linjer (inkl. ikke-lagerførte varer)');
SELECT pg_temp.ok((SELECT string_agg(raw_material_id::text, ',' ORDER BY sort_order) FROM vt_template_lines WHERE template_id=current_setting('test.t1')::uuid) LIKE '11111111-0000-0000-0000-000000000001,%', 'rekkefølge bevart');
SELECT set_config('test.t2', (vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Produksjon','Bakeri',NULL,false,
  pg_temp.lines('11111111-0000-0000-0000-000000000001@'||current_setting('test.loc2')))->'template'->>'id'), false);
-- Feil: annet firmas vare, sted i annet firma, arkivert sted, fremmed enhet, duplikat i samme mal, inaktiv ny vare
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X1','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000004@'))$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X2','Bakeri',current_setting('test.locB')::uuid,false,NULL)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X3','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000001@'||current_setting('test.locB')))$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X4','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000001@'||current_setting('test.loc3')))$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X5','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000001@@88888888-0000-0000-0000-000000000002'))$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X6','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000001@','11111111-0000-0000-0000-000000000001@'))$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X7','Bakeri',NULL,false,pg_temp.lines('11111111-0000-0000-0000-000000000006@'))$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'X8','Bakeri',NULL,false,'[{"location_id":null}]'::jsonb)$q$, '22023');
SELECT pg_temp.ok((SELECT count(*) FROM vt_templates WHERE name LIKE 'X%') = 0, 'avviste maler etterlater ingenting');
-- Navneendring øker revisjon; foreldet revisjon og null-revisjon avvises
SELECT pg_temp.ok((vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.t2')::uuid,1,'Produksjon hall','Bakeri',NULL,false,NULL)->'template'->>'revision')::int = 2, 'navneendring øker revisjon');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.t2')::uuid,1,'Z','Bakeri',NULL,false,NULL)$q$, '40001');
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.t2')::uuid,NULL,'Z','Bakeri',NULL,false,NULL)$q$, '22023');
-- Kopi: struktur kopieres
SELECT set_config('test.t3', (vt_copy_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',current_setting('test.t1')::uuid,1,'Overlapp')->'template'->>'id'), false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_template_lines WHERE template_id=current_setting('test.t3')::uuid) = 4, 'kopi har samme linjer');
SELECT set_config('test.tEmpty', (vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'Tom','Bakeri',NULL,false,'[]'::jsonb)->'template'->>'id'), false);
-- Leser kan ikke skrive maler
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a3',false);
SELECT pg_temp.expect_error($q$SELECT vt_save_template(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000',NULL,NULL,'R','Bakeri',NULL,false,NULL)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);

-- ===== Tellinger: opprettelse og op-binding =====
SELECT pg_temp.ok(jsonb_array_length(vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', ARRAY[current_setting('test.t1'),current_setting('test.t3')]::uuid[], 'ved_start', NULL)->'duplicates') = 4, 'dekning finner duplikater');
SELECT set_config('test.cOv', (vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','Overlapp',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1'),current_setting('test.t3')]::uuid[])->>'count_id'), false);
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), current_setting('test.cOv')::uuid, 1)$q$, '23505');
SELECT set_config('test.cEmpty', (vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','Tom',current_date,'ved_start',NULL,ARRAY[current_setting('test.tEmpty')]::uuid[])->>'count_id'), false);
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), current_setting('test.cEmpty')::uuid, 1)$q$, '22023');
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines) = 0, 'avviste starter etterlater ingen linjer');
SELECT pg_temp.expect_error($q$SELECT vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','F',current_date,'ved_start',current_date,ARRAY[current_setting('test.t1')]::uuid[])$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','F',current_date,'historisk',current_date + 3,ARRAY[current_setting('test.t1')]::uuid[])$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','F',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1'),current_setting('test.t1')]::uuid[])$q$, '22023');

SELECT pg_temp.ok((vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,'ved_start',NULL,ARRAY[current_setting('test.t2'),current_setting('test.t1')]::uuid[])->>'replayed')::boolean = false, 'opprettet');
SELECT pg_temp.ok((vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1'),current_setting('test.t2')]::uuid[])->>'replayed')::boolean, 'samme op-id + samme normaliserte innhold = samme kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Annet navn',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1'),current_setting('test.t2')]::uuid[])$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1')]::uuid[])$q$, '23505');
SELECT set_config('test.count', (SELECT id::text FROM vt_counts WHERE name='Desember'), false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_counts WHERE name='Desember') = 1, 'én telling');
-- Annen bruker kan ikke gjenbruke op-id
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT pg_temp.expect_error($q$SELECT vt_create_count('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000000','Desember',current_date,'ved_start',NULL,ARRAY[current_setting('test.t1'),current_setting('test.t2')]::uuid[])$q$, '23505');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);

-- Dekning og start bruker samme bevis
SELECT pg_temp.ok((SELECT (c->>'priced')::int = 1 AND (c->>'missing_price')::int = 3 AND (c->'missing_price_by_reason'->>'kostpris_ikke_bekreftet')::int = 1
   AND (c->>'missing_unit')::int = 1 AND (c->'missing_price_by_reason'->>'ingen_dokumentert_pris')::int = 1
  FROM vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', ARRAY[current_setting('test.t1'),current_setting('test.t2')]::uuid[], 'ved_start', NULL) c), 'dekning: 1 bundet pris, foreldet/ukjent enhet/ingen pris skilt');
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), current_setting('test.count')::uuid, NULL)$q$, '22023');
SELECT pg_temp.ok((SELECT (r->>'line_count')::int = 5 AND (r->>'list_count')::int = 2 AND (r->>'priced_count')::int = 2 AND r->>'status' = 'pagar' AND (r->>'revision')::int = 2
  FROM vt_start_count('55555555-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 1) r), 'start: 5 linjer, 2 lister, 2 priset (mel på to steder)');
SELECT pg_temp.ok((vt_start_count('55555555-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 1)->>'replayed')::boolean, 'gjentatt start gir lagret kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_start_count(gen_random_uuid(), current_setting('test.count')::uuid, 2)$q$, '55000');
SELECT pg_temp.ok((SELECT valuation_date = current_date FROM vt_counts WHERE id=current_setting('test.count')::uuid), 'verdsettelsesdato satt ved start');
SELECT pg_temp.ok((SELECT bool_and(snap_price_per_base = 10 AND snap_price_source='dokumentert_kostpris' AND snap_price_history_id='99999999-0000-0000-0000-000000000001' AND snap_price_effective_date='2026-01-10') FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001'), 'bundet pris + kilde frosset');
SELECT pg_temp.ok((SELECT snap_price_per_base IS NULL AND snap_price_reason='kostpris_ikke_bekreftet' FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000002'), '«verifisert» med foreldet kilde gir ingen pris');
SELECT pg_temp.ok((SELECT snap_base_unit IS NULL AND snap_price_reason='enhet_ukjent' FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000003'), 'ukjent enhet blir ikke stk');
SELECT pg_temp.ok((SELECT snap_units->0->>'label' FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id=current_setting('test.loc1')::uuid) = 'sekk 25 kg', 'telleenhet frosset');
RESET ROLE;
UPDATE raw_materials SET current_cost_price = 99, name='Endret' WHERE id='11111111-0000-0000-0000-000000000001';
UPDATE raw_material_units SET units_in_base = 50;
UPDATE vt_templates SET name = 'Endret mal' WHERE id = current_setting('test.t1')::uuid;
SET ROLE authenticated;
SELECT pg_temp.ok((SELECT bool_and(snap_price_per_base = 10 AND snap_name='Hvetemel') FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001')
  AND (SELECT (snap_units->0->>'units_in_base')::numeric = 25 FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id=current_setting('test.loc1')::uuid), 'snapshot uendret etter pris/pakning/mal-endring');
SELECT pg_temp.expect_error($q$UPDATE vt_count_lines SET snap_price_per_base = 1$q$, '42501');
SELECT pg_temp.expect_error($q$UPDATE vt_count_lines SET counted_base = 1$q$, '42501');

-- ===== Linjelagring: serverberegnet mengde =====
SELECT set_config('test.l1', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id=current_setting('test.loc1')::uuid), false);
SELECT set_config('test.l2', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000001' AND location_id=current_setting('test.loc2')::uuid), false);
SELECT set_config('test.l3', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000002'), false);
SELECT set_config('test.l4', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000003'), false);
SELECT set_config('test.l5', (SELECT id::text FROM vt_count_lines WHERE raw_material_id='11111111-0000-0000-0000-000000000005'), false);
-- Forfalskede faktorer ignoreres: 3 sekker (frosset 25) + 7,5 kg = 82,5 uansett klientens «units_in_base»
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 0, 'talt', 157.5, '[{"unit_id":"88888888-0000-0000-0000-000000000001","amount":3,"units_in_base":50},{"unit_id":null,"amount":7.5}]', null)$q$, '22023');
SELECT pg_temp.ok((vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 82.5, '[{"unit_id":"88888888-0000-0000-0000-000000000001","amount":3,"units_in_base":50,"label":"falsk"},{"unit_id":null,"amount":7.5}]', null)->>'ok')::boolean, 'lagret 82,5');
SELECT pg_temp.ok((SELECT counted_base = 82.5 AND entry->0->>'label' = 'sekk 25 kg' AND (entry->0->>'units_in_base')::numeric = 25 FROM vt_count_lines WHERE id=current_setting('test.l1')::uuid), 'server bygger registrering fra frosne enheter');
SELECT pg_temp.ok((vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 82.5, '[{"unit_id":"88888888-0000-0000-0000-000000000001","amount":3,"units_in_base":50,"label":"falsk"},{"unit_id":null,"amount":7.5}]', null)->>'replayed')::boolean, 'samme op-id gjentatt = lagret kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 4, '[{"unit_id":null,"amount":4}]', null)$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 'NaN', '[{"unit_id":null,"amount":1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 'Infinity', '[{"unit_id":null,"amount":1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 1, '[{"unit_id":null,"amount":"1"}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', -1, '[{"unit_id":null,"amount":-1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 2, '[{"unit_id":null,"amount":1},{"unit_id":null,"amount":1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 25, '[{"unit_id":"88888888-0000-0000-0000-000000000002","amount":1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 0, '[{"unit_id":null,"amount":0}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 1, '{"unit_id":null}', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'null', 5, '[]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, NULL, 'talt', 1, '[{"unit_id":null,"amount":1}]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, NULL, NULL, '[]', null)$q$, '22023');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 1, '[{"unit_id":null,"amount":1e10}]', null)$q$, '22023');
-- Ukjent baseenhet: kan ikke telles i mengde, men 0 og «må kontrolleres» er lov
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l4')::uuid, 0, 'talt', 1, '[{"unit_id":null,"amount":1}]', null)$q$, '22023');
SELECT pg_temp.ok((SELECT state='ikke_talt' AND revision=0 AND counted_base IS NULL FROM vt_count_lines WHERE id=current_setting('test.l2')::uuid), 'avviste lagringer skrev ingenting');
SELECT pg_temp.ok((vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 99, 'talt', 7, '[{"unit_id":null,"amount":7}]', null)->>'conflict')::boolean, 'foreldet revisjon gir konflikt');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 0, 'talt', 7, '[{"unit_id":null,"amount":7}]', null);
SELECT pg_temp.ok((SELECT sum(counted_base) FROM vt_count_lines WHERE count_id=current_setting('test.count')::uuid AND raw_material_id='11111111-0000-0000-0000-000000000001') = 89.5, '82,5 + 7 summeres per vare');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l3')::uuid, 0, 'talt', 2, '[{"unit_id":null,"amount":2}]', null);
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l4')::uuid, 0, 'ma_kontrolleres', NULL, '[]', 'Ukjent enhet');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l5')::uuid, 0, 'null', 0, '[]', null);

-- Andre brukere
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000b1',false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines) = 0, 'annet firma ser ingenting');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 1, 'null', 0, '[]', null)$q$, '42501');
-- Annet firmas bruker kan ikke spille av kvittering
SELECT pg_temp.expect_error($q$SELECT vt_save_line('66666666-0000-0000-0000-000000000001', current_setting('test.l1')::uuid, 0, 'talt', 82.5, '[]', null)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a3',false);
SELECT pg_temp.ok((SELECT count(*) FROM vt_count_lines WHERE count_id=current_setting('test.count')::uuid) = 5, 'leser ser linjer');
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l1')::uuid, 1, 'null', 0, '[]', null)$q$, '42501');

-- ===== Liste- og tellingsstatus =====
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT set_config('test.list1', (SELECT count_list_id::text FROM vt_count_lines WHERE id=current_setting('test.l1')::uuid), false);
SELECT set_config('test.list2', (SELECT count_list_id::text FROM vt_count_lines WHERE id=current_setting('test.l2')::uuid), false);
-- Avslutning før listene er godkjent avvises
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, 2, 'avsluttet', null)$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'godkjent')$q$, '55000');
SELECT pg_temp.expect_error($q$SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, NULL, 'til_kontroll')$q$, '22023');
SELECT pg_temp.ok((vt_set_list_status('77777777-0000-0000-0000-0000000000a1', current_setting('test.list2')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list2')::uuid), 'til_kontroll')->>'status') = 'til_kontroll', 'liste 2 til kontroll');
SELECT pg_temp.ok((SELECT r->>'status' = 'godkjent' FROM vt_set_list_status('77777777-0000-0000-0000-0000000000a2', current_setting('test.list2')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list2')::uuid), 'godkjent') r), 'liste 2 godkjent');
-- Godkjent liste låser linjene
SELECT pg_temp.expect_error($q$SELECT vt_save_line(gen_random_uuid(), current_setting('test.l2')::uuid, 1, 'talt', 8, '[{"unit_id":null,"amount":8}]', null)$q$, '55000');
-- Skriver kan ikke godkjenne
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l4')::uuid, 1, 'ikke_her', NULL, '[]', 'Ikke her');
SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'til_kontroll');
SELECT pg_temp.expect_error($q$SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'godkjent')$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, 2, 'avsluttet', null)$q$, '42501');
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a2',false);
SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'godkjent');
-- Sukker talt 2 uten pris => avslutning stoppes
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, 2, 'avsluttet', null)$q$, '55000');
SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'under_telling');
SELECT vt_save_line(gen_random_uuid(), current_setting('test.l3')::uuid, 1, 'ikke_her', NULL, '[]', 'Flyttet');
SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'til_kontroll');
SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'godkjent');
SELECT pg_temp.expect_error($q$SELECT vt_transition_count(gen_random_uuid(), current_setting('test.count')::uuid, NULL, 'avsluttet', null)$q$, '22023');
SELECT pg_temp.ok((vt_transition_count('77777777-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 2, 'avsluttet', null)->>'status') = 'avsluttet', 'avsluttet');
SELECT pg_temp.ok((vt_transition_count('77777777-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 2, 'avsluttet', null)->>'replayed')::boolean, 'gjentatt avslutning gir lagret kvittering');
SELECT pg_temp.expect_error($q$SELECT vt_transition_count('77777777-0000-0000-0000-000000000001', current_setting('test.count')::uuid, 2, 'avbrutt', 'feil')$q$, '23505');
SELECT pg_temp.expect_error($q$SELECT vt_set_list_status(gen_random_uuid(), current_setting('test.list1')::uuid, (SELECT revision FROM vt_count_lists WHERE id=current_setting('test.list1')::uuid), 'under_telling')$q$, '55000');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE vt_count_lines SET note = 'x' WHERE id=current_setting('test.l1')::uuid$q$, '42501');
SELECT pg_temp.expect_error($q$UPDATE vt_count_lists SET status = 'under_telling' WHERE id=current_setting('test.list1')::uuid$q$, '42501');
SELECT pg_temp.expect_error($q$DELETE FROM vt_counts$q$, '42501');

-- ===== Historisk verdsettelse: eksplisitt, aldri dagens pris =====
SET ROLE authenticated; SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a1',false);
SELECT set_config('test.cH', (vt_create_count(gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000000','Varetelling 31.12.2025','2025-12-31','historisk','2025-12-31',ARRAY[current_setting('test.t2')]::uuid[])->>'count_id'), false);
SELECT vt_start_count(gen_random_uuid(), current_setting('test.cH')::uuid, 1);
SELECT pg_temp.ok((SELECT snap_price_per_base = 8 AND snap_price_source='historisk_dokumentert' AND snap_price_as_of='2025-12-31' AND snap_price_known_after_valuation FROM vt_count_lines WHERE count_id=current_setting('test.cH')::uuid), 'historisk: kandidat for datoen (8), ikke dagens (10); registrert etter merkes');
-- Uten fakturatilgang: ingen pris
SELECT set_config('test.uid','00000000-0000-0000-0000-0000000000a4',false);
SELECT pg_temp.ok((SELECT (c->>'priced')::int = 0 AND (c->'missing_price_by_reason'->>'fakturatilgang_mangler')::int = 1 FROM vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', ARRAY[current_setting('test.t2')]::uuid[], 'ved_start', NULL) c), 'uten fakturatilgang: ingen pris');
RESET ROLE;
SELECT pg_temp.ok((SELECT bool_and(NOT stock_tracking) FROM raw_materials WHERE id IN ('11111111-0000-0000-0000-000000000002','11111111-0000-0000-0000-000000000005')), 'lagerføring aldri slått på');
-- anon har ingen tilgang
SET ROLE anon;
SELECT pg_temp.expect_error($q$SELECT * FROM vt_counts$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_check_coverage('aaaaaaaa-0000-0000-0000-000000000000', '{}', 'ved_start', NULL)$q$, '42501');
SELECT pg_temp.expect_error($q$SELECT vt_backend_version()$q$, '42501');
RESET ROLE;
SELECT 'ALLE VARETELLING-SQL-TESTER BESTÅTT' AS resultat;
