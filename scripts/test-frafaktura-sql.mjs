// Demo D «Fra faktura»: kjører 20261119_fra_faktura.PENDING.sql og 20261119_fra_faktura_opprydding.DATAENDRING.sql
// mot innebygd PostgreSQL (PGlite) med live-definisjonen av _rm_cost_candidates fra 17.11. Rører aldri live.
// Bruk: node scripts/test-frafaktura-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const main = read("supabase/pending/20261119_fra_faktura.PENDING.sql")
  .replace("if md5(v_def) <> '5a28cc1e868271452552b30ad1d8ea57' then", "if false then");
const cleanup = read("supabase/pending/20261119_fra_faktura_opprydding.DATAENDRING.sql");
const fixture = read("scripts/fixtures/live-20261117/_rm_cost_candidates.sql");

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type alias_type as enum ('supplier_sku','product_name','ean','gtin');
create type alias_status as enum ('confirmed','pending','rejected','superseded');
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select current_setting('test.write', true) is distinct from 'nei' $$;
create function public.has_ravarer_invoice_approve(uuid) returns boolean language sql stable as $$ select current_setting('test.approve', true) is distinct from 'nei' $$;
create function public.rm_sku_norm(p text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p,''), '[^a-zA-Z0-9]', '', 'g')) $$;
create function public.rm_match_key(p text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce(p,''), '\\s+', ' ', 'g')) $$;
create function public.rm_is_finite(numeric) returns boolean language sql immutable as $$ select $1 is not null $$;
create function public.rm_price_line_validation_reason(uuid) returns text language sql stable as $$ select null::text $$;
create function public.rm_unit_change_at(uuid) returns timestamptz language sql stable as $$ select null::timestamptz $$;
create function public.rm_invoice_has_read_issues(uuid) returns boolean language sql stable as $$ select false $$;
create table audit_log (id serial, user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text, legal_entity_id uuid, changes jsonb, reason text, source_app text, occurred_at timestamptz default now());
create table invoice_match_settings (legal_entity_id uuid primary key, default_price_tolerance_pct numeric default 2, updated_at timestamptz, updated_by uuid);
create table suppliers (id uuid primary key, legal_entity_id uuid, name text, updated_at timestamptz);
create table raw_materials (id uuid primary key, legal_entity_id uuid, name text, primary_supplier_id uuid, current_cost_price numeric, is_active boolean default true, updated_at timestamptz);
create table raw_material_suppliers (id uuid primary key, raw_material_id uuid, supplier_id uuid, package_confirmed_at timestamptz, start_price_unit_change_at timestamptz);
create table raw_material_supplier_aliases (id serial, raw_material_supplier_id uuid, alias_type alias_type, alias_value text, status alias_status,
  confirmed_by uuid, confirmed_at timestamptz, match_count int, last_seen_at timestamptz, rejected_at timestamptz, rejected_by uuid, rejected_reason text,
  alias_value_normalized text generated always as (lower(btrim(alias_value))) stored, unique (alias_type, alias_value_normalized, raw_material_supplier_id));
create table invoices (id uuid primary key, legal_entity_id uuid, supplier_id uuid, status text, flagged_at timestamptz, reconciled_at timestamptz,
  invoice_number text, is_credit_note boolean, currency text, lines_sum_status text);
create function public.rm_invoice_lines_trusted(invoices) returns boolean language sql stable as $$ select true $$;
create table invoice_lines (id uuid primary key, invoice_id uuid, raw_material_id uuid, supplier_sku text, description text, match_confidence text,
  requires_review boolean, review_reason text, price_per_base_unit numeric, base_quantity numeric, expected_price_per_base_unit numeric,
  price_variance_pct numeric, variance_status text, resolution_note text, resolved_by uuid, resolved_at timestamptz, excluded_at timestamptz,
  package_size numeric, package_unit text, total_amount numeric, updated_at timestamptz);
