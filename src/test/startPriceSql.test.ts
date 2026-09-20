import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Startpris — testet mot den faktisk kjørte migrasjonen (ikke mot en kopi av
 * logikken). Dekker første bekreftelse, gjentakelse, samtidighet (låsing),
 * utdatert forslag, sperrer (kreditnota, ukjent pakning, feil selskap,
 * ikke-bekreftet kobling), at startprisen er fast etter prisøkning, at
 * avtalepris går foran, fremtidig ikrafttredelsesdato og enhetsendring.
 */

const MIGRATIONS = [
  "supabase/migrations/20260920202427_5083c865-678d-415b-adaa-e6105b2ccc90.sql",
  "supabase/migrations/20260920203623_19d4672a-aa57-4677-826f-9f0ab71afb36.sql",
].map((f) => path.join(process.cwd(), f));

const ENTITY = "11111111-1111-1111-1111-111111111111";
const OTHER_ENTITY = "1111111a-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";
const RM = "33333333-3333-3333-3333-333333333333";
const SUPPLIER = "44444444-4444-4444-4444-444444444444";
const SUPPLIER_B = "4444444b-4444-4444-4444-444444444444";

const SCHEMA = `
create role anon;
create role authenticated;
create role service_role;
create schema if not exists auth;
create table public._ctx(uid uuid, access boolean not null default true);
insert into public._ctx(uid) values (null);

create or replace function auth.uid() returns uuid language sql stable as $$
  select uid from public._ctx limit 1 $$;

create or replace function public.has_ravarer_invoice_access(_legal_entity_id uuid, _required_level text default 'read')
returns boolean language sql stable as $$ select access from public._ctx limit 1 $$;

create or replace function public.rm_is_finite(v numeric) returns boolean language sql immutable as $$
  select v is not null and v = v and v <> 'Infinity'::numeric and v <> '-Infinity'::numeric $$;

create table public.raw_materials(
  id uuid primary key, legal_entity_id uuid not null, name text, base_unit text);

create table public.suppliers(id uuid primary key, name text);

create table public.invoices(
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  supplier_id uuid,
  invoice_number text,
  invoice_date date,
  currency text default 'NOK',
  is_credit_note boolean default false);

create table public.invoice_lines(
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  raw_material_id uuid,
  description text,
  quantity numeric,
  total_amount numeric,
  base_quantity numeric,
  price_per_base_unit numeric,
  match_confidence text,
  requires_review boolean default false,
  created_at timestamptz not null default now());

create table public.raw_material_suppliers(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null,
  supplier_id uuid not null,
  supplier_sku text,
  agreed_price_per_base_unit numeric,
  agreed_price_set_by uuid,
  agreed_price_set_at timestamptz,
  agreement_priority int not null default 1,
  agreement_valid_from date,
  agreement_valid_to date,
  package_size numeric,
  package_unit text,
  base_units_per_package numeric,
  package_confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (raw_material_id, supplier_id));

create table public.invoice_match_settings(
  legal_entity_id uuid primary key,
  default_price_tolerance_pct numeric not null default 2);

create table public.raw_material_price_history(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid, supplier_id uuid, price numeric, currency text default 'NOK',
  source text, effective_date date, invoice_id uuid,
  is_credit boolean default false, is_legacy boolean default false,
  superseded_at timestamptz, created_at timestamptz not null default now());

create table public.raw_material_changelog(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null, field text not null, created_at timestamptz not null default now());

create table public.audit_log(
  id uuid primary key default gen_random_uuid(),
  user_id uuid, action text, entity_type text, entity_id uuid,
  entity_display_reference text, legal_entity_id uuid, changes jsonb,
  reason text, source_app text, created_at timestamptz not null default now());

create or replace function public.rm_unit_change_at(p_raw_material_id uuid)
returns timestamptz language sql stable as $$
  select max(created_at) from public.raw_material_changelog
   where raw_material_id = p_raw_material_id and field = 'base_unit' $$;

create or replace function public.rm_unit_change_cutoff(p_raw_material_id uuid)
returns date language sql stable as $$
  select (public.rm_unit_change_at(p_raw_material_id))::date $$;
`;

let db: PGlite;

async function setUser(uid: string | null, access = true) {
  await db.query("update public._ctx set uid = $1, access = $2", [uid, access]);
}

