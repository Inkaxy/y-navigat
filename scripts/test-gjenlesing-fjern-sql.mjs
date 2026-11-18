// Gjenlesing kan fjerne linjer: kjører 20261123_gjenlesing_fjern_linjer.PENDING.sql mot en byte-identisk kopi av dagens
// rm_apply_invoice_reread (hentet fra live 18.11, md5 c9c68ddd…) i PGlite, med stubber for det funksjonen kaller.
// Kontrollerer at erstatning fjerner rester, at beskyttede linjer aldri fjernes, og at linjesummen ikke kan øke av rester.
// Bruk: node scripts/test-gjenlesing-fjern-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(root, "scripts/fixtures/live-20261118", f), "utf8");
const pending = readFileSync(join(root, "supabase/pending/1-kjor-na/01_gjenlesing_fjern_linjer.sql"), "utf8");
const check = readFileSync(join(root, "supabase/pending/kontroll/20261123_gjenlesing_fjern_linjer.check.sql"), "utf8");

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage;
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.has_ravarer_invoice_access(uuid, text) returns boolean language sql stable as $$ select true $$;
create function public.rm_is_finite(numeric) returns boolean language sql immutable as $$ select $1 is not null $$;
create table invoices (id uuid primary key, legal_entity_id uuid, invoice_number text, status text default 'needs_review', total_amount numeric, total_vat numeric,
  is_credit_note boolean default false, extraction_issues jsonb default '[]', lines_sum_excl_vat numeric, lines_sum_variance_pct numeric, lines_sum_status text,
  updated_at timestamptz default now());
create table invoice_lines (id uuid primary key default gen_random_uuid(), invoice_id uuid, line_number int, supplier_sku text, description text, quantity numeric,
  unit text, unit_price numeric, total_amount numeric, package_size numeric, package_unit text, count_per_package numeric, line_kind text, unit_price_basis text,
  discount_amount numeric, extraction_issues jsonb default '[]', extraction_evidence jsonb, requires_review boolean, match_confidence text, raw_material_id uuid,
  price_acceptance jsonb, excluded_at timestamptz, excluded_raw_material_id uuid, updated_at timestamptz default now());
create table invoice_reread_runs (id uuid primary key, invoice_id uuid, legal_entity_id uuid, created_by uuid, status text, expires_at timestamptz,
  snapshot jsonb, proposal jsonb, document_path text, document_sha256 text, applied_at timestamptz, applied_by uuid, applied_operations jsonb, apply_reason text, result jsonb);
create table audit_log (id uuid primary key default gen_random_uuid(), user_id uuid, action text, entity_type text, entity_id uuid, entity_display_reference text,
  legal_entity_id uuid, changes jsonb, reason text, source_app text);
create table invoice_line_corrections (id uuid primary key default gen_random_uuid(), invoice_line_id uuid, invoice_id uuid);
create table invoice_line_cost_postings (invoice_line_id uuid);
create table rm_goods_receipts (invoice_line_id uuid);
create table rm_stock_lots (invoice_line_id uuid);
create table stock_movements (source_table text, source_id uuid);
create table supplier_deviation_case_lines (invoice_line_id uuid);
create table raw_material_suppliers (id uuid primary key default gen_random_uuid(), start_price_invoice_line_id uuid);
create function public._rm_reread_blocker(uuid) returns text language sql stable as $$ select null::text $$;
create function public._rm_reread_snapshot(uuid) returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create function public._rm_bounded_issues(jsonb, text) returns jsonb language sql immutable as $$ select coalesce($1, '[]'::jsonb) $$;
create function public.rm_line_read_issues_v2(numeric,text,numeric,numeric,numeric,text,numeric,boolean,text,numeric,text) returns jsonb language sql immutable as $$ select '[]'::jsonb $$;
create function public.rm_rematch_invoices(uuid,int,uuid[],boolean) returns jsonb language sql as $$ select '{"ok":true}'::jsonb $$;
create function public.rm_lines_sum_check(p_sum numeric, p_n int, p_total numeric, p_vat numeric, p_credit boolean) returns jsonb language sql immutable as $$
  select case when p_n = 0 then jsonb_build_object('lines_sum_status','no_lines') else
    jsonb_build_object('lines_sum_excl_vat', p_sum, 'lines_sum_variance_pct', round((p_sum - (p_total - p_vat)) / (p_total - p_vat) * 100, 2),
      'lines_sum_status', case when abs((p_sum - (p_total - p_vat)) / (p_total - p_vat) * 100) <= 2 then 'ok' else 'mismatch' end) end $$;
