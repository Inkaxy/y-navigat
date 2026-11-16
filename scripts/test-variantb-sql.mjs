// Kjører variant B-forslagene (fase 1–3) mot innebygd PostgreSQL (PGlite) med en minimal stubb av
// live-skjemaet. Rører aldri live. Bruk: node scripts/test-variantb-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "pending");
const read = (f) => readFileSync(join(dir, f), "utf8");
// Stubben har ikke live-teksten byte for byte: md5-vakten byttes mot en innholdskontroll.
const phase1 = read("20261117_beslutninger_angre.PENDING.sql").replace("if md5(v_def) <> '35d0e2bd23aff1c85459c4299db189d9' then", "if false then");
const phase2 = read("20261117_prislinje.PENDING.sql");
const phase3 = read("20261117_automatikk.PENDING.sql");

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role', true), '') $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select coalesce(current_setting('test.write', true), '') = 'on' $$;
create function public.has_ravarer_invoice_approve(uuid) returns boolean language sql stable as $$ select coalesce(current_setting('test.approve', true), '') = 'on' $$;
create function public.has_ravarer_invoice_read_or_owner(uuid) returns boolean language sql stable as $$ select true $$;
create function public.rm_is_finite(numeric) returns boolean language sql immutable as $$ select $1 is not null and $1 <> 'NaN'::numeric $$;
create function public.rm_sku_norm(text) returns text language sql immutable as $$ select lower(regexp_replace(coalesce($1, ''), '[^a-zA-Z0-9]', '', 'g')) $$;
create function public.rm_match_key(text) returns text language sql immutable as $$ select lower(btrim(coalesce($1, ''))) $$;
create function public.tg_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
create table invoices (id uuid primary key default gen_random_uuid(), legal_entity_id uuid, supplier_id uuid, invoice_number text, invoice_date date,
  status text, flagged_at timestamptz, reconciled_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(),
  is_credit_note boolean default false, currency text default 'NOK');
create table invoice_lines (id uuid primary key default gen_random_uuid(), invoice_id uuid, line_number int, supplier_sku text, description text,
  quantity numeric, unit text, unit_price numeric, total_amount numeric, vat_rate numeric, raw_material_id uuid, match_confidence text,
  price_per_base_unit numeric, expected_price_per_base_unit numeric, price_variance_pct numeric, variance_status text,
  requires_review boolean, review_reason text, resolved_at timestamptz, resolved_by uuid, resolution_note text,
  updated_at timestamptz default now(), base_quantity numeric, package_source_rms_id uuid, line_kind text, excluded_at timestamptz,
  price_acceptance jsonb, price_reference_source text, price_reference_date date, price_reference_id uuid);
create table invoice_internal_approvals (invoice_id uuid, status text, revoked_at timestamptz);
create table invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table audit_log (id bigserial, user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text,
  legal_entity_id uuid, changes jsonb, reason text, source_app text);
create table invoice_line_exclusion_patterns (id uuid primary key default gen_random_uuid(), legal_entity_id uuid, supplier_id uuid,
  pattern_type text, pattern_value text, reason text, created_by uuid, created_at timestamptz default now());
create table raw_materials (id uuid primary key default gen_random_uuid(), legal_entity_id uuid, name text, base_unit text,
  current_cost_price numeric, cost_basis_status text);
create table raw_material_price_history (id uuid primary key default gen_random_uuid(), raw_material_id uuid, supplier_id uuid, price numeric,
  effective_date date, source text, source_reference text, invoice_id uuid, notes text, created_at timestamptz default now(), created_by uuid,
  invoice_line_id uuid, invoice_line_ref uuid, currency text, is_credit boolean default false, is_legacy boolean default false,
  superseded_at timestamptz, superseded_reason text, cost_eligible boolean default false, snapshot_unit text, snapshot_currency text);
create unique index ux_rmph_invoice_line on raw_material_price_history (invoice_line_id) where invoice_line_id is not null and superseded_at is null;
create table raw_material_suppliers (id uuid primary key default gen_random_uuid(), raw_material_id uuid, supplier_id uuid, supplier_sku text,
  package_size numeric, package_unit text, base_units_per_package numeric, container_unit text, package_confirmed_at timestamptz,
  package_confirmed_by uuid, updated_at timestamptz default now());
create trigger trg_rms_upd before update on raw_material_suppliers for each row execute function tg_set_updated_at();
create table raw_material_supplier_packages (id uuid primary key default gen_random_uuid(), raw_material_supplier_id uuid, supplier_sku_norm text,
  package_size numeric, package_unit text, base_units_per_package numeric, container_unit text, superseded_at timestamptz, superseded_reason text);
