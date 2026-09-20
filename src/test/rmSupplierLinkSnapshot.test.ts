import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regresjon for massekoblingen, kjørt mot den FAKTISK migrerte SQL-en.
 *
 * (1) Kontrollverdien fra `rm_supplier_link_snapshot` må dekke alt
 *     forhåndsvisningen bygger på — også linjens enhet, beskrivelse,
 *     varenummer og fakturaens tilstand.
 * (2) En pakning beskrevet i varenavnet som ikke stemmer med koblingen skal
 *     ekskluderes, ikke være stille koblingsbar.
 * (3) `rm_price_summary` skal kreve ekte råvaretilgang.
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260920191509_e8fc4735-3388-4ac9-b991-d130462a2277.sql",
);

const ENTITY = "11111111-1111-1111-1111-111111111111";
const RM = "22222222-2222-2222-2222-222222222222";
const SUPPLIER = "33333333-3333-3333-3333-333333333333";
const RMS = "44444444-4444-4444-4444-444444444444";
const INVOICE = "55555555-5555-5555-5555-555555555555";
const LINE = "66666666-6666-6666-6666-666666666666";
const USER = "77777777-7777-7777-7777-777777777777";

const SCHEMA = `
create schema if not exists auth;
create type access_level as enum ('none', 'read', 'write', 'approve', 'admin');
create table public._ctx(uid uuid, invoice_access boolean not null default true,
                         rm_access boolean not null default true, positioned boolean not null default true);
insert into public._ctx default values;

create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from public._ctx limit 1 $$;
create or replace function public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean language sql stable as $$ select invoice_access from public._ctx limit 1 $$;
create or replace function public.has_ravarer_access(_user_id uuid, _legal_entity_id uuid, _min_level access_level)
returns boolean language sql stable as $$ select rm_access from public._ctx limit 1 $$;
create or replace function public.has_position_in_entity(p_legal_entity_id uuid)
returns boolean language sql stable as $$ select positioned from public._ctx limit 1 $$;
create or replace function public.rm_is_finite(v numeric) returns boolean language sql immutable as $$
  select v is not null $$;
create or replace function public.rm_match_key(p text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9æøå]+', ' ', 'g')), '') $$;
create or replace function public.rm_unit_factor(p_unit text, p_base_unit text) returns numeric language sql immutable as $$
  select case when lower(coalesce(p_unit,'')) = lower(coalesce(p_base_unit,'')) then 1
              when lower(coalesce(p_unit,'')) = 'g' and lower(coalesce(p_base_unit,'')) = 'kg' then 0.001
              else null end $$;

create table public.raw_materials(
  id uuid primary key, legal_entity_id uuid not null, base_unit text not null);
create table public.suppliers(id uuid primary key);
create table public.invoices(
  id uuid primary key, legal_entity_id uuid not null, supplier_id uuid not null,
  invoice_number text, invoice_date date, status text not null default 'processing',
  flagged_at timestamptz, is_credit_note boolean default false, currency text default 'NOK');
create table public.invoice_lines(
  id uuid primary key, invoice_id uuid not null references public.invoices(id),
  description text, supplier_sku text, quantity numeric, unit text, total_amount numeric,
  base_quantity numeric, package_size numeric, package_unit text, count_per_package numeric,
  raw_material_id uuid, match_confidence text, updated_at timestamptz default now());
create table public.raw_material_suppliers(
  id uuid primary key, raw_material_id uuid not null, supplier_id uuid not null,
  supplier_sku text, supplier_product_name text, agreed_price_per_base_unit numeric,
  agreement_priority int not null default 1, agreement_valid_from date, agreement_valid_to date,
  package_size numeric, package_unit text, base_units_per_package numeric,
  package_confirmed_at timestamptz, updated_at timestamptz default now());
create table public.raw_material_supplier_aliases(
  id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid not null,
  alias_type text not null, alias_value text, status text not null default 'confirmed');
create table public.raw_material_price_history(
  id uuid primary key default gen_random_uuid(), raw_material_id uuid not null, supplier_id uuid,
  invoice_id uuid, invoice_line_id uuid, source text default 'invoice', currency text default 'NOK',
  is_credit boolean default false, is_legacy boolean default false, superseded_at timestamptz,
  price numeric, effective_date date, created_at timestamptz default now());

insert into public.raw_materials values ('${RM}', '${ENTITY}', 'kg');
insert into public.suppliers values ('${SUPPLIER}');
insert into public.invoices(id, legal_entity_id, supplier_id, invoice_number, invoice_date)
values ('${INVOICE}', '${ENTITY}', '${SUPPLIER}', 'F-1', '2026-06-01');
insert into public.raw_material_suppliers(id, raw_material_id, supplier_id, supplier_sku,
  supplier_product_name, package_size, package_unit, base_units_per_package, package_confirmed_at)
values ('${RMS}', '${RM}', '${SUPPLIER}', 'SKU-1', 'Testmel', 1, 'kg', 12, now());
insert into public.invoice_lines(id, invoice_id, description, supplier_sku, quantity, unit, total_amount)
values ('${LINE}', '${INVOICE}', 'Testmel', 'SKU-1', 12, 'kg', 1200);
`;

