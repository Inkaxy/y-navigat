import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * «Slå sammen varer»: kjører PENDING-filen mot innebygd PostgreSQL med en minimal stubb av live-skjemaet.
 * Rører aldri live. Live-triggerne for prishistorikk og pakningsvarianter er forenklet gjengitt (samme
 * unike indeks og samme «gammel variant»-oppførsel), så angring testes mot de samme fellene.
 */
const FILE = path.join(process.cwd(), "supabase/pending/20261120_slaa_sammen_varer.PENDING.sql");
const LE = "11111111-1111-1111-1111-111111111111";
const USER = "99999999-9999-9999-9999-999999999999";
const ASKO = "a0000000-0000-0000-0000-000000000001";
const PALS = "a0000000-0000-0000-0000-000000000002";
const SIRUP_KEEP = "b0000000-0000-0000-0000-000000000001";
const SIRUP_DUP = "b0000000-0000-0000-0000-000000000002";
const BOLLE_KG = "b0000000-0000-0000-0000-000000000003";
const BOLLE_STK = "b0000000-0000-0000-0000-000000000004";
const RMS_KEEP = "c0000000-0000-0000-0000-000000000001";
const RMS_DUP = "c0000000-0000-0000-0000-000000000002";
const RMS_KG = "c0000000-0000-0000-0000-000000000003";
const RMS_STK = "c0000000-0000-0000-0000-000000000004";
const LINE_DUP = "d0000000-0000-0000-0000-000000000001";
const LINE_STK = "d0000000-0000-0000-0000-000000000002";
const RECIPE_LINE = "e0000000-0000-0000-0000-000000000001";

const STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create type public.access_level as enum ('none','read','write','approve','admin');
create type public.alias_type as enum ('supplier_sku','product_name','ean','gtin');
create type public.alias_status as enum ('confirmed','pending','rejected','superseded');
create function public.has_ravarer_access(_user_id uuid, _le uuid, _min public.access_level) returns boolean language sql stable as $$
  select _user_id is not null and coalesce(nullif(current_setting('test.level', true), ''), 'none')::public.access_level >= _min $$;
create function public.rm_sku_norm(text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce($1, ''), '[^a-zA-Z0-9]', '', 'g')) $$;
create table public.legal_entities (id uuid primary key, status text);
create table public.suppliers (id uuid primary key, legal_entity_id uuid, name text);
create table public.raw_materials (id uuid primary key, legal_entity_id uuid not null, name text not null, sku text not null, base_unit text not null,
  category text, categories text[] not null default '{}', item_type text not null default 'ravare', is_active boolean not null default true,
  current_cost_price numeric, cost_basis_status text, unit_weight_grams numeric, declaration_name text, grain_classification text, cereal_type text,
  water_content_pct numeric, density_g_per_ml numeric, allergens_reviewed_at timestamptz, is_composite boolean not null default false,
  components_reviewed_at timestamptz, primary_supplier_id uuid, produced_by_recipe_id uuid, created_at timestamptz not null default now(),
  current_stock numeric not null default 0, stock_tracking boolean not null default false);
create table public.invoice_lines (id uuid primary key, raw_material_id uuid references public.raw_materials(id), base_quantity numeric,
  price_per_base_unit numeric, package_source_rms_id uuid, excluded_raw_material_id uuid, exclusion_prev jsonb, price_acceptance jsonb, total_amount numeric);
create table public.invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table public.vt_counts (id uuid primary key, status text);
create table public.vt_count_lines (id uuid primary key default gen_random_uuid(), count_id uuid, raw_material_id uuid);
create table public.vt_template_lines (id uuid primary key default gen_random_uuid(), template_id uuid, raw_material_id uuid, location_id uuid);
create table public.recipe_lines (id uuid primary key default gen_random_uuid(), recipe_id uuid, raw_material_id uuid, quantity numeric, unit text);
create table public.recipe_packaging_lines (id uuid primary key default gen_random_uuid(), recipe_id uuid, raw_material_id uuid);
create table public.raw_material_components (id uuid primary key default gen_random_uuid(), parent_raw_material_id uuid, component_raw_material_id uuid);
create table public.invoice_line_match_suggestions (id uuid primary key default gen_random_uuid(), invoice_line_id uuid, raw_material_id uuid,
  confidence numeric, match_reason text, rank int, created_at timestamptz default now(), unique (invoice_line_id, raw_material_id));