create table invoice_match_settings (legal_entity_id uuid primary key, default_price_tolerance_pct numeric);
create table rm_rematch_queue (id bigserial, legal_entity_id uuid, invoice_id uuid, status text, queued_at timestamptz default now(), finished_at timestamptz);
create function public.rm_rematch_invoices(p_legal_entity_id uuid, p_limit int, p_invoice_ids uuid[], p_only_open boolean) returns jsonb language plpgsql as $$
declare n int; begin insert into rm_rematch_queue (legal_entity_id, invoice_id, status) select p_legal_entity_id, x, 'queued' from unnest(p_invoice_ids) x;
get diagnostics n = row_count; return jsonb_build_object('ok', true, 'queued', n); end $$;
-- Kost: nyeste aktive kostkandidat (forenklet prisvelger).
create function public.rm_apply_derived_cost_price(p uuid) returns void language plpgsql as $$ begin
  update raw_materials set current_cost_price = (select h.price from raw_material_price_history h where h.raw_material_id = p and h.superseded_at is null
    and not h.is_legacy and not h.is_credit and h.price > 0 order by h.effective_date desc, h.price desc, h.created_at desc limit 1) where id = p; end $$;
create function public.trg_rmph_reapply_cost() returns trigger language plpgsql as $$ begin perform rm_apply_derived_cost_price(coalesce(new.raw_material_id, old.raw_material_id)); return coalesce(new, old); end $$;
create trigger trg_rmph_reapply_cost after insert or update or delete on raw_material_price_history for each row execute function trg_rmph_reapply_cost();
create function public.rm_snap() returns trigger language plpgsql as $$ begin
  if tg_op = 'INSERT' then select base_unit into new.snapshot_unit from raw_materials where id = new.raw_material_id; new.snapshot_currency := coalesce(new.currency, 'NOK');
  elsif old.price is distinct from new.price then raise exception 'Låst prisobservasjon'; end if; return new; end $$;
create trigger trg_rmph_snapshot before insert or update on raw_material_price_history for each row execute function rm_snap();
create function public._rms_record_package_variant() returns trigger language plpgsql as $$ begin
  if tg_op = 'UPDATE' and old.package_confirmed_at is not null then
    insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, container_unit)
    select old.id, rm_sku_norm(old.supplier_sku), old.package_size, old.package_unit, old.base_units_per_package, old.container_unit
     where not exists (select 1 from raw_material_supplier_packages p where p.raw_material_supplier_id = old.id and p.base_units_per_package = old.base_units_per_package);
  end if;
  insert into raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, container_unit)
  select new.id, rm_sku_norm(new.supplier_sku), new.package_size, new.package_unit, new.base_units_per_package, new.container_unit
   where not exists (select 1 from raw_material_supplier_packages p where p.raw_material_supplier_id = new.id and p.base_units_per_package = new.base_units_per_package);
  return new; end $$;
create trigger trg_rms_package_variant after insert or update on raw_material_suppliers for each row execute function _rms_record_package_variant();
-- Live-vakten (forenklet, samme første linje som live).
CREATE OR REPLACE FUNCTION public._rm_retain_price_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  acc jsonb := OLD.price_acceptance;
BEGIN
  IF acc IS NULL OR NEW.price_acceptance IS NOT NULL OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id THEN RETURN NEW; END IF;
  NEW.price_acceptance := acc; NEW.requires_review := false; NEW.review_reason := null;
  RETURN NEW;
END $function$;
create trigger zz_rm_retain_price_acceptance before update on invoice_lines for each row
  when (old.price_acceptance is not null and new.price_acceptance is null) execute function _rm_retain_price_acceptance();
