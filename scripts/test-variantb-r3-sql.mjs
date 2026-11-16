// Runde 3 av variant B: kjører 20261118_handelsvarer og 20261118_prisgrunnlag mot innebygd PostgreSQL
// (PGlite) med live-definisjonene fra 16.11 som utgangspunkt. Rører aldri live.
// Bruk: node scripts/test-variantb-r3-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
// PGlite lager egen funksjonstekst: md5-vakten byttes mot innholdskontrollen (replace må treffe).
const hv = read("supabase/pending/20261118_handelsvarer.PENDING.sql");
const pg = read("supabase/pending/20261118_prisgrunnlag.PENDING.sql")
  .replace("if md5(v_def) <> 'da19eefad08a54909ed6b87149b37845' then", "if false then")
  .replace("if md5(v_def) <> '1c4d594c42078a473b825d69a2624b3d' then", "if false then");

const stub = `
create role anon; create role authenticated; create role service_role;
create type price_level as enum ('internpris','engros','utsalg');
create function public.has_position_in_entity(uuid) returns boolean language sql stable as $$ select true $$;
create function public.is_platform_admin() returns boolean language sql stable as $$ select false $$;
create function public.has_app_write_access(text) returns boolean language sql stable as $$ select true $$;
create function public.tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create table products (id uuid primary key, legal_entity_id uuid, display_name text, calc_type text, mva_rate numeric default 15);
create table entity_calc_settings (legal_entity_id uuid primary key, packaging_mode text);
create table price_lists (id uuid primary key, legal_entity_id uuid, code text, display_name text, price_level price_level, is_provisional boolean default false, prices_include_mva boolean default false, status text default 'active');
create table price_list_items (price_list_id uuid, product_id uuid, price numeric, valid_from date, valid_to date);
create table raw_materials (id uuid primary key, legal_entity_id uuid);
create table recipe_packaging_lines (id uuid);
create function public.resolve_margin_target(uuid, price_level) returns table(target_brutto_pct numeric, target_dg2_pct numeric, warn_below_pp numeric, source text)
  language sql stable as $$ select 60::numeric, 40::numeric, 3::numeric, 'standard'::text $$;
create function public.product_cost(uuid) returns jsonb language sql stable as $$
  select jsonb_build_object('has_cost', true, 'quality', 'A', 'raw_cost', 30, 'labor_cost', 20, 'energy_cost', 0, 'packaging_cost', 10) $$;
`;

const LE = "00000000-0000-0000-0000-00000000000a";
const P = "00000000-0000-0000-0000-0000000000p1".replace("p1", "01");
const PL = "00000000-0000-0000-0000-0000000000a1";
const RM = "00000000-0000-0000-0000-0000000000b1";

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check = (cond, m) => { if (!cond) fail(m); ok++; };

const db = new PGlite();
const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(`${name}: ${e.message}`); } };
await step("stubb", () => db.exec(stub));
await step("h4", () => db.exec(read("scripts/fixtures/live-20261116/h4_margin_eval.sql")));
await step("pm", () => db.exec(read("scripts/fixtures/live-20261116/product_margins.sql")));
await step("data", () => db.exec(`insert into products values ('${P}', '${LE}', 'Kransekake', 'oppskrift', 15);
  insert into price_lists values ('${PL}', '${LE}', 'engros_base', 'Engros', 'engros');
  insert into price_list_items values ('${PL}', '${P}', 100, '2026-01-01', null);
  insert into raw_materials values ('${RM}', '${LE}');
  insert into entity_calc_settings values ('${LE}', 'legges_til');`));

const h4 = async () => (await db.query(`select * from h4_margin_eval('${P}', 'engros', 100, false, 'oppskrift', product_cost('${P}'))`)).rows[0];
const before = await step("h4 før", h4);
check(Number(before.brutto_pct) === 70 && Number(before.dg2_pct) === 50, "før: Brutto 70 / DG2 50 uten emballasje");