create table public.stock_movements (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric, source_table text, source_id uuid);
create table public.rm_stock_lots (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric, remaining_base numeric);
create table public.rm_goods_receipts (id uuid primary key default gen_random_uuid(), raw_material_id uuid, quantity_base numeric);
create table public.raw_material_price_history (id uuid primary key default gen_random_uuid(), raw_material_id uuid, invoice_line_id uuid, price numeric,
  superseded_at timestamptz, superseded_reason text, created_at timestamptz default clock_timestamp());
create unique index ux_rmph_invoice_line on public.raw_material_price_history (invoice_line_id) where invoice_line_id is not null and superseded_at is null;
create table public.raw_material_suppliers (id uuid primary key, raw_material_id uuid not null, supplier_id uuid not null, supplier_sku text,
  supplier_product_name text, is_primary boolean not null default false, package_size numeric, package_unit text, base_units_per_package numeric,
  package_confirmed_at timestamptz, package_confirmed_by uuid, container_unit text, agreed_price_per_base_unit numeric, agreement_valid_from date,
  agreement_valid_to date, agreement_document_url text, start_price_per_base_unit numeric, start_price_base_units_per_package numeric,
  start_price_base_unit text, created_at timestamptz default now(), unique (raw_material_id, supplier_id));
create table public.raw_material_supplier_aliases (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid not null,
  alias_type public.alias_type not null, alias_value text not null, alias_value_normalized text, status public.alias_status not null default 'pending',
  match_count int not null default 1, confirmed_by uuid, confirmed_at timestamptz, last_seen_at timestamptz default now(),
  unique (alias_type, alias_value_normalized, raw_material_supplier_id));
create function public.normalize_alias_value() returns trigger language plpgsql as $$
begin new.alias_value_normalized := lower(trim(new.alias_value)); return new; end $$;
create trigger trg_normalize_alias_value before insert or update on public.raw_material_supplier_aliases for each row execute function public.normalize_alias_value();
create table public.raw_material_supplier_packages (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid not null,
  supplier_sku_norm text not null default '', package_size numeric, package_unit text, base_units_per_package numeric not null,
  confirmed_at timestamptz, confirmed_by uuid, container_unit text, superseded_at timestamptz, superseded_reason text);
create unique index rmsp_variant on public.raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm,
  coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package);
-- Live _rms_record_package_variant (byte-lik logikk).
create function public._rms_record_package_variant() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.package_confirmed_at is not null and old.base_units_per_package is not null then
    insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    values (old.id, rm_sku_norm(old.supplier_sku), old.package_size, old.package_unit, old.base_units_per_package, old.package_confirmed_at, old.package_confirmed_by, old.container_unit)
    on conflict do nothing;
  end if;
  if new.package_confirmed_at is not null and new.base_units_per_package is not null then
    insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    values (new.id, rm_sku_norm(new.supplier_sku), new.package_size, new.package_unit, new.base_units_per_package, new.package_confirmed_at, new.package_confirmed_by, new.container_unit)
    on conflict (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package)
    do update set confirmed_at = excluded.confirmed_at, superseded_at = null, superseded_reason = null;
  end if;
  return new;
end $$;
create trigger trg_rms_package_variant after insert or update of package_size, package_unit, base_units_per_package, package_confirmed_at, supplier_sku, container_unit
  on public.raw_material_suppliers for each row execute function public._rms_record_package_variant();
-- Live startprisvakt (forenklet: bare pris-feltet).
create function public.rm_guard_start_price_columns() returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('app.rm_start_price_rpc', true), '') = '1' then return new; end if;
  if tg_op = 'UPDATE' and (new.start_price_per_base_unit, new.start_price_base_unit) is distinct from (old.start_price_per_base_unit, old.start_price_base_unit) then
    raise exception 'Startpris kan bare endres gjennom bekreftelses- eller endringsflyten';
  end if;
  return new;