create table invoice_internal_approvals (invoice_id uuid, status text, revoked_at timestamptz);
create table invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table raw_material_price_history (id uuid primary key default gen_random_uuid(), raw_material_id uuid, price numeric, effective_date date, created_at timestamptz default now(),
  source text, supplier_id uuid, invoice_id uuid, invoice_line_id uuid, is_credit boolean, is_legacy boolean, superseded_at timestamptz, currency text, cost_eligible boolean default true);
create table raw_material_price_review_holds (history_id uuid, released_at timestamptz);
create table recipe_lines (raw_material_id uuid); create table recipe_packaging_lines (raw_material_id uuid); create table raw_material_products (raw_material_id uuid);
create function public.rm_apply_derived_cost_price(p uuid) returns numeric language plpgsql as $$
declare v numeric; begin select price into v from public._rm_cost_candidates(p, current_date) limit 1;
update raw_materials set current_cost_price = v where id = p; return v; end $$;
create function public.rm_rematch_invoices(uuid, integer, uuid[], boolean) returns jsonb language sql as $$ select jsonb_build_object('queued', cardinality($3)) $$;
`;

const LE = "00000000-0000-0000-0000-0000000000a1";
const U = "00000000-0000-0000-0000-0000000000e1";
const SA = "00000000-0000-0000-0000-0000000000c1", SB = "00000000-0000-0000-0000-0000000000c2";
const RM = "00000000-0000-0000-0000-0000000000b1", RM2 = "00000000-0000-0000-0000-0000000000b2";
const RMS = "00000000-0000-0000-0000-0000000000d1";
const INV = "00000000-0000-0000-0000-0000000000f1";
const L = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check = (cond, m) => { if (!cond) fail(m); ok++; };
const db = new PGlite();
const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(`${name}: ${e.message}`); } };
const one = async (sql) => (await db.query(sql)).rows[0];

await step("stubb", () => db.exec(stub));
await step("fixture", () => db.exec(fixture));
await step("data", () => db.exec(`
  select set_config('test.uid', '${U}', false);
  insert into suppliers values ('${SA}', '${LE}', 'Idun', null), ('${SB}', '${LE}', 'ASKO', null);
  insert into raw_materials values ('${RM}', '${LE}', 'Hvetemel', '${SA}', null, true, null), ('${RM2}', '${LE}', 'Ny vare', '${SA}', null, true, null);
  insert into raw_material_price_history (raw_material_id, price, effective_date, source, supplier_id) values
    ('${RM}', 10, '2026-10-01', 'manual', '${SA}'), ('${RM}', 8, '2026-11-01', 'manual', '${SB}'), ('${RM}', 9, '2026-09-01', 'agreement', null);