let db: PGlite;

async function snapshot(): Promise<string> {
  const res = await db.query<{ s: string }>("select public.rm_supplier_link_snapshot($1) as s", [RMS]);
  return res.rows[0].s;
}

async function candidates(): Promise<Array<{ eligible: boolean; exclusion_reason: string | null }>> {
  const res = await db.query<{ eligible: boolean; exclusion_reason: string | null }>(
    "select eligible, exclusion_reason from public.rm_supplier_link_candidates($1)",
    [RMS],
  );
  return res.rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  const sql = readFileSync(MIGRATION, "utf8")
    .split("\n")
    .filter((line) => !/^\s*(revoke|grant)\b/i.test(line))
    .join("\n");
  await db.exec(sql);
});

afterAll(async () => {
  await db.close();
});

describe("kontrollverdien dekker alt forhåndsvisningen bygger på", () => {
  it("endret enhet på linjen endrer kontrollverdien", async () => {
    const before = await snapshot();
    await db.query("update public.invoice_lines set unit = 'g' where id = $1", [LINE]);
    expect(await snapshot()).not.toBe(before);
    await db.query("update public.invoice_lines set unit = 'kg' where id = $1", [LINE]);
    expect(await snapshot()).toBe(before);
  });

  it("endret beskrivelse endrer kontrollverdien selv om varenummeret er likt", async () => {
    const before = await snapshot();
    await db.query("update public.invoice_lines set description = 'Testmel ny pakning 12x1kg' where id = $1", [LINE]);
    expect(await snapshot()).not.toBe(before);
    await db.query("update public.invoice_lines set description = 'Testmel' where id = $1", [LINE]);
    expect(await snapshot()).toBe(before);
  });

  it("endret varenummer, fakturadato, valuta, status og flagg endrer kontrollverdien", async () => {
    const base = await snapshot();
    const mutations: Array<[string, unknown[]]> = [
      ["update public.invoice_lines set supplier_sku = 'SKU-1B' where id = $1", [LINE]],
      ["update public.invoices set invoice_date = '2026-06-02' where id = $1", [INVOICE]],
      ["update public.invoices set currency = 'EUR' where id = $1", [INVOICE]],
      ["update public.invoices set status = 'reconciled' where id = $1", [INVOICE]],
      ["update public.invoices set flagged_at = now() where id = $1", [INVOICE]],
      ["update public.raw_materials set base_unit = 'g' where id = $1", [RM]],
    ];
    for (const [sql, params] of mutations) {
      const before = await snapshot();
      await db.query(sql, params);
      expect(await snapshot(), sql).not.toBe(before);
    }
    // Tilbakestill
    await db.exec(`
      update public.invoice_lines set supplier_sku = 'SKU-1' where id = '${LINE}';
      update public.invoices set invoice_date = '2026-06-01', currency = 'NOK',
             status = 'processing', flagged_at = null where id = '${INVOICE}';
      update public.raw_materials set base_unit = 'kg' where id = '${RM}';
    `);
    expect(await snapshot()).toBe(base);
  });
});

describe("pakning beskrevet i varenavnet", () => {
  it("stemmende pakningstekst er fortsatt koblingsbar", async () => {
    await db.query("update public.invoice_lines set description = 'Testmel 12x1kg' where id = $1", [LINE]);
    const rows = await candidates();
    expect(rows).toHaveLength(1);
    expect(rows[0].eligible).toBe(true);
  });

  it("avvikende pakningstekst ekskluderes i stedet for å gå gjennom", async () => {
    await db.query("update public.invoice_lines set description = 'Testmel ny pakning 6x2kg' where id = $1", [LINE]);
    const rows = await candidates();
    expect(rows).toHaveLength(1);
    expect(rows[0].eligible).toBe(false);
    expect(rows[0].exclusion_reason).toBe("annen_pakning_beskrivelse");
    await db.query("update public.invoice_lines set description = 'Testmel' where id = $1", [LINE]);
  });
});

describe("rm_price_summary krever ekte råvaretilgang", () => {
  const summary = () => db.query("select public.rm_price_summary($1) as s", [RM]);

  it("bruker med råvaretilgang får sammendraget", async () => {
    await db.query("update public._ctx set uid = $1, rm_access = true, positioned = true", [USER]);
    await expect(summary()).resolves.toBeTruthy();
  });

  it("bruker med stilling, men uten råvaretilgang, nektes", async () => {
    await db.query("update public._ctx set uid = $1, rm_access = false, positioned = true", [USER]);
    await expect(summary()).rejects.toThrow(/Ingen råvaretilgang/);
    await db.query("update public._ctx set rm_access = true");
  });
});
