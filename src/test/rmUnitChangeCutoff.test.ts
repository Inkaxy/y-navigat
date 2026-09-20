import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Grensetilfelle: en prisobservasjon som ble REGISTRERT før grunnenheten ble
 * endret, men samme dag (eller med fremtidig fakturadato), kan ikke danne
 * prisgrunnlag. Historikken lagrer ingen enhet, så vi holder slike rader
 * utenfor i stedet for å presentere dem i dagens grunnenhet.
 *
 * Testen kjører den faktisk kjørte migrasjonen.
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260920200038_09112d2f-3ae1-4d38-a3b2-10bd4d5c8a86.sql",
);

const ENTITY = "11111111-1111-1111-1111-111111111111";
const RM = "33333333-3333-3333-3333-333333333333";
const SUPPLIER = "44444444-4444-4444-4444-444444444444";
const INVOICE = "66666666-6666-6666-6666-666666666666";

const SCHEMA = `
create schema if not exists auth;
create table public._ctx(uid uuid);
insert into public._ctx(uid) values (null);

create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from public._ctx limit 1 $$;

create or replace function public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean language sql stable as $$ select true $$;

create type access_level as enum ('none','read','write','approve','admin');
create or replace function public.has_ravarer_access(_uid uuid, _entity uuid, _level access_level)
returns boolean language sql stable as $$ select true $$;

create or replace function public.rm_is_finite(v numeric) returns boolean language sql immutable as $$
  select v is not null $$;

create table public.raw_materials(id uuid primary key, legal_entity_id uuid not null);
create table public.invoices(id uuid primary key, legal_entity_id uuid not null, supplier_id uuid not null);
create table public.invoice_lines(
  id uuid primary key default gen_random_uuid(),
  total_amount numeric, base_quantity numeric);
create table public.raw_material_changelog(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null,
  field text not null,
  created_at timestamptz not null);
create table public.raw_material_suppliers(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null,
  supplier_id uuid not null,
  agreed_price_per_base_unit numeric,
  agreement_priority int not null default 1,
  agreement_valid_from date,
  agreement_valid_to date);
create table public.raw_material_price_history(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null,
  supplier_id uuid not null,
  invoice_id uuid,
  invoice_line_id uuid,
  source text not null default 'invoice',
  currency text default 'NOK',
  is_credit boolean default false,
  is_legacy boolean default false,
  superseded_at timestamptz,
  price numeric,
  effective_date date not null,
  created_at timestamptz not null);

insert into public.raw_materials values ('${RM}', '${ENTITY}');
insert into public.invoices values ('${INVOICE}', '${ENTITY}', '${SUPPLIER}');

-- Grunnenheten ble endret 2026-06-10 kl. 12:00.
insert into public.raw_material_changelog(raw_material_id, field, created_at)
values ('${RM}', 'base_unit', '2026-06-10T12:00:00Z');
`;

let db: PGlite;

async function addHistory(price: number, effectiveDate: string, createdAt: string): Promise<string> {
  const res = await db.query<{ id: string }>(
    `insert into public.raw_material_price_history
       (raw_material_id, supplier_id, invoice_id, price, effective_date, created_at)
     values ($1, $2, null, $3, $4, $5) returning id`,
    [RM, SUPPLIER, price, effectiveDate, createdAt],
  );
  return res.rows[0].id;
}

async function reference(onDate: string): Promise<Record<string, unknown>> {
  const res = await db.query<{ r: Record<string, unknown> }>(
    "select public.rm_price_reference($1, $2, null, $3) as r",
    [RM, SUPPLIER, onDate],
  );
  return res.rows[0].r;
}

async function summary(onDate: string): Promise<Record<string, unknown>> {
  const res = await db.query<{ r: Record<string, unknown> }>(
    "select public.rm_price_summary($1, $2, $3) as r",
    [RM, SUPPLIER, onDate],
  );
  return res.rows[0].r;
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

describe("prisgrunnlag utelater observasjoner registrert før enhetsendringen", () => {
  it("rad registrert kl. 08:00 samme dag som endringen kl. 12:00 er utelatt", async () => {
    await db.query("delete from public.raw_material_price_history");
    await addHistory(80, "2026-06-10", "2026-06-10T08:00:00Z");

    const res = await reference("2026-06-20");
    expect(res.source).toBe("none");
    expect(res.reason).toBe("ingen_sammenlignbare_kjop_etter_enhetsendring");

    const sum = await summary("2026-06-20");
    expect(sum.last_purchase).toBeNull();
    expect(sum.weighted_90d).toBeNull();
  });

  it("rad registrert kl. 13:00 samme dag er gyldig prisgrunnlag", async () => {
    await db.query("delete from public.raw_material_price_history");
    await addHistory(95, "2026-06-10", "2026-06-10T13:00:00Z");

    const res = await reference("2026-06-20");
    expect(res.source).toBe("last_purchase");
    expect(Number(res.price)).toBe(95);

    const sum = await summary("2026-06-20");
    expect((sum.last_purchase as { price: number }).price).toBe(95);
  });

  it("fremtidsdatert faktura registrert før endringen er utelatt", async () => {
    await db.query("delete from public.raw_material_price_history");
    // Fakturadato etter endringsdatoen, men raden ble opprettet før endringen.
    await addHistory(70, "2026-06-15", "2026-06-10T09:00:00Z");

    const res = await reference("2026-06-20");
    expect(res.source).toBe("none");
    expect(res.reason).toBe("ingen_sammenlignbare_kjop_etter_enhetsendring");
  });

  it("uten enhetsendring gjelder ingen tidsgrense", async () => {
    await db.query("delete from public.raw_material_price_history");
    await db.query("delete from public.raw_material_changelog");
    await addHistory(60, "2026-01-05", "2026-01-05T08:00:00Z");

    const res = await reference("2026-06-20");
    expect(res.source).toBe("last_purchase");
    expect(Number(res.price)).toBe(60);

    await db.query(
      "insert into public.raw_material_changelog(raw_material_id, field, created_at) values ($1, 'base_unit', $2)",
      [RM, "2026-06-10T12:00:00Z"],
    );
  });
});