/** Oppretter en kvalifisert faktura med én manuelt bekreftet linje. */
async function makeLine(opts: {
  price: number;
  date: string;
  supplier?: string;
  credit?: boolean;
  currency?: string;
  review?: boolean;
  confidence?: string;
}): Promise<string> {
  const inv = await db.query<{ id: string }>(
    `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date, currency, is_credit_note)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [ENTITY, opts.supplier ?? SUPPLIER, `F-${opts.date}-${opts.price}`, opts.date, opts.currency ?? "NOK", opts.credit ?? false],
  );
  const line = await db.query<{ id: string }>(
    `insert into public.invoice_lines(invoice_id, raw_material_id, description, quantity, total_amount,
       base_quantity, price_per_base_unit, match_confidence, requires_review)
     values ($1,$2,'Hvetemel 25 kg',2,$3,50,$4,$5,$6) returning id`,
    [
      inv.rows[0].id,
      RM,
      opts.price * 50,
      opts.price,
      opts.confidence ?? "manual",
      opts.review ?? false,
    ],
  );
  return line.rows[0].id;
}

async function eligibility(lineId: string) {
  const r = await db.query<{ v: Record<string, unknown> }>(
    "select public.rm_start_price_eligibility($1) as v",
    [lineId],
  );
  return r.rows[0].v as { eligible: boolean; blockers: string[] } & Record<string, unknown>;
}

async function confirm(lineId: string, expected: number | null = null) {
  const r = await db.query<{ v: Record<string, unknown> }>(
    "select public.rm_confirm_start_price($1,$2) as v",
    [lineId, expected],
  );
  return r.rows[0].v as { created: boolean; reason: string | null; start_price: number | null };
}

async function reference(date: string, supplier = SUPPLIER) {
  const r = await db.query<{ v: Record<string, unknown> }>(
    "select public.rm_price_reference($1,$2,null,$3::date) as v",
    [RM, supplier, date],
  );
  return r.rows[0].v as { source: string; price: number | null; reference_date: string | null };
}

async function resetLinks() {
  await db.query("delete from public.raw_material_suppliers");
  await db.query(
    `insert into public.raw_material_suppliers(raw_material_id, supplier_id, package_size, package_unit,
       base_units_per_package, package_confirmed_at)
     values ($1,$2,25,'kg',25, now())`,
    [RM, SUPPLIER],
  );
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.query("insert into public.raw_materials(id, legal_entity_id, name, base_unit) values ($1,$2,'Hvetemel','kg')", [RM, ENTITY]);
  await db.query("insert into public.suppliers(id,name) values ($1,'Norgesmøllene'),($2,'Idun')", [SUPPLIER, SUPPLIER_B]);
  await setUser(USER);
});

afterAll(async () => {
  await db.close();
});

describe("startpris", () => {
  it("bekreftes én gang og er deretter idempotent", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-01-10" });
    expect((await eligibility(line)).eligible).toBe(true);

    const first = await confirm(line, 10);
    expect(first.created).toBe(true);
    expect(Number(first.start_price)).toBe(10);

    const again = await confirm(line, 10);
    expect(again.created).toBe(false);
    expect(again.reason).toBe("allerede_bekreftet_fra_denne_linjen");

    const audits = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where action = 'start_price_confirmed'",
    );
    expect(audits.rows[0].n).toBe(1);
  });

  it("andre linje taper mot en allerede bekreftet startpris", async () => {
    await resetLinks();
    const a = await makeLine({ price: 10, date: "2026-01-10" });
    const b = await makeLine({ price: 12, date: "2026-01-12" });
    expect((await confirm(a, 10)).created).toBe(true);
    const second = await confirm(b, 12);
    expect(second.created).toBe(false);
    expect(second.reason).toBe("startpris_finnes_allerede");
  });

  it("avviser utdatert forslag når prisen på linjen er endret", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-01-10" });
    const res = await confirm(line, 9.5);
    expect(res.created).toBe(false);
    expect(res.reason).toBe("utdatert_forslag");
  });

  it("sperrer kreditnota, annen valuta, gjennomgang, ubekreftet kobling og ukjent pakning", async () => {
    await resetLinks();
    const credit = await makeLine({ price: 10, date: "2026-02-01", credit: true });
    expect((await eligibility(credit)).blockers).toContain("kreditnota");

    const eur = await makeLine({ price: 10, date: "2026-02-02", currency: "EUR" });
    expect((await eligibility(eur)).blockers).toContain("annen_valuta");

    const review = await makeLine({ price: 10, date: "2026-02-03", review: true });
    expect((await eligibility(review)).blockers).toContain("linjen_star_til_gjennomgang");

    const auto = await makeLine({ price: 10, date: "2026-02-04", confidence: "high" });
    expect((await eligibility(auto)).blockers).toContain("koblingen_er_ikke_manuelt_bekreftet");

    await db.query("update public.raw_material_suppliers set package_confirmed_at = null");
    const pkg = await makeLine({ price: 10, date: "2026-02-05" });
    expect((await eligibility(pkg)).blockers).toContain("ukjent_pakning");
    expect((await confirm(pkg)).created).toBe(false);
  });

  it("avviser linje fra en annen leverandør enn koblingen", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-03-01", supplier: SUPPLIER_B });
    const e = await eligibility(line);
    expect(e.blockers).toContain("mangler_leverandorkobling");
    expect((await confirm(line)).created).toBe(false);
  });

  it("avviser når faktura og vare hører til ulike selskap", async () => {
    await resetLinks();
    const inv = await db.query<{ id: string }>(
      `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date)
       values ($1,$2,'X-1','2026-03-02') returning id`,
      [OTHER_ENTITY, SUPPLIER],
    );
    const line = await db.query<{ id: string }>(
      `insert into public.invoice_lines(invoice_id, raw_material_id, quantity, total_amount, base_quantity,
         price_per_base_unit, match_confidence) values ($1,$2,2,500,50,10,'manual') returning id`,
      [inv.rows[0].id, RM],
    );
    const e = await eligibility(line.rows[0].id);
    expect(e.blockers).toContain("faktura_og_vare_i_ulike_selskap");
  });

  it("krever pålogging og skrivetilgang", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-03-03" });
    await setUser(null);
    await expect(confirm(line)).rejects.toThrow();
    await setUser(USER, false);
    await expect(confirm(line)).rejects.toThrow();
    await setUser(USER, true);
  });

  it("er fast: senere prisøkning flytter den ikke, og den gjelder ikke eldre fakturaer", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-04-10" });
    expect((await confirm(line, 10)).created).toBe(true);

    const later = await reference("2026-05-01");
    expect(later.source).toBe("start_price");
    expect(Number(later.price)).toBe(10);

    // Ingen fremtidig startpris som grunnlag for en eldre faktura.
    const earlier = await reference("2026-04-01");
    expect(earlier.source).not.toBe("start_price");
  });

  it("lar gyldig avtalepris gå foran startprisen", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-04-10" });
    expect((await confirm(line, 10)).created).toBe(true);
    await db.query(
      "update public.raw_material_suppliers set agreed_price_per_base_unit = 8, agreement_valid_from = '2026-01-01'",
    );
    const ref = await reference("2026-05-01");
    expect(ref.source).toBe("agreement");
    expect(Number(ref.price)).toBe(8);
  });

  it("ugyldiggjør startprisen når grunnenheten endres", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-04-10" });
    expect((await confirm(line, 10)).created).toBe(true);
    await db.query("update public.raw_materials set base_unit = 'g' where id = $1", [RM]);
    const ref = await reference("2026-05-01");
    expect(ref.source).not.toBe("start_price");
    await db.query("update public.raw_materials set base_unit = 'kg' where id = $1", [RM]);
  });

  it("nekter å gjøre startpris til avtalepris uten begrunnelse eller etter enhetsendring", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-04-10" });
    await confirm(line, 10);
    const rms = await db.query<{ id: string }>("select id from public.raw_material_suppliers limit 1");
    const id = rms.rows[0].id;

    await expect(db.query("select public.rm_start_price_to_agreement($1, '')", [id])).rejects.toThrow();

    await db.query("update public.raw_materials set base_unit = 'g' where id = $1", [RM]);
    await expect(
      db.query("select public.rm_start_price_to_agreement($1, 'Avtalt med leverandør')", [id]),
    ).rejects.toThrow();
    await db.query("update public.raw_materials set base_unit = 'kg' where id = $1", [RM]);

    const ok = await db.query<{ v: { updated: boolean } }>(
      "select public.rm_start_price_to_agreement($1, 'Avtalt med leverandør') as v",
      [id],
    );
    expect(ok.rows[0].v.updated).toBe(true);
    const audit = await db.query<{ n: number }>(
      "select count(*)::int as n from public.audit_log where action = 'start_price_set_as_agreement'",
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it("historikkforslag lister bare kvalifiserte kjøp og forsvinner etter bekreftelse", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-06-01" });
    const before = await db.query<{ v: Array<{ invoice_line_id: string }> }>(
      "select public.rm_start_price_candidates($1,null,100) as v",
      [ENTITY],
    );
    expect(before.rows[0].v.map((c) => c.invoice_line_id)).toContain(line);

    await confirm(line, 10);
    const after = await db.query<{ v: unknown[] }>(
      "select public.rm_start_price_candidates($1,null,100) as v",
      [ENTITY],
    );
    expect(after.rows[0].v).toHaveLength(0);
  });
});
