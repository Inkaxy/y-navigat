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
  "supabase/migrations/20260920204910_a33720cc-66ed-4b7b-a92d-b47c32c7c901.sql",
  "supabase/migrations/20260920205532_677662bd-14da-46fc-91e6-f41c546e84aa.sql",
  "supabase/migrations/20260920205737_1c7544f6-ddd2-431f-852c-6896f4dbb478.sql",
  "supabase/migrations/20260920205812_84bee6de-64b0-4b9d-a660-08a9d17141c8.sql",
  "supabase/migrations/20260920211551_bf78ce3b-9c01-4d98-9513-751efeb84f9d.sql",
  "supabase/migrations/20260920212203_5ab29731-41e5-47ee-b071-f849a1d513d6.sql",
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
  id uuid primary key, legal_entity_id uuid not null, name text, base_unit text,
  primary_supplier_id uuid);

create table public.suppliers(id uuid primary key, name text, legal_entity_id uuid);

create table public.invoices(
  id uuid primary key default gen_random_uuid(),
  legal_entity_id uuid not null,
  supplier_id uuid,
  invoice_number text,
  invoice_date date,
  currency text default 'NOK',
  flagged_at timestamptz,
  is_credit_note boolean default false);

create table public.invoice_lines(
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id),
  raw_material_id uuid,
  supplier_sku text,
  description text,
  quantity numeric,
  unit text,
  total_amount numeric,
  base_quantity numeric,
  price_per_base_unit numeric,
  match_confidence text,
  requires_review boolean default false,
  review_reason text,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create table public.raw_material_suppliers(
  id uuid primary key default gen_random_uuid(),
  raw_material_id uuid not null,
  supplier_id uuid not null,
  supplier_sku text,
  supplier_product_name text,
  is_primary boolean not null default false,
  package_confirmed_by uuid,
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

-- Kopi av den faktiske definisjonen i databasen (eldre migrasjon).
create or replace function public.rm_unit_factor(p_unit text, p_base_unit text)
returns numeric language sql immutable as $$
  with u as (select lower(btrim(coalesce(p_unit,''))) as u, lower(btrim(coalesce(p_base_unit,''))) as b)
  select case
    when u.u = '' or u.b = '' then null
    when u.u = u.b then 1
    when u.b = 'kg' and u.u in ('kilo','kilogram')            then 1
    when u.b = 'kg' and u.u in ('g','gram')                   then 0.001
    when u.b = 'kg' and u.u in ('hg','hekto')                 then 0.1
    when u.b = 'kg' and u.u in ('t','tonn','ton')             then 1000
    when u.b = 'g'  and u.u in ('kg','kilo','kilogram')       then 1000
    when u.b = 'l'  and u.u in ('liter','ltr')                then 1
    when u.b = 'l'  and u.u in ('ml','milliliter')            then 0.001
    when u.b = 'l'  and u.u in ('dl')                         then 0.1
    when u.b = 'l'  and u.u in ('cl')                         then 0.01
    when u.b = 'ml' and u.u in ('l','liter','ltr')            then 1000
    when u.b = 'stk' and u.u in ('stk','stykk','pcs','st')    then 1
    else null
  end
  from u;
$$;

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
    `insert into public.invoice_lines(invoice_id, raw_material_id, description, quantity, unit, total_amount,
       base_quantity, price_per_base_unit, match_confidence, requires_review)
     values ($1,$2,'Hvetemel 25 kg',2,'sekk',$3,50,$4,$5,$6) returning id`,
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
  for (const file of MIGRATIONS) {
    await db.exec(readFileSync(file, "utf8"));
  }
  await db.query("insert into public.raw_materials(id, legal_entity_id, name, base_unit) values ($1,$2,'Hvetemel','kg')", [RM, ENTITY]);
  await db.query("insert into public.suppliers(id,name,legal_entity_id) values ($1,'Norgesmøllene',$3),($2,'Idun',$3)", [SUPPLIER, SUPPLIER_B, ENTITY]);
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
         price_per_base_unit, match_confidence, unit) values ($1,$2,2,500,50,10,'manual','sekk') returning id`,
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
    // Ett forslag per kobling (distinct on rms.id) — rydd linjer fra tidligere tester.
    await db.query("delete from public.invoice_lines");
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

  it("gjentatt bekreftelse gir strukturert svar uten SQL-feil", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-07-01" });
    expect((await confirm(line, 10)).created).toBe(true);
    const again = await confirm(line, 10);
    expect(again.created).toBe(false);
    const other = await makeLine({ price: 11, date: "2026-07-02" });
    const e = await eligibility(other);
    expect(e.blockers).toContain("startpris_finnes_allerede");
    expect(e.eligible).toBe(false);
  });

  it("sperrer flagget faktura", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-07-03" });
    await db.query(
      "update public.invoices set flagged_at = now() where id = (select invoice_id from public.invoice_lines where id = $1)",
      [line],
    );
    expect((await eligibility(line)).blockers).toContain("fakturaen_er_flagget");
    expect((await confirm(line)).created).toBe(false);
  });

  it("feiler lukket på uavklart uttrekk selv om linjen ikke er merket til gjennomgang", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-07-04" });
    await db.query(
      "update public.invoice_lines set review_reason = 'extraction_unresolved', requires_review = false where id = $1",
      [line],
    );
    const e = await eligibility(line);
    expect(e.blockers).toContain("inkonsistent_gjennomgangsstatus");
    expect((await confirm(line)).created).toBe(false);
  });

  it("stoler ikke på lagret pris når beløpet er endret", async () => {
    await resetLinks();
    const line = await makeLine({ price: 100, date: "2026-07-05" });
    // base_quantity 50, total 5000, pris 100 → beløpet dobles uten omberegning
    await db.query("update public.invoice_lines set total_amount = 10000 where id = $1", [line]);
    const e = await eligibility(line);
    expect(e.blockers).toContain("utdaterte_beregnede_verdier");
    expect((await confirm(line, 100)).created).toBe(false);
  });

  it("avviser linje fra før en enhetsendring, også ved kg → g → kg", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-07-06" });
    await db.query("update public.invoice_lines set created_at = now() - interval '2 days' where id = $1", [line]);
    await db.query("update public.raw_material_suppliers set package_confirmed_at = now() - interval '2 days'");
    await db.query(
      "insert into public.raw_material_changelog(raw_material_id, field, created_at) values ($1,'base_unit', now() - interval '1 day')",
      [RM],
    );
    const e = await eligibility(line);
    expect(e.blockers).toContain("enhet_endret_etter_fakturalinjen");
    expect(e.blockers).toContain("pakning_ikke_bekreftet_etter_enhetsendring");
    expect((await confirm(line)).created).toBe(false);

    // Ny bekreftet pakning etter endringen, og en ny linje, er igjen gyldig.
    await db.query("update public.raw_material_suppliers set package_confirmed_at = now()");
    const fresh = await makeLine({ price: 10, date: "2026-07-07" });
    expect((await eligibility(fresh)).eligible).toBe(true);
    expect((await confirm(fresh, 10)).created).toBe(true);

    // Runde tur tilbake til kg er også en endring: startprisen faller ut av prisgrunnlaget.
    await db.query("insert into public.raw_material_changelog(raw_material_id, field) values ($1,'base_unit')", [RM]);
    expect((await reference("2026-08-01")).source).not.toBe("start_price");
    await db.query("delete from public.raw_material_changelog");
  });

  it("lekker ikke kandidater fra et annet selskap", async () => {
    await resetLinks();
    await db.query("delete from public.invoice_lines");
    const inv = await db.query<{ id: string }>(
      `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date)
       values ($1,$2,'HEMMELIG-1','2026-08-02') returning id`,
      [OTHER_ENTITY, SUPPLIER],
    );
    await db.query(
      `insert into public.invoice_lines(invoice_id, raw_material_id, description, quantity, total_amount,
         base_quantity, price_per_base_unit, match_confidence, unit) values ($1,$2,'Skjult',2,500,50,10,'manual','sekk')`,
      [inv.rows[0].id, RM],
    );
    const res = await db.query<{ v: Array<{ invoice_number: string }> }>(
      "select public.rm_start_price_candidates($1,null,100) as v",
      [ENTITY],
    );
    expect(res.rows[0].v.map((c) => c.invoice_number)).not.toContain("HEMMELIG-1");
    await db.query("delete from public.invoice_lines");
  });

  it("kan ikke sette startpris direkte i tabellen utenom bekreftelsesflyten", async () => {
    await resetLinks();
    await expect(
      db.query("update public.raw_material_suppliers set start_price_per_base_unit = 1"),
    ).rejects.toThrow();
    // Andre kolonner kan fortsatt oppdateres som før.
    await db.query("update public.raw_material_suppliers set supplier_sku = 'ABC-1'");
  });

  it("startprisen faller ut av prisgrunnlaget når pakningen endres", async () => {
    await resetLinks();
    const line = await makeLine({ price: 10, date: "2026-08-10" });
    expect((await confirm(line, 10)).created).toBe(true);
    expect((await reference("2026-09-01")).source).toBe("start_price");
    await db.query("update public.raw_material_suppliers set base_units_per_package = 10, package_size = 10");
    expect((await reference("2026-09-01")).source).not.toBe("start_price");
  });
  // --- Enhetsbasert mengdekontroll (rm_expected_base_quantity) ---

  /** Referanselinje: 10 enheter, base_quantity 10, 1000 kr, pakningsfaktor 6. */
  async function unitLine(unit: string | null): Promise<string> {
    await db.query("delete from public.raw_material_suppliers");
    await db.query(
      `insert into public.raw_material_suppliers(raw_material_id, supplier_id, package_size, package_unit,
         base_units_per_package, package_confirmed_at) values ($1,$2,6,'kg',6, now())`,
      [RM, SUPPLIER],
    );
    const inv = await db.query<{ id: string }>(
      `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date)
       values ($1,$2,$3,'2026-06-01') returning id`,
      [ENTITY, SUPPLIER, `E-${unit ?? "null"}-${Math.random()}`],
    );
    const line = await db.query<{ id: string }>(
      `insert into public.invoice_lines(invoice_id, raw_material_id, description, quantity, unit, total_amount,
         base_quantity, price_per_base_unit, match_confidence, requires_review)
       values ($1,$2,'Hvetemel',10,$3,1000,10,100,'manual',false) returning id`,
      [inv.rows[0].id, RM, unit],
    );
    return line.rows[0].id;
  }

  it("godtar referanselinjen i grunnenheten", async () => {
    const e = await eligibility(await unitLine("kg"));
    expect(e.blockers).toEqual([]);
    expect(e.eligible).toBe(true);
  });

  it("avviser liter mot en vare som måles i kilo", async () => {
    const line = await unitLine("l");
    const e = await eligibility(line);
    expect(e.blockers).toContain("enhet_passer_ikke_med_grunnenheten");
    expect(e.eligible).toBe(false);
    expect((await confirm(line)).created).toBe(false);
  });

  it("avviser 10 kartonger à 6 kg når mengden fortsatt står som 10", async () => {
    const line = await unitLine("kartong");
    const e = await eligibility(line);
    expect(e.blockers).toContain("mengden_stemmer_ikke_med_pakningen");
    expect(e.eligible).toBe(false);
    expect((await confirm(line)).created).toBe(false);
  });

  it("godtar 10 000 gram som 10 kilo", async () => {
    await db.query("delete from public.raw_material_suppliers");
    await db.query(
      `insert into public.raw_material_suppliers(raw_material_id, supplier_id, package_size, package_unit,
         base_units_per_package, package_confirmed_at) values ($1,$2,6,'kg',6, now())`,
      [RM, SUPPLIER],
    );
    const inv = await db.query<{ id: string }>(
      `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date)
       values ($1,$2,'E-gram','2026-06-02') returning id`,
      [ENTITY, SUPPLIER],
    );
    const line = await db.query<{ id: string }>(
      `insert into public.invoice_lines(invoice_id, raw_material_id, description, quantity, unit, total_amount,
         base_quantity, price_per_base_unit, match_confidence, requires_review)
       values ($1,$2,'Hvetemel',10000,'g',1000,10,100,'manual',false) returning id`,
      [inv.rows[0].id, RM],
    );
    const e = await eligibility(line.rows[0].id);
    expect(e.blockers).toEqual([]);
    const c = await confirm(line.rows[0].id, 100);
    expect(c.created).toBe(true);
    expect(Number(c.start_price)).toBe(100);
  });

  it("avviser linje uten enhet i stedet for å gjette", async () => {
    const e = await eligibility(await unitLine(null));
    expect(e.blockers).toContain("ukjent_enhet_pa_linjen");
  });
});

/**
 * Bekreftelses-RPC-en (rm_confirm_line_match) testet mot faktisk migrert SQL:
 * fersk ukoblet linje uten beregnede felter, bevaring av uavklarte
 * dokumentårsaker, og at linjen står til ny beregning etter bekreftelsen.
 */
describe("rm_confirm_line_match", () => {
  async function freshLine(opts: {
    quantity: number;
    unit: string;
    total: number;
    date: string;
    reviewReason?: string | null;
    requiresReview?: boolean;
  }): Promise<string> {
    const inv = await db.query<{ id: string }>(
      `insert into public.invoices(legal_entity_id, supplier_id, invoice_number, invoice_date)
       values ($1,$2,$3,$4) returning id`,
      [ENTITY, SUPPLIER, `M-${opts.date}-${opts.total}`, opts.date],
    );
    const line = await db.query<{ id: string }>(
      `insert into public.invoice_lines(invoice_id, raw_material_id, supplier_sku, description, quantity, unit,
         total_amount, base_quantity, price_per_base_unit, match_confidence, requires_review, review_reason)
       values ($1,null,'SKU-1','Hvetemel',$2,$3,$4,null,null,null,$5,$6) returning id`,
      [inv.rows[0].id, opts.quantity, opts.unit, opts.total, opts.requiresReview ?? true, opts.reviewReason ?? "unmatched"],
    );
    return line.rows[0].id;
  }

  async function confirmMatch(lineId: string, bupp = 1) {
    const r = await db.query<{ v: Record<string, unknown> }>(
      "select public.rm_confirm_line_match($1,$2,null,null,$3,true,null,false,null,true) as v",
      [lineId, RM, bupp],
    );
    return r.rows[0].v as {
      ok: boolean;
      start_price: { attempted: boolean; created: boolean; reason: string | null; start_price?: number };
      recalculation_pending?: boolean;
    };
  }

  async function lineRow(id: string) {
    const r = await db.query<{
      base_quantity: number | null;
      price_per_base_unit: number | null;
      requires_review: boolean;
      review_reason: string | null;
      match_confidence: string | null;
    }>(
      `select base_quantity, price_per_base_unit, requires_review, review_reason, match_confidence
         from public.invoice_lines where id = $1`,
      [id],
    );
    return r.rows[0];
  }

  beforeAll(async () => {
    await db.query(
      `insert into public.invoice_match_settings(legal_entity_id, use_first_confirmed_price_as_start)
       values ($1, true)
       on conflict (legal_entity_id) do update set use_first_confirmed_price_as_start = true`,
      [ENTITY],
    );
  });

  it("regner ut mengde og pris i samme transaksjon og lagrer startpris", async () => {
    await db.query("delete from public.raw_material_suppliers");
    await db.query("delete from public.raw_material_changelog");
    const line = await freshLine({ quantity: 10, unit: "kg", total: 1000, date: "2026-08-01" });

    const res = await confirmMatch(line, 1);
    expect(res.ok).toBe(true);
    expect(res.start_price.created).toBe(true);
    expect(Number(res.start_price.start_price)).toBe(100);

    const row = await lineRow(line);
    expect(Number(row.base_quantity)).toBe(10);
    expect(Number(row.price_per_base_unit)).toBe(100);
    expect(row.match_confidence).toBe("manual");

    const rms = await db.query<{ p: number }>(
      "select start_price_per_base_unit as p from public.raw_material_suppliers where raw_material_id = $1",
      [RM],
    );
    expect(Number(rms.rows[0].p)).toBe(100);
  });

  it("bevarer uavklart uttrekk og lagrer ikke startpris fra en ugyldig kilde", async () => {
    await db.query("delete from public.raw_material_suppliers");
    const line = await freshLine({
      quantity: 10,
      unit: "kg",
      total: 1000,
      date: "2026-08-02",
      reviewReason: "extraction_unresolved,unmatched",
      requiresReview: true,
    });

    const res = await confirmMatch(line, 1);
    expect(res.ok).toBe(true);
    expect(res.start_price.created).toBe(false);
    expect(res.start_price.reason).toBe("uavklart_gjennomgangsarsak");

    const row = await lineRow(line);
    expect(row.requires_review).toBe(true);
    expect(row.review_reason?.split(",")).toContain("extraction_unresolved");

    const rms = await db.query<{ p: number | null }>(
      "select start_price_per_base_unit as p from public.raw_material_suppliers where raw_material_id = $1",
      [RM],
    );
    expect(rms.rows[0].p).toBeNull();
  });

  it("lar linjen stå til ny beregning i stedet for å se ferdig kontrollert ut", async () => {
    await db.query("delete from public.raw_material_suppliers");
    const line = await freshLine({ quantity: 10, unit: "kg", total: 1000, date: "2026-08-03" });

    const res = await confirmMatch(line, 1);
    expect(res.recalculation_pending).toBe(true);
    expect(res.start_price.created).toBe(true);

    const row = await lineRow(line);
    expect(row.requires_review).toBe(true);
    expect(row.review_reason?.split(",")).toContain("recalculation_pending");
  });

  it("avviser feil enhet og lagrer verken mengde eller startpris", async () => {
    await db.query("delete from public.raw_material_suppliers");
    const line = await freshLine({ quantity: 10, unit: "l", total: 1000, date: "2026-08-04" });

    const res = await confirmMatch(line, 1);
    expect(res.ok).toBe(true);
    expect(res.start_price.created).toBe(false);

    const row = await lineRow(line);
    expect(row.base_quantity).toBeNull();
    expect(row.price_per_base_unit).toBeNull();
  });
});