// Prisgrunnlag
try { await db.exec(pg); } catch (e) { fail("prisgrunnlag-filen: " + e.message); }
const on = await h4();
check(Number(on.brutto_pct) === 60, `null = på: Brutto 60 med emballasje (fikk ${on.brutto_pct})`);
check(Number(on.dg2_pct) === 40, `null = på: DG2 40 med emballasje (fikk ${on.dg2_pct})`);
check(Math.abs(Number(on.needed_price) - 100) < 1e-9, `nødvendig pris tar med emballasje (fikk ${on.needed_price})`);
const pm = (await db.query(`select product_margins('${P}') m`)).rows[0].m;
check(pm.packaging_in_margins === true, "product_margins sier packaging_in_margins=true");
check(Number(pm.levels[0].brutto_pct) === 60 && Number(pm.levels[0].dg2_pct) === 40, "product_margins Brutto 60 / DG2 40");
check(Number(pm.cost.raw_cost) === 30, "kostobjektet er uendret (raw_cost 30)");
await db.exec(`update entity_calc_settings set packaging_in_margins = false`);
const off = await h4();
check(Number(off.brutto_pct) === 70 && Number(off.dg2_pct) === 50, "av: tilbake til dagens regel");
const pmOff = (await db.query(`select product_margins('${P}') m`)).rows[0].m;
check(pmOff.packaging_in_margins === false && Number(pmOff.levels[0].brutto_pct) === 70, "product_margins av: Brutto 70");
check((await db.query(`select varer_cap_prisgrunnlag_v1() c`)).rows[0].c === true, "cap prisgrunnlag");

// Vakten stopper når teksten ikke finnes (simulert endret definisjon)
const db2 = new PGlite();
await db2.exec(stub);
await db2.exec(read("scripts/fixtures/live-20261116/h4_margin_eval.sql").replace("v_raw    := nullif", "v_raw := nullif"));
await db2.exec(read("scripts/fixtures/live-20261116/product_margins.sql"));
let stopped = false;
try { await db2.exec(pg); } catch (e) { stopped = /fant ikke linjen/.test(String(e.message)); }
check(stopped, "endret h4_margin_eval stopper hele filen");
check((await db2.query(`select count(*)::int n from information_schema.columns where table_name='entity_calc_settings' and column_name='packaging_in_margins'`)).rows[0].n === 0, "ingenting kjørt etter stopp (transaksjon)");

// Handelsvarer
try { await db.exec(hv); } catch (e) { fail("handelsvarer-filen: " + e.message); }
check((await db.query(`select varer_cap_handelsvarer_v1() c`)).rows[0].c === true, "cap handelsvarer");
await db.exec(`insert into resale_markup_settings (legal_entity_id, price_list_id, factor) values ('${LE}', '${PL}', 1.3)`);
await db.exec(`insert into resale_markup_settings (legal_entity_id, raw_material_id, factor) values ('${LE}', '${RM}', 1.1)`);
await db.exec(`insert into resale_markup_settings (legal_entity_id, price_list_id, raw_material_id, blocked) values ('${LE}', '${PL}', '${RM}', true)`);
let dup = false;
try { await db.exec(`insert into resale_markup_settings (legal_entity_id, price_list_id, factor) values ('${LE}', '${PL}', 1.4)`); } catch { dup = true; }
check(dup, "én standard per prisliste");
let badBlock = false;
try { await db.exec(`insert into resale_markup_settings (legal_entity_id, raw_material_id, blocked) values ('${LE}', '${RM}', true)`); } catch { badBlock = true; }
check(badBlock, "sperre krever både vare og prisliste");
let badScope = false;
try { await db.exec(`insert into resale_markup_settings (legal_entity_id, factor) values ('${LE}', 1.2)`); } catch { badScope = true; }
check(badScope, "rad uten prisliste og vare avvises");
let badFactor = false;
try { await db.exec(`update entity_calc_settings set resale_default_factor = 0.1`); } catch { badFactor = true; }
check(badFactor, "standardfaktor under 0,5 avvises");
await db.exec(`update entity_calc_settings set resale_default_factor = 1.25`);
check(Number((await db.query(`select resale_default_factor f from entity_calc_settings`)).rows[0].f) === 1.25, "standardfaktor lagres");

console.log(`OK-kontroller: ${ok}`);
console.log("ALLE RUNDE 3-SQL-TESTER BESTÅTT");