create function public.rm_correct_invoice_line(p_line uuid, p_upd timestamptz, p_vals jsonb, p_reason text, p_learn boolean, p_x boolean) returns jsonb language plpgsql as $$
begin
  update invoice_lines set total_amount = coalesce((p_vals->>'total_amount')::numeric, total_amount), quantity = coalesce((p_vals->>'quantity')::numeric, quantity),
    unit_price = coalesce((p_vals->>'unit_price')::numeric, unit_price), updated_at = now() where id = p_line;
  insert into invoice_line_corrections (invoice_line_id) values (p_line);
  return '{"ok":true}'::jsonb;
end $$;
`;

const U = "00000000-0000-0000-0000-0000000000e1", LE = "00000000-0000-0000-0000-0000000000a1", INV = "00000000-0000-0000-0000-0000000000c1";
const A = "00000000-0000-0000-0000-0000000000d1", P1 = "00000000-0000-0000-0000-0000000000d2", P2 = "00000000-0000-0000-0000-0000000000d3";
let ok = 0, runNo = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const expect = (c, m) => { if (!c) fail(m); ok++; };
const db = new PGlite();
const one = async (sql) => (await db.query(sql)).rows[0];
const err = async (sql) => { try { await db.exec(sql); return null; } catch (e) { return String(e.message); } };
const cand = (id, total, sku = null, desc = "x") => ({ candidate_id: id, values: { supplier_sku: sku, description: desc, quantity: 1, unit: "stk", unit_price: total, total_amount: total } });

/** Ny faktura: linjer [id, beløp, ekstra kolonner], kandidater, og en klar gjenlesing. */
async function setup(lines, cands) {
  runNo++;
  await db.exec(`delete from invoice_lines; delete from invoices; delete from audit_log; delete from invoice_line_corrections; delete from invoice_line_cost_postings;
    insert into invoices (id, legal_entity_id, invoice_number, total_amount, total_vat) values ('${INV}', '${LE}', '9204947561', 1150, 150);`);
  for (const [id, total, extra = {}] of lines) {
    const cols = Object.keys(extra), vals = Object.values(extra).map((v) => (v === null ? "null" : `'${typeof v === "object" ? JSON.stringify(v) : v}'`));
    await db.exec(`insert into invoice_lines (id, invoice_id, line_number, description, quantity, unit, unit_price, total_amount${cols.map((c) => `, ${c}`).join("")})
      values ('${id}', '${INV}', 1, 'x', 1, 'stk', ${total}, ${total}${vals.map((v) => `, ${v}`).join("")});`);
  }
  const run = `00000000-0000-0000-0000-${String(runNo).padStart(12, "0")}`;
  await db.exec(`insert into invoice_reread_runs (id, invoice_id, legal_entity_id, created_by, status, expires_at, snapshot, proposal, document_path)
    values ('${run}', '${INV}', '${LE}', '${U}', 'ready', now() + interval '1 day', '{}', '${JSON.stringify({ candidates: cands })}', 'x.pdf');`);
  return run;
}
const apply = (run, ops) => `select public.rm_apply_invoice_reread('${run}', '${JSON.stringify(ops)}'::jsonb, 'Test gjenlesing') r`;
const sumNow = async () => Number((await one(`select coalesce(sum(total_amount),0) s from invoice_lines`)).s);

await db.exec(stub);
await db.exec(`select set_config('test.uid', '${U}', false);`);
await db.exec(fx("_rm_reread_values.sql"));
await db.exec(fx("rm_apply_invoice_reread.sql"));
expect((await one(`select md5(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure)) m`)).m === "c9c68ddd556312ec0b03d5d3365d4e6a", "fixture gir live-md5");

// Før filen: 17.11-feilen kan gjenskapes (add uten motstykke øker summen), og remove avvises.
let run = await setup([[A, 952], [P1, 48]], [cand("cA", 952), cand("cP", 48), cand("cP2", 48)]);
expect((await err(apply(run, [{ kind: "add", candidate_id: "cP2", changes: cand("cP2", 48).values, confirmed_addition: true }]))) === null, "før: add uten motstykke godtas");
expect((await sumNow()) === 1048, "før: summen økte til 1048 (17.11-feilen)");
run = await setup([[A, 952]], [cand("cA", 952)]);
expect((await err(apply(run, [{ kind: "remove", line_id: A, confirmed_removal: true }])))?.includes("operasjon_ikke_stottet"), "før: remove avvises");

// Kontrollfilens «før»-del.
const before = (await db.query(check.split("-- ETTER")[0])).rows;
expect(before.every((r) => r.ok === true), `kontroll før: ${JSON.stringify(before)}`);

await db.exec(pending);
const after = (await db.query(check.split("-- ETTER")[1])).rows;
expect(after.every((r) => r.ok === true), `kontroll etter: ${JSON.stringify(after)}`);
const md5After = (await one(`select md5(pg_get_functiondef('public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure)) m`)).m;
console.log("md5 etter:", md5After, "hjelper:", (await one(`select md5(pg_get_functiondef('public._rm_reread_line_protection(uuid)'::regprocedure)) m`)).m);
expect((await err(pending))?.includes("allerede kjørt"), "filen kan ikke kjøres to ganger");
await db.exec("rollback");

// 1) Coca-Cola: duplikat-pant fjernes ved erstatning; summen = ny lesing; raden ligger i revisjonsloggen.
run = await setup([[A, 952], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
const r1 = (await one(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }]))).r;
expect(r1.ok === true && r1.replace === true && r1.applied_count === 3, "erstatning ok");
expect((await sumNow()) === 1000, "summen er nøyaktig ny lesing (1000)");
expect((await one(`select lines_sum_status s from invoices`)).s === "ok", "sumstatus ok");
expect((await one(`select count(*)::int n from invoice_lines where id = '${P2}'`)).n === 0, "resten er fjernet");
expect((await one(`select changes->'before'->>'total_amount' t from audit_log where action = 'invoice_line.reread_removed'`)).t === "48", "hele raden lagret før sletting");
expect((await one(`select (changes->>'replace')::boolean r from audit_log where action = 'invoice.reread_applied'`)).r === true, "revisjonsloggen viser erstatning");

// 2) Ufullstendig erstatning (rest ikke valgt) rulles tilbake.
run = await setup([[A, 952], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
expect((await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }])))?.includes("erstatning_ufullstendig"), "rest som ikke er valgt stopper");
expect((await sumNow()) === 1048, "ingenting endret");
// Kandidat som ikke er brukt stopper også.
run = await setup([[A, 952], [P1, 48]], [cand("cA", 952), cand("cP", 48), cand("cX", 5)]);
expect((await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }])))?.includes("erstatning_ufullstendig"), "ubrukt kandidat stopper");

