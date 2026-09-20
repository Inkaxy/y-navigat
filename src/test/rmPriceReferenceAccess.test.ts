import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Sikkerhetsregresjon for `rm_price_reference`.
 *
 * Funksjonen er SECURITY DEFINER og leser priser på tvers av RLS. Den skal
 * derfor (1) bare kunne kjøres av bakgrunnstjenesten, og (2) nekte innloggede
 * brukere uten fakturatilgang, samt kall der faktura/leverandør ikke hører
 * sammen med råvarens selskap.
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260920183116_52cdbdaf-88a3-4613-aa28-bc33b54648cc.sql",
);

const ENTITY_A = "11111111-1111-1111-1111-111111111111";
const ENTITY_B = "22222222-2222-2222-2222-222222222222";
const RM = "33333333-3333-3333-3333-333333333333";
const SUPPLIER = "44444444-4444-4444-4444-444444444444";
const OTHER_SUPPLIER = "55555555-5555-5555-5555-555555555555";
const INVOICE = "66666666-6666-6666-6666-666666666666";
const FOREIGN_INVOICE = "77777777-7777-7777-7777-777777777777";
const USER = "88888888-8888-8888-8888-888888888888";

const SCHEMA = `
create schema if not exists auth;
create table public._ctx(uid uuid, has_access boolean not null default true);
insert into public._ctx(uid, has_access) values (null, true);

create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from public._ctx limit 1 $$;

create or replace function public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean language sql stable as $$
  select has_access from public._ctx limit 1 $$;

create or replace function public.rm_is_finite(v numeric) returns boolean language sql immutable as $$
  select v is not null $$;

create table public.raw_materials(id uuid primary key, legal_entity_id uuid not null);
create table public.invoices(
  id uuid primary key, legal_entity_id uuid not null, supplier_id uuid not null);
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
  source text not null default 'invoice',
  currency text default 'NOK',
  is_credit boolean default false,
  is_legacy boolean default false,
  superseded_at timestamptz,
  price numeric,
  effective_date date not null,
  created_at timestamptz not null default now());

insert into public.raw_materials values ('${RM}', '${ENTITY_A}');
insert into public.invoices values
  ('${INVOICE}', '${ENTITY_A}', '${SUPPLIER}'),
  ('${FOREIGN_INVOICE}', '${ENTITY_B}', '${SUPPLIER}');
insert into public.raw_material_suppliers
  (raw_material_id, supplier_id, agreed_price_per_base_unit, agreement_valid_from)
values ('${RM}', '${SUPPLIER}', 100, '2026-01-01');
`;

let db: PGlite;

async function setContext(uid: string | null, hasAccess: boolean): Promise<void> {
  await db.query("update public._ctx set uid = $1, has_access = $2", [uid, hasAccess]);
}

async function reference(
  invoiceId: string | null,
  supplierId: string = SUPPLIER,
): Promise<Record<string, unknown>> {
  const res = await db.query<{ r: Record<string, unknown> }>(
    "select public.rm_price_reference($1, $2, $3, $4) as r",
    [RM, supplierId, invoiceId, "2026-06-01"],
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

describe("rm_price_reference nekter uautoriserte kall", () => {
  it("bakgrunnstjenesten (ingen innlogget bruker) får prisgrunnlaget", async () => {
    await setContext(null, false);
    const res = await reference(INVOICE);
    expect(res.source).toBe("agreement");
    expect(Number(res.price)).toBe(100);
  });

  it("innlogget bruker med fakturatilgang får prisgrunnlaget", async () => {
    await setContext(USER, true);
    const res = await reference(INVOICE);
    expect(res.source).toBe("agreement");
  });

  it("innlogget bruker uten fakturatilgang nektes", async () => {
    await setContext(USER, false);
    await expect(reference(INVOICE)).rejects.toThrow(/Ingen fakturatilgang/);
  });

  it("nekter når fakturaen hører til et annet selskap enn råvaren", async () => {
    await setContext(null, true);
    await expect(reference(FOREIGN_INVOICE)).rejects.toThrow(/ulike selskap/);
  });

  it("nekter når leverandøren ikke stemmer med fakturaen", async () => {
    await setContext(null, true);
    await expect(reference(INVOICE, OTHER_SUPPLIER)).rejects.toThrow(/stemmer ikke med fakturaen/);
  });

  it("nekter ukjent faktura og ukjent råvare", async () => {
    await setContext(null, true);
    await expect(reference(ENTITY_B)).rejects.toThrow(/Fakturaen finnes ikke/);
    await expect(
      db.query("select public.rm_price_reference($1, $2, null, $3)", [
        ENTITY_B,
        SUPPLIER,
        "2026-06-01",
      ]),
    ).rejects.toThrow(/Råvaren finnes ikke/);
  });
});

describe("migrasjonen fjerner direkte tilgang for innloggede kontoer", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("revokerer execute fra public, anon og authenticated", () => {
    expect(sql).toMatch(
      /revoke execute on function public\.rm_price_reference\(uuid, uuid, uuid, date\) from public, anon, authenticated;/i,
    );
  });

  it("gir execute kun til service_role", () => {
    expect(sql).toMatch(
      /grant execute on function public\.rm_price_reference\(uuid, uuid, uuid, date\) to service_role;/i,
    );
    expect(sql).not.toMatch(/to authenticated, service_role/i);
  });
});