end $$;
create trigger trg_rm_guard_start_price before insert or update on public.raw_material_suppliers for each row execute function public.rm_guard_start_price_columns();
-- Forenklet fn_invoice_line_match_price_history: avslutt observasjon ved bytte, én aktiv observasjon per linje.
create function public.fn_line_price_history() returns trigger language plpgsql as $$
begin
  if old.raw_material_id is not distinct from new.raw_material_id and old.price_per_base_unit is not distinct from new.price_per_base_unit
     and old.package_source_rms_id is not distinct from new.package_source_rms_id then return new; end if;
  if old.raw_material_id is not null and old.raw_material_id is distinct from new.raw_material_id then
    update raw_material_price_history set superseded_at = coalesce(superseded_at, now()), superseded_reason = coalesce(superseded_reason, 'linje_ukoblet')
     where invoice_line_id = new.id and raw_material_id = old.raw_material_id and superseded_at is null;
  end if;
  if new.raw_material_id is null or new.price_per_base_unit is null then return new; end if;
  if exists (select 1 from raw_material_price_history where invoice_line_id = new.id and superseded_at is null
              and raw_material_id = new.raw_material_id and price = new.price_per_base_unit) then return new; end if;
  update raw_material_price_history set superseded_at = now(), superseded_reason = 'nytt_prisgrunnlag' where invoice_line_id = new.id and superseded_at is null;
  insert into raw_material_price_history (raw_material_id, invoice_line_id, price) values (new.raw_material_id, new.id, new.price_per_base_unit);
  return new;
end $$;
create trigger trg_line_price_history after update of raw_material_id, price_per_base_unit, base_quantity on public.invoice_lines
  for each row execute function public.fn_line_price_history();
create table public.raw_material_purchases (id uuid primary key default gen_random_uuid(), raw_material_id uuid);
create table public.product_cost_additions (id uuid primary key default gen_random_uuid(), raw_material_id uuid);
create table public.raw_material_products (id uuid primary key default gen_random_uuid(), raw_material_id uuid, product_id uuid,
  base_units_per_sold_unit numeric not null default 1, unique (raw_material_id, product_id));
create table public.raw_material_units (id uuid primary key default gen_random_uuid(), raw_material_id uuid, unit_label text, units_in_base numeric,
  is_default_purchase boolean not null default false, is_default_count boolean not null default false, is_sales_unit boolean not null default false);
create table public.negotiation_items (id uuid primary key default gen_random_uuid(), negotiation_id uuid, raw_material_id uuid, unique (negotiation_id, raw_material_id));
create table public.raw_material_nutrition (raw_material_id uuid primary key, energy_kj numeric);
create table public.raw_material_allergens (id uuid primary key default gen_random_uuid(), raw_material_id uuid, allergen text, presence text, unique (raw_material_id, allergen));
create table public.raw_material_datasheets (id uuid primary key default gen_random_uuid(), raw_material_id uuid, is_current boolean);
create table public.price_list_items (id uuid primary key default gen_random_uuid(), price_list_id uuid, product_id uuid);
create table public.audit_log (id bigserial primary key, user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text,
  legal_entity_id uuid, changes jsonb, reason text, source_app text);
-- Forenklet prisvelger: nyeste aktive observasjon er kostpris.
create function public.rm_apply_derived_cost_price(p uuid) returns numeric language plpgsql as $$
declare v numeric;
begin
  select price into v from raw_material_price_history where raw_material_id = p and superseded_at is null order by created_at desc, id desc limit 1;
  update raw_materials set current_cost_price = coalesce(v, current_cost_price), cost_basis_status = case when v is null then 'mangler' else 'verifisert' end where id = p;
  return v;
end $$;
create function public.refresh_purchase_stats() returns void language sql as $$ select $$;
create function public.merge_raw_materials(p_keep uuid, p_dup uuid) returns void language plpgsql as $$ begin delete from raw_materials where id = p_dup; end $$;
`;

const SEED = `
insert into legal_entities values ('${LE}', 'active');
insert into suppliers values ('${ASKO}', '${LE}', 'ASKO ØST AS'), ('${PALS}', '${LE}', 'A/S PALS');
insert into raw_materials (id, legal_entity_id, name, sku, base_unit, category, item_type, current_cost_price, cost_basis_status, created_at) values
  ('${SIRUP_KEEP}', '${LE}', 'KANELBOLLE SIRUP 70CL MONIN', 'sirup-70', 'stk', 'Sukker og søtning', 'ravare', 102.29, 'verifisert', '2026-08-13'),
  ('${SIRUP_DUP}', '${LE}', 'KANELBOLLE SIRUP MONIN', 'sirup', 'stk', 'Sukker og søtning', 'ravare', 149.60, 'verifisert', '2026-08-14'),
  ('${BOLLE_KG}', '${LE}', 'Gluten og melkefri kanelbolle', '8009', 'kg', 'Importert', 'videresalg', 249.07, 'verifisert', '2026-11-17'),
  ('${BOLLE_STK}', '${LE}', 'GLUTEN OG MELKEFRI KANELBOLLE', '8009-24bp', 'stk', 'Ferdigmiks og halvfabrikat', 'ravare', 29.88, 'verifisert', '2026-08-08');