`));
check(Number((await one(`select price from _rm_cost_candidates('${RM}', '2026-11-17') limit 1`)).price) === 8, "før: nyeste uansett leverandør (8)");

await step("hovedfil", () => db.exec(main));
check(Number((await one(`select price from _rm_cost_candidates('${RM}', '2026-11-17') limit 1`)).price) === 10, "null = hovedleverandør (10)");
await db.exec(`update raw_materials set cost_basis_rule = 'billigste' where id = '${RM}'`);
check(Number((await one(`select price from _rm_cost_candidates('${RM}', '2026-11-17') limit 1`)).price) === 8, "billigste siste kjøp (8)");
await db.exec(`update raw_materials set cost_basis_rule = 'avtalt' where id = '${RM}'`);
check(Number((await one(`select price from _rm_cost_candidates('${RM}', '2026-11-17') limit 1`)).price) === 9, "avtalt pris (9)");
await db.exec(`update raw_materials set cost_basis_rule = null, primary_supplier_id = null where id = '${RM}'`);
check(Number((await one(`select price from _rm_cost_candidates('${RM}', '2026-11-17') limit 1`)).price) === 8, "uten hovedleverandør: som i dag (8)");
await db.exec(`update raw_materials set primary_supplier_id = '${SA}' where id = '${RM}'`);

const r1 = (await one(`select rm_set_cost_basis_rule('${RM}', 'billigste') r`)).r;
check(r1.ok === true && Number(r1.cost_after) === 8, "rm_set_cost_basis_rule regner om (8)");
check((await one(`select cost_basis_rule from raw_materials where id='${RM}'`)).cost_basis_rule === "billigste", "regel lagret");
await db.query(`select rm_set_cost_basis_rule('${RM}', 'hovedleverandor')`);
check((await one(`select cost_basis_rule from raw_materials where id='${RM}'`)).cost_basis_rule === null, "hovedleverandør lagres som null");
await db.exec(`select set_config('test.approve', 'nei', false)`);
let denied = false;
try { await db.query(`select rm_set_cost_basis_rule('${RM}', 'avtalt')`); } catch { denied = true; }
check(denied, "regel krever godkjennerrettighet");
denied = false;
try { await db.query(`select rm_set_item_price_jump('${RM}', 30)`); } catch { denied = true; }
check(denied, "egen grense krever godkjennerrettighet");
await db.exec(`select set_config('test.approve', '', false)`);

const s0 = (await one(`select rm_fra_faktura_settings('${LE}') s`)).s;
check(Number(s0.price_jump_pct) === 20 && s0.price_jump_is_default === true && s0.quiet_prices === false, "standard 20 %, regler av");
const s1 = (await one(`select rm_set_fra_faktura_settings('${LE}', 25, true, null) s`)).s;
check(Number(s1.price_jump_pct) === 25 && s1.quiet_prices === true && s1.invoice_package === false, "innstillinger lagret (rad opprettet)");
await db.query(`select rm_set_fra_faktura_settings('${LE}', null, false, false)`);
check((await one(`select rm_fra_faktura_settings('${LE}') s`)).s.price_jump_pct == 20, "null = tilbake til 20 %");
check((await one(`select rm_set_item_price_jump('${RM}', 40) r`)).r.ok === true, "egen grense per vare");
check((await one(`select rm_set_supplier_new_item_type('${SB}', 'emballasje') r`)).r.new_item_type === "emballasje", "leverandørregel");
denied = false;
try { await db.query(`select rm_set_supplier_new_item_type('${SB}', 'tull')`); } catch { denied = true; }
check(denied, "ukjent varetype avvises");

// Skrivemåter
await db.exec(`
  insert into invoices values ('${INV}', '${LE}', '${SA}', 'needs_review', null, null, '770548', false, 'NOK', null);
  insert into raw_material_suppliers values ('${RMS}', '${RM2}', '${SA}', null, null);
  insert into invoice_lines (id, invoice_id, raw_material_id, supplier_sku, description, match_confidence, requires_review, review_reason, resolved_by, price_variance_pct) values
    ('${L(1)}', '${INV}', '${RM2}', '1009', 'Sjokostrøssel mørk 5 kg', 'manual', false, null, '${U}', null),
    ('${L(2)}', '${INV}', '${RM2}', '1009', 'SJOKOSTRØSSEL MØRK 5KG', 'manual', false, null, '${U}', null),
    ('${L(3)}', '${INV}', '${RM2}', '1009', 'Strøssel sjoko mørk', 'manual', false, null, '${U}', null);
  insert into raw_material_price_history (raw_material_id, price, effective_date, source, supplier_id, invoice_line_id) values ('${RM2}', 77.8, '2026-10-28', 'invoice', '${SA}', '${L(1)}');