// 3) Beskyttede linjer kan aldri fjernes.
const protections = [
  ["godtatt_pris", { price_acceptance: { at: "x" } }], ["manuell_kobling", { match_confidence: "manual", raw_material_id: A }],
  ["holdt_utenfor", { excluded_at: "2026-11-01" }], ["ikke_vare", { match_confidence: "not_applicable" }],
];
for (const [code, extra] of protections) {
  run = await setup([[A, 952], [P1, 48], [P2, 48, extra]], [cand("cA", 952), cand("cP", 48)]);
  const e = await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }]));
  expect(e?.includes(`beskyttet_linje_kan_ikke_fjernes: ${code}`), `${code} beskyttet (${e})`);
  expect((await one(`select count(*)::int n from invoice_lines`)).n === 3, `${code}: ingenting fjernet`);
}
for (const [code, table] of [["rettet", "invoice_line_corrections"], ["kost_fort", "invoice_line_cost_postings"], ["varemottak", "rm_goods_receipts"], ["lagerparti", "rm_stock_lots"], ["avvikssak", "supplier_deviation_case_lines"]]) {
  run = await setup([[A, 952], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
  await db.exec(`insert into ${table} (invoice_line_id) values ('${P2}');`);
  const e = await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }]));
  expect(e?.includes(`beskyttet_linje_kan_ikke_fjernes: ${code}`), `${code} beskyttet (${e})`);
  await db.exec(`delete from ${table};`);
}
await db.exec(`delete from stock_movements; delete from raw_material_suppliers;`);
run = await setup([[A, 952], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
await db.exec(`insert into stock_movements values ('invoice_lines', '${P2}');`);
expect((await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }])))?.includes("lagerbevegelse"), "lagerbevegelse beskyttet");
await db.exec(`delete from stock_movements;`);