insert into raw_material_suppliers (id, raw_material_id, supplier_id, supplier_sku, supplier_product_name, is_primary, package_size, package_unit, base_units_per_package, package_confirmed_at) values
  ('${RMS_KEEP}', '${SIRUP_KEEP}', '${ASKO}', '3507', 'KANELBOLLE SIRUP 70CL MONIN', true, 1, 'stk', 1, now()),
  ('${RMS_DUP}', '${SIRUP_DUP}', '${ASKO}', '305-1/1', 'KANELBOLLE SIRUP MONIN', true, null, null, null, null),
  ('${RMS_KG}', '${BOLLE_KG}', '${PALS}', '8009', 'GLUTEN OG MELKEFRI KANELBOLLE', true, null, null, null, null),
  ('${RMS_STK}', '${BOLLE_STK}', '${ASKO}', '7777', 'KANELBOLLE GLUTENFRI', true, 20, 'stk', 20, now());
insert into raw_material_supplier_aliases (raw_material_supplier_id, alias_type, alias_value, status) values
  ('${RMS_DUP}', 'product_name', 'KANELBOLLE SIRUP MONIN 1/1', 'confirmed'),
  ('${RMS_DUP}', 'supplier_sku', '9999', 'rejected');
insert into invoice_lines (id, raw_material_id, base_quantity, price_per_base_unit, total_amount) values
  ('${LINE_DUP}', '${SIRUP_DUP}', 1, 149.60, 149.60),
  ('${LINE_STK}', '${BOLLE_STK}', 200, 29.88, 5976);
insert into raw_material_price_history (raw_material_id, invoice_line_id, price) values ('${SIRUP_KEEP}', null, 102.29), ('${BOLLE_KG}', null, 249.07);
insert into raw_material_price_history (raw_material_id, invoice_line_id, price) values
  ('${SIRUP_DUP}', '${LINE_DUP}', 149.60), ('${BOLLE_STK}', '${LINE_STK}', 29.88);