`);
const n1 = (await one(`select rm_remember_supplier_item_names('${LE}', '${SA}', 'sku:1009', '${RMS}') r`)).r;
check(n1.ok === true && n1.added === 3, `tre skrivemåter husket (fikk ${n1.added})`);
check((await one(`select rm_remember_supplier_item_names('${LE}', '${SA}', 'sku:1009', '${RMS}') r`)).r.added === 0, "andre gang: ingen nye");
check((await one(`select rm_remember_supplier_item_names('${LE}', '${SB}', 'sku:1009', '${RMS}') r`)).r.ok === false, "feil leverandør avvises");

// Angre kobling
const u1 = (await one(`select rm_undo_supplier_item_link('${LE}', '${SA}', 'sku:1009', array['${L(1)}','${L(2)}','${L(3)}']::uuid[], '${RM2}', true) r`)).r;
check(u1.ok === true && u1.undone.length === 3, "tre linjer gjenåpnet");
check(u1.deactivated === true, "ny vare uten bruk settes inaktiv");
check((await one(`select count(*)::int n from invoice_lines where requires_review and raw_material_id is null and review_reason = 'unmatched'`)).n === 3, "linjene er ukoblede spørsmål igjen");
check((await one(`select count(*)::int n from raw_material_price_history where raw_material_id='${RM2}' and superseded_at is not null`)).n === 1, "prisobservasjon erstattet, ikke slettet");
check((await one(`select count(*)::int n from raw_material_supplier_aliases where status = 'rejected'`)).n === 3, "navnealias avvist");
check((await one(`select count(*)::int n from raw_materials`)).n === 2, "ingen råvare slettet");
const u2 = (await one(`select rm_undo_supplier_item_link('${LE}', '${SA}', 'sku:1009', array['${L(1)}']::uuid[], '${RM2}', true) r`)).r;
check(u2.undone.length === 0 && u2.skipped[0].reason === "ikke_koblet", "andre angring: ingenting");

// Opprydding (dry-run)
await step("oppryddingsfil", () => db.exec(cleanup));
await db.exec(`
  update invoice_lines set raw_material_id = '${RM}', match_confidence = 'auto_high', requires_review = true, review_reason = 'price_variance', price_variance_pct = 10 where id = '${L(1)}';
  update invoice_lines set raw_material_id = '${RM}', match_confidence = 'auto_high', requires_review = true, review_reason = 'price_variance', price_variance_pct = 50 where id = '${L(2)}';
  update invoice_lines set raw_material_id = '${RM}', match_confidence = 'auto_high', requires_review = true, review_reason = 'unknown_package_size', package_size = 5, package_unit = 'kg' where id = '${L(3)}';
`);
const before = (await one(`select string_agg(id::text || coalesce(review_reason,''), ',' order by id) s from invoice_lines`)).s;
const d = (await one(`select rm_fra_faktura_cleanup('${LE}', true) r`)).r;
check(d.dry_run === true, "dry-run");
check(d.lines_by_reason.pris_under_grense === 1, `pris under egen grense 40 %: 1 (fikk ${JSON.stringify(d.lines_by_reason)})`);
check(d.lines_by_reason.pakning_fra_faktura === 1, "pakning lest fra faktura: 1");
check(d.lines_by_supplier.length === 2 && d.lines_by_supplier.every((x) => x.supplier === "Idun"), "per leverandør");
check((await one(`select string_agg(id::text || coalesce(review_reason,''), ',' order by id) s from invoice_lines`)).s === before, "dry-run endrer ingenting");
const off = (await one(`select rm_fra_faktura_cleanup('${LE}', false) r`)).r;
check(off.ok === false && off.reason === "regler_av", "kjøring nektes når reglene er av");
await db.query(`select rm_set_fra_faktura_settings('${LE}', 20, true, true)`);
const run = (await one(`select rm_fra_faktura_cleanup('${LE}', false) r`)).r;
check(run.ok === true && run.queue.queued === 1, "kjøring legger fakturaen i køen");
check((await one(`select string_agg(id::text || coalesce(review_reason,''), ',' order by id) s from invoice_lines`)).s === before, "linjene endres ikke direkte");
check((await one(`select rm_cap_fra_faktura_v1() c`)).c === true, "cap");

// Vakten stopper når teksten ikke finnes
const db2 = new PGlite();
await db2.exec(stub);
await db2.exec(fixture.replace("   order by h.effective_date desc", "   order by  h.effective_date desc"));
let stopped = false;
try { await db2.exec(main); } catch (e) { stopped = /fant ikke rekkefølgen/.test(e.message); }
check(stopped, "vakten stopper ved endret definisjon");
await db2.exec("rollback");
check((await db2.query(`select count(*)::int n from information_schema.columns where table_name='raw_materials' and column_name='cost_basis_rule'`)).rows[0].n === 0, "ingenting kjørt når vakten stopper");

console.log(`OK: ${ok} kontroller bestått`);