`;

const LE = "11111111-1111-1111-1111-111111111111";
const SUP = "22222222-2222-2222-2222-222222222222";
const U1 = "33333333-3333-3333-3333-333333333333";
const U2 = "44444444-4444-4444-4444-444444444444";
const db = new PGlite();
let pass = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const ok = (cond, m) => { if (!cond) fail(m); pass++; };
const as = async (uid, { write = true, approve = false } = {}) => {
  await db.exec(`select set_config('test.uid', '${uid ?? ""}', false), set_config('test.write', '${write ? "on" : ""}', false), set_config('test.approve', '${approve ? "on" : ""}', false), set_config('test.role', '${uid ? "authenticated" : ""}', false)`);
};
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

try {
  await db.exec(stub);
  await db.exec(phase1); await db.exec(phase2); await db.exec(phase3);
  ok(true, "filene kjører");
  // Gjentatt kjøring skal også gå (idempotente ALTER/CREATE).
  await db.exec(phase2); await db.exec(phase3);
  ok(true, "fase 2 og 3 kan kjøres to ganger");

  // ---------- Fase 1: angre godtatt pris ----------
  const rm = (await one(`insert into raw_materials (legal_entity_id, name, base_unit) values ($1, 'Smør', 'kg') returning id`, [LE])).id;
  const inv = (await one(`insert into invoices (legal_entity_id, supplier_id, invoice_number, invoice_date, status) values ($1, $2, '1001', '2026-11-03', 'needs_review') returning id`, [LE, SUP])).id;
  const acc = JSON.stringify({ accepted_reasons: ["price_increase"], accepted_by: U1, accepted_at: "2026-11-16T10:00:00Z" });
  const l1 = (await one(`insert into invoice_lines (invoice_id, line_number, supplier_sku, description, quantity, unit, total_amount, raw_material_id, match_confidence, requires_review, price_acceptance, resolution_note, resolved_by)
    values ($1, 1, 'S1', 'Smør 10 kg', 4, 'kartong', 4120, $2, 'manual', false, $3, 'Prisavvik godtatt', $4) returning id`, [inv, rm, acc, U1])).id;
  await as(U2);
  let r = await one(`select public.rm_undo_price_acceptance($1, array[$2]::uuid[]) r`, [LE, l1]);
  ok(r.r.undone.length === 0 && r.r.skipped[0].reason === "annen_bruker", "annen bruker uten approve kan ikke angre");
  await as(U1);
  r = await one(`select public.rm_undo_price_acceptance($1, array[$2]::uuid[]) r`, [LE, l1]);
  ok(r.r.undone.length === 1, "egen godtatt pris angres");
  let line = await one(`select requires_review, review_reason, price_acceptance from invoice_lines where id = $1`, [l1]);
  ok(line.requires_review === true && line.review_reason === "price_increase" && line.price_acceptance === null, "linjen er åpen igjen med samme årsak (vakten gjenoppretter ikke)");
  ok((await one(`select count(*)::int n from audit_log where action = 'invoice_line.price_variance_acceptance_undone'`)).n === 1, "angring er loggført");
  await db.query(`update invoices set reconciled_at = now() where id = $1`, [inv]);
  await db.query(`update invoice_lines set requires_review = false, price_acceptance = $2 where id = $1`, [l1, acc]);
  r = await one(`select public.rm_undo_price_acceptance($1, array[$2]::uuid[]) r`, [LE, l1]);
  ok(r.r.skipped[0].reason === "faktura_last", "avstemt faktura sperrer angring");
  await db.query(`update invoices set reconciled_at = null where id = $1`, [inv]);
  await as(U1, { write: false });
  try { await db.query(`select public.rm_undo_price_acceptance($1, array[$2]::uuid[])`, [LE, l1]); fail("uten skriverett skulle feile"); } catch { ok(true, "krever skriverett"); }

  // ---------- Fase 1: angre «Ikke vare» ----------
  await as(U1);
  const now = "2026-11-16T11:00:00Z";
  const l2 = (await one(`insert into invoice_lines (invoice_id, line_number, supplier_sku, description, match_confidence, requires_review, resolution_note, resolved_by, resolved_at)
    values ($1, 2, 'PALL', 'Europall', 'not_applicable', false, 'Ikke vare: Pall', $2, $3) returning id`, [inv, U1, now])).id;
  await db.query(`insert into invoice_line_exclusion_patterns (legal_entity_id, supplier_id, pattern_type, pattern_value, reason, created_by, created_at) values ($1, $2, 'exact_sku', 'PALL', 'Pall', $3, $4)`, [LE, SUP, U1, now]);
  await db.query(`insert into invoice_line_exclusion_patterns (legal_entity_id, supplier_id, pattern_type, pattern_value, reason, created_by, created_at) values ($1, $2, 'exact_sku', 'GAMMEL', 'Gammel', $3, '2026-01-01')`, [LE, SUP, U1]);
  r = await one(`select public.rm_undo_not_item($1, $2, 'sku:pall', array[$3]::uuid[]) r`, [LE, SUP, l2]);
  ok(r.r.undone.length === 1 && r.r.removed_rules.length === 1, "«Ikke vare» angres og regelen fra samme svar fjernes");
  ok((await one(`select count(*)::int n from invoice_line_exclusion_patterns`)).n === 1, "eldre regel står urørt");
  line = await one(`select match_confidence, requires_review from invoice_lines where id = $1`, [l2]);
  ok(line.match_confidence === "unmatched" && line.requires_review === true, "linjen er et åpent spørsmål igjen");

  // ---------- Fase 2: rett pris på ett kjøp ----------
  const l3 = (await one(`insert into invoice_lines (invoice_id, line_number, description, raw_material_id) values ($1, 3, 'Smør', $2) returning id`, [inv, rm])).id;
  const h1 = (await one(`insert into raw_material_price_history (raw_material_id, supplier_id, price, effective_date, source, invoice_id, invoice_line_id, cost_eligible) values ($1, $2, 103, '2026-11-03', 'invoice', $3, $4, true) returning id`, [rm, SUP, inv, l3])).id;
  await db.query(`insert into raw_material_price_history (raw_material_id, supplier_id, price, effective_date, source, cost_eligible) values ($1, $2, 98, '2026-10-01', 'invoice', true)`, [rm, SUP]);
  ok(Number((await one(`select current_cost_price c from raw_materials where id = $1`, [rm])).c) === 103, "utgangspunkt: kost 103");
  const op1 = "55555555-5555-5555-5555-555555555555";
  await as(U1, { approve: false });
  try { await db.query(`select public.rm_correct_purchase_price($1, 10.3, 'Feil komma på faktura', $2, true)`, [h1, op1]); fail("uten approve skulle feile"); } catch { ok(true, "retting krever approve/admin"); }
  await as(U1, { approve: true });
  r = await one(`select public.rm_correct_purchase_price($1, 101, 'Feil lest pris', $2, true) r`, [h1, op1]);
  ok(r.r.dry_run === true && Number(r.r.cost_after) === 101 && Number(r.r.cost_before) === 103, "forhåndsvisning viser kost før/etter");
  ok(Number((await one(`select current_cost_price c from raw_materials where id = $1`, [rm])).c) === 103 && (await one(`select superseded_at from raw_material_price_history where id = $1`, [h1])).superseded_at === null, "forhåndsvisning lagrer ingenting");
  r = await one(`select public.rm_correct_purchase_price($1, 101, 'Feil lest pris', $2, false) r`, [h1, op1]);
  ok(r.r.ok === true && r.r.dry_run === false, "retting lagres");
  ok(Number((await one(`select current_cost_price c from raw_materials where id = $1`, [rm])).c) === 101, "gjeldende kost følger rettet kjøp");
  ok((await one(`select count(*)::int n from raw_material_price_history where raw_material_id = $1 and superseded_at is null`, [rm])).n === 2, "bare det ene kjøpet er byttet (andre kjøp urørt)");
  r = await one(`select public.rm_correct_purchase_price($1, 101, 'Feil lest pris', $2, false) r`, [h1, op1]);
  ok(r.r.already === true, "samme opId gjentar ikke rettingen");
  r = await one(`select public.rm_correct_purchase_price($1, 99, 'Annen pris', $2, false) r`, [h1, op1]);
  ok(r.r.error === "op_gjenbrukt", "samme opId med annen pris avvises");
  ok((await one(`select count(*)::int n from audit_log where action = 'raw_material.purchase_price_corrected'`)).n === 1, "retting er loggført");
  r = await one(`select public.rm_revert_purchase_price_correction($1, 'Rettet feil vare') r`, [op1]);
  ok(r.r.ok === true, "retting kan angres");
  ok(Number((await one(`select current_cost_price c from raw_materials where id = $1`, [rm])).c) === 103, "kost tilbake etter angring");

  // ---------- Fase 2: endre godkjent pakning ----------
  const rms = (await one(`insert into raw_material_suppliers (raw_material_id, supplier_id, supplier_sku, package_size, package_unit, base_units_per_package, container_unit, package_confirmed_at)
    values ($1, $2, 'S1', 10, 'kg', 10, 'kartong', now()) returning id, updated_at`, [rm, SUP]));
  await db.query(`insert into invoice_lines (invoice_id, line_number, description, quantity, unit, total_amount, raw_material_id, requires_review, package_source_rms_id) values ($1, 4, 'Smør', 4, 'kartong', 4120, $2, true, $3)`, [inv, rm, rms.id]);
  const op2 = "66666666-6666-6666-6666-666666666666";
  r = await one(`select public.rm_change_approved_package($1, 12.5, 'kg', 12.5, 'kartong', 'Ny kartongstørrelse', $2, $3, true) r`, [rms.id, rms.updated_at, op2]);
  ok(r.r.dry_run === true && r.r.open_lines === 1 && Number(r.r.lines[0].new_price_per_base_unit) === 82.4, "pakning: forhåndsvisning regner ny pris per kg");
  r = await one(`select public.rm_change_approved_package($1, 12.5, 'kg', 12.5, 'kartong', 'Ny kartongstørrelse', $2, $3, false) r`, [rms.id, rms.updated_at, op2]);
  ok(r.r.ok === true && r.r.requeued === 1, "pakning lagres og åpen faktura legges i kø");
  const vars = await db.query(`select base_units_per_package b, superseded_at is null aktiv from raw_material_supplier_packages where raw_material_supplier_id = $1 order by b`, [rms.id]);
  ok(vars.rows.length === 2 && vars.rows[0].aktiv === false && vars.rows[1].aktiv === true, "forrige variant erstattet, ny variant aktiv (ingen sletting)");
  r = await one(`select public.rm_change_approved_package($1, 12.5, 'kg', 12.5, 'kartong', 'Igjen', $2, gen_random_uuid(), true) r`, [rms.id, rms.updated_at]);
  ok(r.r.error === "versjon_endret", "gammel versjon avvises");

  // ---------- Fase 3: pant som følgevare ----------
  await as(U1);
  const pant = (await one(`insert into invoice_lines (invoice_id, line_number, description, vat_rate, line_kind, match_confidence, requires_review, review_reason) values ($1, 5, 'PANT - LITEN BOKS (2 NOK)', 0, 'pant', 'unmatched', true, 'unmatched') returning id`, [inv])).id;
  const pantMva = (await one(`insert into invoice_lines (invoice_id, line_number, description, vat_rate, line_kind, match_confidence, requires_review) values ($1, 6, 'Pant med mva?', 25, 'pant', 'unmatched', true) returning id`, [inv])).id;
  r = await one(`select public.rm_mark_deposit_follow_items($1, null, 50, true) r`, [LE]);
  ok(r.r.marked === 1 && r.r.skipped[0].reason === "mva_ikke_null", "pant: forhåndsvisning, mva ≠ 0 holdes igjen");
  ok((await one(`select requires_review from invoice_lines where id = $1`, [pant])).requires_review === true, "forhåndsvisning endrer ingenting");
  r = await one(`select public.rm_mark_deposit_follow_items($1, null, 50, false) r`, [LE]);
  line = await one(`select match_confidence, requires_review, resolution_note, deposit_parent_line_id from invoice_lines where id = $1`, [pant]);
  ok(line.requires_review === false && line.resolution_note.startsWith("Pant – følgevare") && line.deposit_parent_line_id !== null, "pant følger varelinjen over");
  ok((await one(`select requires_review from invoice_lines where id = $1`, [pantMva])).requires_review === true, "pant med mva står igjen til kontroll");

  // ---------- Fase 3: gamle åpne fakturaer ----------
  await db.query(`insert into invoice_match_settings (legal_entity_id) values ($1)`, [LE]);
  await db.query(`update invoices set created_at = now() - interval '10 days' where id = $1`, [inv]);
  await db.query(`update rm_rematch_queue set status = 'done', finished_at = now() - interval '9 days'`);
  r = await one(`select public.rm_requeue_stale_open_invoices($1, 10, true) r`, [LE]);
  ok(r.r.candidates === 1 && r.r.queued === 0, "kø: forhåndsvisning finner gammel åpen faktura");
  await as(null, { write: false });
  await db.exec(`select set_config('test.role', 'service_role', false)`);
  r = await one(`select public.rm_requeue_stale_open_invoices($1, null, false) r`, [LE]);
  ok(r.r.skipped === "av", "planlagt kjøring gjør ingenting når bryteren er av");
  await db.query(`update invoice_match_settings set auto_requeue_stale_enabled = true, auto_requeue_batch_size = 5 where legal_entity_id = $1`, [LE]);
  r = await one(`select public.rm_automation_tick() r`);
  ok(r.r.entities[0].requeued === 1, "planlagt kjøring legger gamle fakturaer i kø når bryteren er på");
  await as(U1);
  try { await db.query(`select public.rm_automation_tick()`); fail("innlogget bruker skulle ikke kunne kjøre tick"); } catch { ok(true, "tick bare for planlagt kjøring"); }

  console.log(`OK-kontroller: ${pass}`);
  console.log("ALLE VARIANT B-SQL-TESTER BESTÅTT");
} catch (e) {
  console.error(`OK før feil: ${pass}`);
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