insert into recipe_lines (id, recipe_id, raw_material_id, quantity, unit) values ('${RECIPE_LINE}', gen_random_uuid(), '${SIRUP_DUP}', 50, 'g');
`;

let db: PGlite;
const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const json = async (sql: string, params: unknown[] = []) => (await q<{ r: Record<string, unknown> }>(sql, params))[0].r;
const asUser = async (level: string) => { await db.exec(`select set_config('test.uid', '${USER}', false); select set_config('test.level', '${level}', false);`); };
const merge = (keep: string, dups: string[], opts: { gpp?: Record<string, number>; dry?: boolean; op?: string; fields?: Record<string, string> } = {}) =>
  json(`select public.rm_merge_raw_materials($1::uuid, $2::uuid[], $3::jsonb, $4::jsonb, null, $5, $6::uuid) r`,
    [keep, dups, opts.gpp ? JSON.stringify(opts.gpp) : null, opts.fields ? JSON.stringify(opts.fields) : null, opts.dry ?? false, opts.op ?? crypto.randomUUID()]);
const undo = (mergeId: string, dry = false) => json(`select public.rm_undo_material_merge($1::uuid, $2, $3::uuid) r`, [mergeId, dry, crypto.randomUUID()]);
const snapshot = async () => JSON.stringify({
  rm: await q("select id, name, is_active, base_unit, unit_weight_grams, current_cost_price from raw_materials order by id"),
  rms: await q("select id, raw_material_id, base_units_per_package, is_primary from raw_material_suppliers order by id"),
  al: await q("select raw_material_supplier_id, alias_type::text, alias_value, status::text from raw_material_supplier_aliases order by alias_value"),
  pk: await q("select raw_material_supplier_id, base_units_per_package from raw_material_supplier_packages order by raw_material_supplier_id, base_units_per_package"),
  il: await q("select id, raw_material_id, base_quantity, price_per_base_unit from invoice_lines order by id"),
  // Aktive observasjoner (rader laget under sammenslåingen blir stående som avsluttet historikk etter angring).
  ph: await q("select raw_material_id, invoice_line_id, price from raw_material_price_history where superseded_at is null order by invoice_line_id nulls first, raw_material_id"),
  rl: await q("select id, raw_material_id from recipe_lines order by id"),
});

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const sql = readFileSync(FILE, "utf8")
    .replace("if md5(pg_get_functiondef('public.merge_raw_materials(uuid,uuid)'::regprocedure)) <> '3c2ed3ccedddc6c117e3ca2899f916e4' then", "if false then")
    .replace("notify pgrst, 'reload schema';", "");
  await db.exec(sql);
  await db.exec("create table public._seed_done(x int);");
});
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`select set_config('rm.merge_write', 'on', false);
    truncate audit_log, raw_material_price_history, recipe_lines, invoice_lines, raw_material_supplier_packages, raw_material_supplier_aliases, raw_material_suppliers,
      raw_material_purchases, stock_movements, rm_material_merges cascade;
    update raw_materials set merged_into_id = null, merge_id = null; delete from raw_materials; delete from suppliers; delete from legal_entities;
    select set_config('rm.merge_write', '', false);`);
  await db.exec(SEED);
  await asUser("approve");
});

describe("Slå sammen varer (PENDING-SQL)", () => {
  it("avviser ulik grunnenhet uten omregning – både forhåndsvisning og utførelse – og endrer ingenting", async () => {
    const before = await snapshot();
    const dry = await merge(BOLLE_KG, [BOLLE_STK], { dry: true });
    expect(dry).toMatchObject({ ok: false, code: "omregning_mangler", keep_unit: "kg", dup_unit: "stk" });
    const real = await merge(BOLLE_KG, [BOLLE_STK]);
    expect(real).toMatchObject({ ok: false, code: "omregning_mangler" });
    const zero = await merge(BOLLE_KG, [BOLLE_STK], { gpp: { [BOLLE_STK]: 0 } });
    expect(zero).toMatchObject({ ok: false, code: "omregning_mangler" });
    expect(await snapshot()).toBe(before);
  });

  it("forhåndsvisning (standard) viser hva som flyttes uten å endre noe", async () => {
    const before = await snapshot();
    const r = await merge(SIRUP_KEEP, [SIRUP_DUP], { dry: true });
    expect(r).toMatchObject({ ok: true, dry_run: true, can_apply: true, merge_id: null });
    expect(r.counts).toMatchObject({ fakturalinjer: 1, prishistorikk: 1, oppskriftslinjer: 1, oppskrifter: 1, varenumre_laert: 1 });
    expect(await snapshot()).toBe(before);
    expect(await q("select * from rm_material_merges")).toHaveLength(0);
  });

  it("krever godkjenner/admin", async () => {
    await asUser("write");
    expect(await merge(SIRUP_KEEP, [SIRUP_DUP])).toMatchObject({ ok: false, code: "ingen_tilgang" });
  });

  it("flytter varenummer og skrivemåter til varen som beholdes (to varenumre hos samme leverandør)", async () => {
    const r = await merge(SIRUP_KEEP, [SIRUP_DUP]);
    expect(r).toMatchObject({ ok: true, dry_run: false });
    const aliases = await q<{ alias_type: string; alias_value: string; status: string; rms: string }>(
      "select alias_type::text, alias_value, status::text, raw_material_supplier_id::text rms from raw_material_supplier_aliases order by alias_value");
    expect(aliases).toEqual(expect.arrayContaining([
      { alias_type: "supplier_sku", alias_value: "305-1/1", status: "confirmed", rms: RMS_KEEP },
      { alias_type: "product_name", alias_value: "KANELBOLLE SIRUP MONIN", status: "confirmed", rms: RMS_KEEP },
      { alias_type: "product_name", alias_value: "KANELBOLLE SIRUP MONIN 1/1", status: "confirmed", rms: RMS_KEEP },
    ]));
    // Et avvist varenummer er et «nei» for den gamle varen og flyttes aldri.
    expect(aliases).toContainEqual({ alias_type: "supplier_sku", alias_value: "9999", status: "rejected", rms: RMS_DUP });
    const [dup] = await q<{ is_active: boolean; merged_into_id: string }>("select is_active, merged_into_id::text from raw_materials where id = $1", [SIRUP_DUP]);
    expect(dup).toEqual({ is_active: false, merged_into_id: SIRUP_KEEP });
    const [line] = await q<{ raw_material_id: string }>("select raw_material_id::text from invoice_lines where id = $1", [LINE_DUP]);
    expect(line.raw_material_id).toBe(SIRUP_KEEP);
    expect(await q("select 1 from audit_log where action = 'raw_material.merged'")).toHaveLength(1);
  });

  it("flytter bruk i oppskrifter til varen som beholdes", async () => {
    await merge(SIRUP_KEEP, [SIRUP_DUP]);
    const [rl] = await q<{ raw_material_id: string }>("select raw_material_id::text from recipe_lines where id = $1", [RECIPE_LINE]);
    expect(rl.raw_material_id).toBe(SIRUP_KEEP);
  });

  it("samme operasjons-ID gir samme kvittering og ingen ny sammenslåing", async () => {
    const op = crypto.randomUUID();
    const a = await merge(SIRUP_KEEP, [SIRUP_DUP], { op });
    const b = await merge(SIRUP_KEEP, [SIRUP_DUP], { op });
    expect(b).toMatchObject({ ok: true, replay: true, merge_id: a.merge_id });
    expect(await q("select * from rm_material_merges")).toHaveLength(1);
  });

  it("sammenslått vare kan ikke aktiveres uten å angre", async () => {
    await merge(SIRUP_KEEP, [SIRUP_DUP]);
    await expect(db.query("update raw_materials set is_active = true where id = $1", [SIRUP_DUP])).rejects.toThrow(/angre/);
  });

  it("angre gjenoppretter: oppskrift, faktura, varenummer, prishistorikk og varen", async () => {
    const before = await snapshot();
    const r = await merge(SIRUP_KEEP, [SIRUP_DUP], { fields: { name: SIRUP_DUP } });
    expect((await q<{ name: string }>("select name from raw_materials where id = $1", [SIRUP_KEEP]))[0].name).toBe("KANELBOLLE SIRUP MONIN");
    const u = await undo(String(r.merge_id));
    expect(u).toMatchObject({ ok: true, dry_run: false });
    expect(await snapshot()).toBe(before);
    expect(await q("select 1 from raw_material_price_history where invoice_line_id = $1 and superseded_at is null", [LINE_DUP])).toHaveLength(1);
    expect(await undo(String(r.merge_id))).toMatchObject({ ok: false, code: "allerede_angret" });
  });

  it("ulik enhet med stykkvekt: regner om linje og pakning, og angre gir nøyaktig tilbake", async () => {
    const before = await snapshot();
    const r = await merge(BOLLE_KG, [BOLLE_STK], { gpp: { [BOLLE_STK]: 120 } });
    expect(r).toMatchObject({ ok: true, grams_per_piece: 120 });
    const [line] = await q<{ base_quantity: string; price_per_base_unit: string }>("select base_quantity::text, price_per_base_unit::text from invoice_lines where id = $1", [LINE_STK]);
    expect(Number(line.base_quantity)).toBeCloseTo(24, 6); // 200 stk × 120 g = 24 kg
    expect(Number(line.price_per_base_unit)).toBeCloseTo(249, 6); // 29,88 kr/stk ÷ 0,12 kg
    const [rms] = await q<{ raw_material_id: string; base_units_per_package: string }>("select raw_material_id::text, base_units_per_package::text from raw_material_suppliers where id = $1", [RMS_STK]);
    expect(rms.raw_material_id).toBe(BOLLE_KG);
    expect(Number(rms.base_units_per_package)).toBeCloseTo(2.4, 6); // 20 stk = 2,4 kg
    // Ingen pakningsvariant i gammel enhet (20 «kg») blir liggende på koblingen.
    const pk = await q<{ b: string }>("select base_units_per_package::text b from raw_material_supplier_packages where raw_material_supplier_id = $1", [RMS_STK]);
    expect(pk.map((p) => Number(p.b))).toEqual([2.4]);
    expect((await q<{ unit_weight_grams: string }>("select unit_weight_grams::text from raw_materials where id = $1", [BOLLE_KG]))[0].unit_weight_grams).toBe("120");
    const u = await undo(String(r.merge_id));
    expect(u).toMatchObject({ ok: true });
    expect(await snapshot()).toBe(before);
  });
});