// 4) Vanlig bruk: tillegg som gjør avviket større rulles tilbake (17.11-feilen kan ikke skje igjen).
run = await setup([[A, 952], [P1, 48]], [cand("cA", 952), cand("cP", 48), cand("cP2", 48)]);
expect((await err(apply(run, [{ kind: "add", candidate_id: "cP2", changes: cand("cP2", 48).values, confirmed_addition: true }])))?.includes("sumavvik_ville_oke"), "rest kan ikke øke summen");
expect((await sumNow()) === 1000, "summen står uendret");
// Tillegg som retter et avvik er fortsatt lov.
run = await setup([[A, 952]], [cand("cA", 952), cand("cP", 48)]);
const r4 = (await one(apply(run, [{ kind: "add", candidate_id: "cP", changes: cand("cP", 48).values, confirmed_addition: true }]))).r;
expect(r4.ok === true && r4.replace === false && (await sumNow()) === 1000, "tillegg som retter avvik godtas");

// 5) Erstatning med retting: feil beløp rettes, rest fjernes.
run = await setup([[A, 900], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
await one(apply(run, [{ kind: "update", candidate_id: "cA", line_id: A, changes: { total_amount: 952 }, confirmed_mapping: true, learn: false }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }]));
expect((await sumNow()) === 1000, "retting + fjerning gir ny lesings sum");

// 6) keep med annen sum, og erstatning der summen ikke blir ny lesing, avvises.
run = await setup([[A, 952], [P1, 40]], [cand("cA", 952), cand("cP", 48)]);
expect((await err(apply(run, [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }])))?.includes("beholdt_linje_har_annen_sum"), "keep krever lik sum");
expect((await err(apply(run, [{ kind: "remove", line_id: A, confirmed_removal: false }])))?.includes("fjerning_ma_bekreftes"), "fjerning må bekreftes");
expect((await err(apply(run, [{ kind: "remove", line_id: A, candidate_id: "cA", confirmed_removal: true }])))?.includes("ugyldige_valg"), "fjerning har ingen kandidat");

// 7) Replay gir samme svar; vanlig retting virker som før.
run = await setup([[A, 952], [P1, 48], [P2, 48]], [cand("cA", 952), cand("cP", 48)]);
const ops7 = [{ kind: "keep", candidate_id: "cA", line_id: A, confirmed_keep: true }, { kind: "keep", candidate_id: "cP", line_id: P1, confirmed_keep: true }, { kind: "remove", line_id: P2, confirmed_removal: true }];
await one(apply(run, ops7));
expect((await one(apply(run, ops7))).r.replayed === true, "replay");
run = await setup([[A, 900], [P1, 48]], [cand("cA", 952)]);
expect((await one(apply(run, [{ kind: "update", candidate_id: "cA", line_id: A, changes: { total_amount: 952 }, confirmed_mapping: true, learn: false }]))).r.replace === false, "vanlig retting som før");
expect((await sumNow()) === 1000, "retting gir 1000");

console.log(`OK – ${ok} kontroller`);
