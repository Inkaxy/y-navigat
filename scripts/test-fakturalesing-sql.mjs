// Opplæring av fakturaleseren: kjører 20261122_fakturalesing_opplaering.PENDING.sql mot innebygd PostgreSQL (PGlite)
// med stubber for tilgang og tabellene filen leser. Kontrollerer at alt er AV uten rad, at bare godkjenner kan endre,
// at bare innloggede mennesker kan lagre eksempler (aldri tjenestekall), dedup, katalog, profil og fasit. Rører aldri live.
// Bruk: node scripts/test-fakturalesing-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pending = readFileSync(join(root, "supabase/pending/20261122_fakturalesing_opplaering.PENDING.sql"), "utf8");
const check = readFileSync(join(root, "supabase/pending/20261122_fakturalesing_opplaering.check.sql"), "utf8");

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$
  select case when $2 = 'write' then coalesce(current_setting('test.level', true), 'approve') in ('write','approve')
              else coalesce(current_setting('test.level', true), 'approve') in ('read','write','approve') end $$;
create function public.has_ravarer_invoice_approve(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.level', true), 'approve') = 'approve' $$;
create function public.rm_sku_norm(p text) returns text language sql immutable as $$ select regexp_replace(lower(coalesce(p,'')), '[^a-z0-9]', '', 'g') $$;
create function public.rm_match_key(p text) returns text language sql immutable as $$ select btrim(regexp_replace(lower(coalesce(p,'')), '[^[:alnum:]æøå]+', ' ', 'g')) $$;
create table legal_entities (id uuid primary key);
create table suppliers (id uuid primary key, legal_entity_id uuid, name text, track_invoice_lines boolean default true, invoice_count int default 0);
create table ai_provider_config (id uuid primary key, provider text, model text, purpose text, is_active boolean);
create table invoices (id uuid primary key, legal_entity_id uuid, supplier_id uuid, status text default 'needs_review', invoice_number text,
  invoice_date date, created_at timestamptz default now(), total_amount numeric, total_vat numeric, is_credit_note boolean default false, lines_sum_status text default 'ok');
create table invoice_lines (id uuid primary key, invoice_id uuid, line_number int, created_at timestamptz default now(), supplier_sku text, description text,
  quantity numeric, unit text, unit_price numeric, total_amount numeric, package_size numeric, package_unit text, count_per_package numeric,
  line_kind text, unit_price_basis text, discount_amount numeric, excluded_at timestamptz);
create table invoice_extraction_examples (id uuid primary key default gen_random_uuid(), legal_entity_id uuid not null, supplier_id uuid not null,
  supplier_sku_norm text, description_key text, original jsonb not null, corrected jsonb not null, note text, source_correction_id uuid,
  is_active boolean not null default true, created_by uuid, created_at timestamptz not null default now(), deactivated_at timestamptz,
  deactivated_by uuid, accepted_issues jsonb not null default '[]');
create table raw_materials (id uuid primary key, legal_entity_id uuid, name text, base_unit text, is_active boolean default true);
create table raw_material_suppliers (id uuid primary key, raw_material_id uuid, supplier_id uuid, supplier_sku text, supplier_product_name text,
  package_size numeric, package_unit text, base_units_per_package numeric, package_confirmed_at timestamptz, last_invoice_date date, updated_at timestamptz default now());
create table raw_material_supplier_aliases (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid, alias_type text, alias_value text, status text);
create table audit_log (id uuid primary key default gen_random_uuid(), occurred_at timestamptz default now(), user_id uuid, action text not null,
  entity_type text not null, entity_id uuid, legal_entity_id uuid, changes jsonb, reason text, source_app text);
`;

const LE = "00000000-0000-0000-0000-0000000000a1";
const SUP = "00000000-0000-0000-0000-0000000000b1";
const INV = "00000000-0000-0000-0000-0000000000c1";
const INV2 = "00000000-0000-0000-0000-0000000000c2";
const L1 = "00000000-0000-0000-0000-0000000000d1";
const L2 = "00000000-0000-0000-0000-0000000000d2";
const U = "00000000-0000-0000-0000-0000000000e1";
const CFG = "00000000-0000-0000-0000-0000000000f1";
const RM = "00000000-0000-0000-0000-000000000101";
const RMS = "00000000-0000-0000-0000-000000000201";

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const expect = (cond, m) => { if (!cond) fail(m); ok++; };
const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const as = async (uid, level) => db.exec(`select set_config('test.uid', '${uid ?? ""}', false); select set_config('test.level', '${level}', false);`);
const throws = async (sql, code) => { try { await db.exec(sql); return false; } catch (e) { const hit = code ? String(e.message).includes(code) || e.code === code : true; if (!hit) console.error('uventet feil:', e.message); return hit; } };

await db.exec(stub);
// Byte-identisk live-definisjon (hentet 18.11) – kontrollfilen sjekker at den er urørt.
await db.exec(readFileSync(join(root, "scripts/fixtures/live-20261118/rm_extraction_examples_for.sql"), "utf8"));
expect((await one(`select md5(pg_get_functiondef('public.rm_extraction_examples_for(uuid,uuid,integer)'::regprocedure)) m`)).m === "f7d5e490a436da2aef661cbcbda31f38", "fixture gir live-md5");
await db.exec(`create function public.rm_extraction_example_is_safe(uuid) returns boolean language sql stable as $$ select true $$;`);
await db.exec(readFileSync(join(root, "scripts/fixtures/live-20261118/rm_set_extraction_example_active.sql"), "utf8"));
expect((await one(`select md5(pg_get_functiondef('public.rm_set_extraction_example_active(uuid,boolean,text)'::regprocedure)) m`)).m === "0687d0b8037820d87d69f3fcdfa57c43", "fixture gir live-md5 (av/på)");
await db.exec(`insert into legal_entities values ('${LE}');
insert into suppliers values ('${SUP}', '${LE}', 'ASKO ØST AS', true, 56);
insert into ai_provider_config values ('${CFG}', 'openai', 'gpt-6.1-sol', 'invoice_extraction', false);
insert into invoices (id, legal_entity_id, supplier_id, invoice_number, invoice_date, total_amount, total_vat) values
  ('${INV}', '${LE}', '${SUP}', '330351601', '2026-11-01', 4303.35, 860.67), ('${INV2}', '${LE}', '${SUP}', '330351602', '2026-11-02', 100, 20);
update invoices set lines_sum_status = 'mismatch' where id = '${INV2}';
insert into invoice_lines (id, invoice_id, line_number, supplier_sku, description, quantity, unit, unit_price, total_amount, line_kind) values
  ('${L1}', '${INV}', 1, '9727', 'ISTE CHAI 1L 6X1L D-PAK', 1, 'stk', 573.78, 3442.68, 'vare'),
  ('${L2}', '${INV2}', 1, null, 'FRAKT', 1, 'stk', 80, 80, 'frakt');
insert into raw_materials values ('${RM}', '${LE}', 'Iste chai', 'l');
insert into raw_material_suppliers (id, raw_material_id, supplier_id, supplier_sku, supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at, last_invoice_date)
  values ('${RMS}', '${RM}', '${SUP}', '29 9727', 'ISTE CHAI 1L', 6, 'l', 6, now(), '2026-11-01');
insert into raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status) values
  ('${RMS}', 'supplier_sku', '299727', 'confirmed'), ('${RMS}', 'product_name', 'ISTE CHAI 6X1L', 'confirmed'), ('${RMS}', 'supplier_sku', '305-11', 'rejected');`);

const before = await db.query(check.split("-- STOPP")[0]);
expect(before.rows.length === 10 && before.rows.every((x) => x.for_ok === true), "check.sql før: " + JSON.stringify(before.rows.filter((x) => x.for_ok !== true)));
await db.exec(pending);
// Kontrollfil rett etter kjøring: alle etter_ok
const after = await db.query(check.split("-- STOPP")[0]);
expect(after.rows.every((x) => x.etter_ok === true), "check.sql etter: " + JSON.stringify(after.rows.filter((x) => x.etter_ok !== true)));
expect((await one(`select public.rm_cap_fakturalesing_v1() as v`)).v === true, "markør");
expect(await throws(pending, "allerede kjørt"), "andre kjøring stopper");
await db.exec("rollback");

// Alt AV uten rad
await as(U, "read");
let s = (await one(`select public.rm_reading_settings('${LE}') as s`)).s;
expect(s.catalog === false && s.profile === false && s.learning === false && s.self_check === false && s.revision === 0, "alt av uten rad");

// Bare godkjenner kan lagre
expect(await throws(`select public.rm_save_reading_settings('${LE}', '{"catalog": true}', 0)`, "forbidden"), "lesetilgang kan ikke lagre");
await as(U, "write");
expect(await throws(`select public.rm_save_reading_settings('${LE}', '{"catalog": true}', 0)`, "forbidden"), "skrivetilgang kan ikke lagre");
await as(null, "approve");
expect(await throws(`select public.rm_save_reading_settings('${LE}', '{"catalog": true}', 0)`, "forbidden"), "tjenestekall kan ikke lagre");
await as(U, "approve");
let r = (await one(`select public.rm_save_reading_settings('${LE}', '{"catalog": "true", "self_check": true, "strong_config_id": "${CFG}"}', 0) as r`)).r;
expect(r.ok === true && r.revision === 1, "godkjenner lagrer");
s = (await one(`select public.rm_reading_settings('${LE}') as s`)).s;
expect(s.catalog === false && s.self_check === true && s.strong_config_id === CFG, "bare ekte true slår på; sterkere modell lagret");
r = (await one(`select public.rm_save_reading_settings('${LE}', '{"learning": true}', 0) as r`)).r;
expect(r.ok === false && r.code === "endret", "utdatert revisjon avvises");
r = (await one(`select public.rm_save_reading_settings('${LE}', '{"learning": true, "strong_config_id": "00000000-0000-0000-0000-000000000999"}', 1) as r`)).r;
expect(r.ok === false && r.code === "ukjent_modell", "ukjent modell avvises");
expect(Number((await one(`select count(*) n from audit_log where action = 'invoice_reading.settings_saved'`)).n) === 1, "revisjonslogg");
const opts = (await one(`select public.rm_reading_model_options('${LE}') as o`)).o;
expect(Array.isArray(opts) && opts[0].model === "gpt-6.1-sol" && !("encrypted_api_key" in opts[0]), "modellvalg uten nøkler");

// Læring: AV → ingen eksempel
r = (await one(`select public.rm_record_extraction_example('${L1}', 'antall', '{"quantity": 6}', '6 flasker, ikke 1') as r`)).r;
expect(r.ok === false && r.code === "av", "læring av lagrer ikke");
await db.query(`select public.rm_save_reading_settings('${LE}', '{"learning": true, "self_check": true, "strong_config_id": "${CFG}"}', 1)`);
await as(null, "approve");
expect(await throws(`select public.rm_record_extraction_example('${L1}', 'antall', '{"quantity": 6}', null)`, "forbidden"), "tjenestekall (samlet gjenlesing) kan aldri lage eksempel");
await as(U, "read");
expect(await throws(`select public.rm_record_extraction_example('${L1}', 'antall', '{"quantity": 6}', null)`, "forbidden"), "lesetilgang kan ikke lagre eksempel");
await as(U, "write");
r = (await one(`select public.rm_record_extraction_example('${L1}', 'antall', '{"quantity": 6, "hack": "x"}', '6 flasker, ikke 1') as r`)).r;
expect(r.ok === true && r.id, "menneskelig retting lagres");
const ex = await one(`select * from invoice_extraction_examples where id = '${r.id}'`);
expect(ex.original.quantity === 1 && ex.corrected.quantity === 6 && !("hack" in ex.corrected) && ex.source_kind === "antall" && ex.item_key === "sku:9727" && ex.created_by === U, "original fra linjen, rettet filtrert");
r = (await one(`select public.rm_record_extraction_example('${L1}', 'antall', '{"quantity": 6}', null) as r`)).r;
expect(r.ok === true && r.duplicate === true, "samme retting lagres ikke to ganger");
expect((await one(`select public.rm_record_extraction_example('${L1}', 'gjett', '{"quantity": 6}', null) as r`)).r.code === "ugyldig", "ukjent type avvises");
let list = (await one(`select public.rm_extraction_examples_for_v2('${LE}', '${SUP}', 10) as l`)).l;
expect(list.length === 1 && list[0].source_kind === "antall", "eksempel sendes med lesing");
await as(U, "read");
expect(await throws(`select public.rm_set_extraction_example_active('${ex.id}', false, null)`, "forbidden"), "lesetilgang kan ikke slå av eksempel (dagens funksjon)");
await as(U, "write");
expect((await one(`select public.rm_set_extraction_example_active('${ex.id}', false, null) as r`)).r.ok === true, "eksempel slås av med dagens funksjon");
list = (await one(`select public.rm_extraction_examples_for_v2('${LE}', '${SUP}', 10) as l`)).l;
expect(list.length === 0, "avslått eksempel sendes ikke");
const all = (await one(`select public.rm_extraction_examples_list('${LE}', null, 50) as l`)).l;
expect(all.length === 1 && all[0].is_active === false && all[0].supplier_name === "ASKO ØST AS", "innstillingssiden ser avslåtte eksempler");

// Katalog
const cat = (await one(`select public.rm_supplier_reading_catalog('${LE}', '${SUP}', 50) as c`)).c;
expect(cat.length === 1 && cat[0].sku_norm === "299727" && cat[0].sku_printed.includes("29 9727") && cat[0].sku_printed.includes("299727") && !cat[0].sku_printed.includes("305-11"), "katalog: trykte former, avviste alias utelatt");
expect(cat[0].aliases.includes("ISTE CHAI 6X1L") && cat[0].package.base_units === 6 && cat[0].base_unit === "l", "katalog: skrivemåter, bekreftet pakning, grunnenhet");
expect((await one(`select public.rm_supplier_reading_catalog('${LE}', '00000000-0000-0000-0000-000000000bbb', 50) as c`)).c.length === 0, "fremmed leverandør gir tom katalog");

// Profil
await as(U, "approve");
const st = (await one(`select public.rm_supplier_profile_draft_stats('${LE}', '${SUP}') as s`)).s;
expect(st.invoices === 2 && st.vare_lines === 1 && st.descriptions_dpak === 1 && st.package_examples.includes("6X1L"), "utkaststatistikk");
r = (await one(`select public.rm_save_supplier_profile('${LE}', '${SUP}', '{"sku": {"shapes": ["99 9999"]}}', 'utkast', 0, '{"invoice_ids": []}') as r`)).r;
expect(r.ok && r.revision === 1, "utkast lagret");
expect((await one(`select public.rm_supplier_profile_for_reading('${LE}', '${SUP}') as p`)).p === null, "utkast sendes ikke med lesingen");
r = (await one(`select public.rm_save_supplier_profile('${LE}', '${SUP}', '{"sku": {"shapes": ["99 9999"]}}', 'bekreftet', 1, null) as r`)).r;
expect(r.ok && r.revision === 2, "bekreftet");
expect((await one(`select public.rm_supplier_profile_for_reading('${LE}', '${SUP}') as p`)).p.sku.shapes[0] === "99 9999", "bekreftet profil sendes");
const profs = (await one(`select public.rm_supplier_profiles('${LE}') as p`)).p;
expect(profs[0].status === "bekreftet" && profs[0].confirmed_by === U, "profiloversikt");
await as(U, "write");
expect(await throws(`select public.rm_save_supplier_profile('${LE}', '${SUP}', '{}', 'utkast', 2, null)`, "forbidden"), "skrivetilgang kan ikke endre profil");

// Fasit
await as(U, "approve");
r = (await one(`select public.rm_mark_gold_invoice('${INV}', 'kontrollert') as r`)).r;
expect(r.ok && r.line_count === 1, "fasit merket");
expect((await one(`select public.rm_mark_gold_invoice('${INV2}', null) as r`)).r.code === "sumavvik", "faktura med sumavvik kan ikke bli fasit");
await db.query(`update invoice_lines set quantity = 99 where id = '${L1}'`);
let gold = (await one(`select public.rm_gold_invoices('${LE}') as g`)).g;
expect(gold.length === 1 && Number(gold[0].lines[0].quantity) === 1, "fasit er fryst ved merking");
expect((await one(`select public.rm_unmark_gold_invoice('${INV}') as r`)).r.ok, "fasit avmerket");
gold = (await one(`select public.rm_gold_invoices('${LE}') as g`)).g;
expect(gold.length === 0, "avmerket fasit vises ikke");


console.log(`OK – ${ok} kontroller grønne`);
