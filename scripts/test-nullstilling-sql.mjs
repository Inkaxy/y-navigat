// «Nullstill køen» (bestilling 18.11.2026): kjører supabase/pending/1-kjor-na/01_nullstill_koen.sql i PGlite mot byte-identiske
// kopier av live-funksjonene den bygger på (scripts/fixtures/live-20261118b: rm_set_invoice_exclusion, prisobservasjonstriggeren,
// rm_set_fra_faktura_settings …), med stubber for resten. Rører aldri live.
// Kontrollerer: egen kategori «nullstilling» (bare linje), at regel 6 (hold utenfor) IKKE gir prisobservasjon eller kostendring,
// kjøringens tilstand (start, bolker, krav-token, ingen linje to ganger, uavklart → kontroll, pause/stopp, fase 2, avslutning
// med grense 1 % bare uten feil, ingen endring av «uten spørsmål»-bryteren), revisjonslogg med «Nullstilling 18.11.2026 – regel N».
// Bruk: node scripts/test-nullstilling-sql.mjs   (SQL_EOL=crlf simulerer innliming med Windows-linjeskift)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { readSql, printFingerprint } from "./lib/pastedSql.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fx = (f) => readFileSync(join(root, "scripts/fixtures/live-20261118b", f), "utf8");
const pending = readSql(join(root, "supabase/pending/1-kjor-na/01_nullstill_koen.sql"));
const check = readSql(join(root, "supabase/pending/kontroll/20261124_nullstill_koen.check.sql"));

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
create function public.rm_invoice_has_read_issues(uuid) returns boolean language sql stable as $$ select false $$;
create function public._rm_queue_line_read_issue(uuid, boolean) returns text language sql stable as $$ select null::text $$;
create function public.refresh_purchase_stats() returns void language sql as $$ select $$;
create table cost_calls (raw_material_id uuid, at timestamptz default clock_timestamp());
create function public.rm_apply_derived_cost_price(p uuid) returns numeric language plpgsql as $$
begin insert into cost_calls values (p); return (select current_cost_price from raw_materials where id = p); end $$;
create table rematch_calls (invoice_ids uuid[]);
create function public.rm_rematch_invoices(p_le uuid, p_limit integer, p_ids uuid[], p_only_open boolean) returns jsonb language plpgsql as $$
begin insert into rematch_calls values (p_ids); return jsonb_build_object('ok', true, 'queued', cardinality(p_ids)); end $$;
-- Signaturene filen krever (selve handlingene kjøres av appen og testes i vitest).
create function public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[]) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.rm_supplier_item_accept_price(uuid,uuid,text,jsonb,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.rm_undo_supplier_item_link(uuid,uuid,text,uuid[],uuid,boolean,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.rm_undo_not_item(uuid,uuid,text,uuid[],boolean,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.rm_undo_price_acceptance(uuid,uuid[],text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.rm_reopen_invoice_exclusion(uuid,text,uuid,text,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
create table audit_log (id uuid primary key default gen_random_uuid(), occurred_at timestamptz default clock_timestamp(), user_id uuid, action text,
  entity_type text, entity_id uuid, entity_display_reference text, legal_entity_id uuid, changes jsonb, reason text, source_app text);
create table invoice_match_settings (legal_entity_id uuid primary key, default_price_tolerance_pct numeric, price_jump_pct numeric,
  fra_faktura_quiet_prices boolean, fra_faktura_invoice_package boolean, updated_at timestamptz, updated_by uuid);
create table suppliers (id uuid primary key, legal_entity_id uuid, name text, new_item_type text);
create table raw_materials (id uuid primary key, legal_entity_id uuid, name text, base_unit text, current_cost_price numeric, is_active boolean default true);
create table raw_material_suppliers (id uuid primary key default gen_random_uuid(), raw_material_id uuid, supplier_id uuid, supplier_sku text, base_units_per_package numeric);
create table raw_material_supplier_aliases (id serial, raw_material_supplier_id uuid, alias_type alias_type, alias_value text, status alias_status);
create table invoices (id uuid primary key, legal_entity_id uuid, supplier_id uuid, invoice_number text, invoice_date date, status text default 'needs_review', extraction_issues jsonb default '[]',
  flagged_at timestamptz, reconciled_at timestamptz, is_credit_note boolean default false, currency text default 'NOK', lines_sum_status text,
  excluded_at timestamptz, excluded_by uuid, exclusion_category text, exclusion_reason text, exclusion_prev jsonb, updated_at timestamptz default now());
create function public.rm_invoice_lines_trusted(invoices) returns boolean language sql stable as $$ select true $$;
create table invoice_lines (id uuid primary key, invoice_id uuid, line_number int, supplier_sku text, description text, quantity numeric, unit text,
  unit_price numeric, total_amount numeric, discount_amount numeric, unit_price_basis text, line_kind text, extraction_issues jsonb default '[]',
  package_size numeric, package_unit text, count_per_package numeric, base_quantity numeric, package_source_rms_id uuid,
  raw_material_id uuid, match_confidence text, requires_review boolean, review_reason text,
  price_per_base_unit numeric, expected_price_per_base_unit numeric, price_variance_pct numeric, variance_status text,
  excluded_at timestamptz, excluded_by uuid, exclusion_category text, exclusion_reason text, excluded_raw_material_id uuid, exclusion_prev jsonb,
  updated_at timestamptz default now(),
  constraint invoice_lines_exclusion_category_check check (exclusion_category is null or exclusion_category = any (array['erstatning_produksjonstap'::text, 'annet'::text])));
create table invoice_internal_approvals (invoice_id uuid, status text, revoked_at timestamptz);
create table invoice_line_cost_postings (invoice_line_id uuid, revoked_at timestamptz);
create table invoice_line_corrections (id uuid primary key default gen_random_uuid(), invoice_line_id uuid, corrected_at timestamptz);
create table stock_movements (source_table text, source_id uuid);
create table rm_goods_receipts (invoice_line_id uuid);
create table rm_stock_lots (invoice_line_id uuid);
create table raw_material_price_history (id uuid primary key default gen_random_uuid(), raw_material_id uuid, supplier_id uuid, price numeric, source text,
  invoice_id uuid, invoice_line_id uuid, invoice_line_ref uuid, effective_date date, source_reference text, currency text, is_credit boolean,
  created_by uuid, snapshot_unit text, snapshot_package jsonb, snapshot_at timestamptz, superseded_at timestamptz, superseded_reason text, is_legacy boolean);
create unique index rmph_line on raw_material_price_history (invoice_line_id) where invoice_line_id is not null and superseded_at is null;
`;

const LE = "00000000-0000-0000-0000-0000000000a1";
const U = "00000000-0000-0000-0000-0000000000e1";
const SA = "00000000-0000-0000-0000-0000000000c1";
const RM = "00000000-0000-0000-0000-0000000000b1";
const INV1 = "00000000-0000-0000-0000-0000000000f1", INV2 = "00000000-0000-0000-0000-0000000000f2", INV3 = "00000000-0000-0000-0000-0000000000f3";
const L = (n) => `00000000-0000-0000-0000-0000000001${String(n).padStart(2, "0")}`;

let ok = 0;
const fail = (m) => { console.error("FEIL:", m); process.exit(1); };
const check1 = (cond, m) => { if (!cond) fail(m); ok++; };
const db = new PGlite();
const step = async (name, fn) => { try { return await fn(); } catch (e) { fail(`${name}: ${e.message}`); } };
const one = async (sql) => (await db.query(sql)).rows[0];
const rejects = async (sql, re) => { try { await db.query(sql); return false; } catch (e) { return re ? re.test(e.message) : true; } };
const j = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

await step("stubb", () => db.exec(stub));
for (const f of ["_rm_line_exclusion_blocker.sql", "fn_rm_price_history_upsert_line.sql", "fn_invoice_line_match_price_history.sql",
  "rm_set_invoice_exclusion.sql", "rm_fra_faktura_settings.sql", "rm_set_fra_faktura_settings.sql"]) await step(f, () => db.exec(fx(f)));
await step("trigger", () => db.exec(`create trigger trg_invoice_line_match_price_history after insert or update on invoice_lines
  for each row execute function fn_invoice_line_match_price_history();`));

await step("data", () => db.exec(`
  select set_config('test.uid', '${U}', false);
  insert into suppliers values ('${SA}', '${LE}', 'ASKO', null);
  insert into raw_materials values ('${RM}', '${LE}', 'Hvetemel', 'kg', 10, true);
  insert into invoice_match_settings (legal_entity_id, price_jump_pct, fra_faktura_quiet_prices) values ('${LE}', null, false);
  insert into invoices (id, legal_entity_id, supplier_id, invoice_number, invoice_date) values
    ('${INV1}', '${LE}', '${SA}', '1001', '2026-11-01'), ('${INV2}', '${LE}', '${SA}', '1002', '2026-11-02'), ('${INV3}', '${LE}', '${SA}', '1003', '2026-11-03');
  insert into invoice_lines (id, invoice_id, line_number, supplier_sku, description, quantity, unit, total_amount, raw_material_id, match_confidence,
    requires_review, review_reason, price_per_base_unit, expected_price_per_base_unit, price_variance_pct, line_kind) values
    ('${L(1)}', '${INV1}', 1, 'P1', 'Pant flaske', 1, 'stk', 2, null, 'unmatched', true, 'unmatched', null, null, null, 'pant'),
    ('${L(2)}', '${INV1}', 2, '9727', 'Hvetemel 25 kg', 2, 'sekk', 500, '${RM}', 'auto_high', true, 'unknown_package_size', null, null, null, 'vare'),
    ('${L(3)}', '${INV2}', 1, '5555', 'Rugmel 10 kg', 1, 'sekk', 120, null, 'unmatched', true, 'unmatched', null, null, null, 'vare'),
    ('${L(4)}', '${INV2}', 2, '9727', 'Hvetemel 25 kg', 1, 'sekk', 400, '${RM}', 'manual', true, 'price_variance', 16, 10, 60, 'vare'),
    ('${L(5)}', '${INV3}', 1, '7777', 'Gjær', 1, 'kg', 30, null, 'unmatched', true, 'extraction_unresolved', null, null, null, 'vare'),
    ('${L(6)}', '${INV3}', 2, '9727', 'Hvetemel 25 kg', 1, 'sekk', 260, '${RM}', 'manual', false, null, 10.4, 10, 4, 'vare');
`));
// Motprøve: prisobservasjonstriggeren virker i testen (L6 er koblet, ikke til kontroll, faktura «ready»).
await db.exec(`update invoices set status = 'ready' where id = '${INV3}'; update invoice_lines set price_per_base_unit = 10.4 where id = '${L(6)}'`);
check1((await one(`select count(*)::int n from raw_material_price_history where invoice_line_id = '${L(6)}' and superseded_at is null`)).n === 1, "motprøve: avsluttet koblet linje gir prisobservasjon");
await db.exec(`update invoices set status = 'needs_review' where id = '${INV3}'`);

// --- Kjør filen ---
await step("01_nullstill_koen.sql", () => db.exec(pending));
check1((await one(`select public.rm_cap_nullstill_koen_v1() v`)).v === true, "markør finnes");
let again = "";
try { await db.exec(pending); } catch (e) { again = e.message; await db.exec("rollback"); }
check1(/allerede kjørt/.test(again), `filen kan ikke kjøres to ganger (${again})`);
const kontroll = (await db.query(check.split("-- ETTER")[1])).rows;
check1(kontroll.length > 0 && kontroll.every((r) => r.ok === true), `kontrollfil ETTER: ${JSON.stringify(kontroll.filter((r) => !r.ok))}`);

// --- Forhåndsvisningen: alle lesevarsler på linjen og kodene på fakturaen, ikke prissikkerhetsstatusen ---
await db.exec(`update invoice_lines set extraction_issues = '[{"code":"regnestykke","message":"a"},{"code":"ugyldig_tall","message":"b"}]' where id = '${L(2)}';
  update invoices set extraction_issues = '[{"code":"reread_sum_mismatch","message":"x"},{"code":"reread_warning","message":"y"}]' where id = '${INV1}'`);
const sn = (await one(`select rm_queue_reset_snapshot_lines('${LE}') r`)).r;
const sl2 = sn.rows.find((r) => r.line_id === L(2)), sl3 = sn.rows.find((r) => r.line_id === L(3));
check1(sn.ok === true && sl2 && !("read_issue" in sl2), "forhåndsvisningen bruker ikke prissikkerhetsstatusen");
check1(JSON.stringify(sl2.extraction_issues.map((e) => e.code)) === '["regnestykke","ugyldig_tall"]', `alle lesevarsler på linjen (${JSON.stringify(sl2.extraction_issues)})`);
check1(JSON.stringify([...sl2.invoice_read_codes].sort()) === '["reread_sum_mismatch","reread_warning"]' && JSON.stringify(sl3.invoice_read_codes) === "[]", "kodene for lesevarsler på fakturaen");
await db.exec(`update invoice_lines set extraction_issues = '[]' where id = '${L(2)}'; update invoices set extraction_issues = '[]' where id = '${INV1}'`);

// --- Regel 6: hold utenfor med egen kategori, ingen prisobservasjon, ingen kostendring ---
const costBefore = (await one(`select current_cost_price c from raw_materials where id = '${RM}'`)).c;
const v4 = (await one(`select updated_at::text u from invoice_lines where id = '${L(4)}'`)).u;
const op4 = "00000000-0000-0000-0000-00000000aa04";
const ex = (await one(`select rm_set_invoice_exclusion('${INV2}', 'line', '${L(4)}', 'nullstilling', 'Avsluttet ved nullstilling 18.11.2026 – regel 6: prishopp over 20 %', '${v4}', '${op4}') r`)).r;
check1(ex.ok === true, `regel 6: linjen holdes utenfor (${JSON.stringify(ex)})`);
const l4 = await one(`select excluded_at, exclusion_category, raw_material_id, excluded_raw_material_id, requires_review from invoice_lines where id = '${L(4)}'`);
check1(l4.excluded_at && l4.exclusion_category === "nullstilling" && l4.raw_material_id === null && l4.excluded_raw_material_id === RM && l4.requires_review === false, "regel 6: kategori nullstilling, kobling tatt vare på");
check1((await one(`select count(*)::int n from raw_material_price_history where invoice_line_id = '${L(4)}'`)).n === 0, "regel 6: ingen prisobservasjon");
check1(Number((await one(`select current_cost_price c from raw_materials where id = '${RM}'`)).c) === Number(costBefore), "regel 6: kostprisen er uendret");
check1((await one(`select rm_set_invoice_exclusion('${INV2}', 'line', '${L(4)}', 'nullstilling', 'Avsluttet ved nullstilling 18.11.2026 – regel 6', null, '${op4}') r`)).r.already === true, "regel 6: samme op-id = allerede gjort");
check1((await one(`select rm_set_invoice_exclusion('${INV1}', 'invoice', null, 'nullstilling', 'Avsluttet ved nullstilling 18.11.2026', null, gen_random_uuid()) r`)).r.error === "ugyldig_arsak", "kategori nullstilling avvises for hele fakturaer");
check1((await one(`select rm_set_invoice_exclusion('${INV1}', 'line', '${L(1)}', 'tull', 'Begrunnelse her', null, gen_random_uuid()) r`)).r.error === "ugyldig_arsak", "ukjent kategori avvises fortsatt");
check1((await one(`select count(*)::int n from audit_log where action = 'invoice_line.excluded' and reason like 'Avsluttet ved nullstilling 18.11.2026%'`)).n === 1, "hold utenfor står i revisjonsloggen med begrunnelsen");
// tilbake til åpen for resten av testen
await db.exec(`select set_config('rm.exclusion_write', 'on', false);
  update invoice_lines set excluded_at = null, excluded_by = null, exclusion_category = null, exclusion_reason = null, exclusion_prev = null,
    excluded_raw_material_id = null, raw_material_id = '${RM}', requires_review = true, review_reason = 'price_variance' where id = '${L(4)}';
  select set_config('rm.exclusion_write', '', false);`);

// --- Start ---
const snap = `array['${L(1)}','${L(2)}','${L(3)}','${L(4)}','${L(5)}']::uuid[]`;
const items1 = [
  { rule: 1, action: "ikke_vare", supplier_id: SA, item_key: "sku:p1", line_ids: [L(1)], payload: { title: "Pant flaske" } },
  { rule: 3, action: "bekreft_pakning", supplier_id: SA, item_key: "sku:9727", raw_material_id: RM, line_ids: [L(2)], payload: { cost_before: 10, title: "Hvetemel" } },
  { rule: 4, action: "opprett", supplier_id: SA, item_key: "sku:5555", line_ids: [L(3)], payload: { new_raw_material: { name: "Rugmel", base_unit: "kg" }, title: "Rugmel", lesegrunnlag: { [L(3)]: { f: 1, pakning: "varenavn" } } } },
];
const start = (items, snapshot = snap) => `select rm_queue_reset_start('${LE}', 'fp1', '{"n":5}'::jsonb, ${snapshot}, ${j(items)}) r`;
await db.exec(`select set_config('test.approve', 'nei', false)`);
check1(await rejects(start(items1), /krever_godkjenner/), "start krever godkjenner/admin");
await db.exec(`select set_config('test.approve', '', false)`);
check1(await rejects(start([{ ...items1[0], action: "godta_pris" }]), /ugyldig_regel/), "regel og handling må høre sammen");
check1(await rejects(start([{ ...items1[0], rule: 6, action: "hold_utenfor" }]), /regel_ikke_i_fasen/), "regel 6 kjøres ikke i fase 1");
check1(await rejects(start([{ ...items1[0], line_ids: [L(6)] }]), /linje_utenfor_utvalget/), "linje utenfor forhåndsvisningen avvises");
check1(await rejects(start([items1[0], { ...items1[0] }]), /duplicate key|unique/i), "samme linje i to steg avvises (ingen linje to ganger)");
check1(await rejects(start([{ ...items1[0], item_key: "sku:feil" }]), /linje_feil_leverandorvare/), "linjen må høre til leverandørvaren");
check1(await rejects(start([{ ...items1[1], line_ids: [L(3)], item_key: "sku:5555" }]), /linje_ikke_koblet_til_varen/), "regel 3 bare for linjer koblet til varen");
check1(await rejects(start([{ ...items1[2], payload: {} }]), /ny_vare_mangler_navn/), "ny vare må ha navn");
check1(await rejects(start([{ ...items1[2], payload: { ...items1[2].payload, lesegrunnlag: "1" } }]), /ugyldig_lesegrunnlag/), "lesegrunnlag må være et objekt");
const closed = await one(start(items1, `array['${L(1)}','${L(6)}']::uuid[]`));
check1(closed.r.ok === false && closed.r.error === "koen_endret" && closed.r.changed === 1, "lukket linje i utvalget: be om ny forhåndsvisning");
const s1 = (await one(start(items1))).r;
check1(s1.ok === true && s1.steps === 3, `kjøring startet (${JSON.stringify(s1)})`);
const RUN = s1.run_id;
check1((await one(start(items1))).r.error === "kjoring_pagar", "bare én aktiv kjøring per selskap");
check1((await one(`select count(*)::int n from audit_log where action = 'queue_reset.started' and reason = 'Nullstilling 18.11.2026'`)).n === 1, "start i revisjonsloggen");

// --- Bolker ---
const c1 = (await one(`select rm_queue_reset_claim('${RUN}', 2) r`)).r;
check1(c1.items.length === 2 && c1.items[0].rule === 1 && c1.items[1].rule === 3, "bolk: to første steg i rekkefølge");
const [i1, i3] = c1.items;
check1((await one(`select rm_queue_reset_finish('${i1.id}', gen_random_uuid(), 'ferdig', '{}'::jsonb, null) r`)).r.error === "ikke_din_tur", "feil krav-token avvises");
check1((await one(`select rm_queue_reset_finish('${i1.id}', '${i1.claim_token}', 'ferdig', '{"lines_updated":1}'::jsonb, null) r`)).r.ok === true, "steg 1 ferdig");
check1((await one(`select rm_queue_reset_finish('${i1.id}', '${i1.claim_token}', 'ferdig', '{}'::jsonb, null) r`)).r.error === "ikke_din_tur", "et ferdig steg kan ikke fullføres to ganger");
check1((await one(`select count(*)::int n from audit_log where action = 'queue_reset.step' and reason = 'Nullstilling 18.11.2026 – regel 1' and changes->>'run_id' = '${RUN}'`)).n === 1, "steg i revisjonsloggen med kjørings-id og «regel 1»");
// i3 står «pågår» (omlasting): blir uavklart og holder tilbake andre steg for samme leverandørvare
check1((await one(`select rm_queue_reset_recover('${RUN}', 0) r`)).r.uavklart === 1, "omlasting: pågående steg blir uavklart");
check1((await one(`select status from rm_queue_reset_items where id = '${i3.id}'`)).status === "uavklart", "uavklart lagret");
// kontroll uten bevis → venter (trygt å sende på nytt)
check1((await one(`select rm_queue_reset_check('${i3.id}') r`)).r.status === "venter", "kontroll uten spor i revisjonsloggen → venter");
const c2 = (await one(`select rm_queue_reset_claim('${RUN}', 5) r`)).r;
check1(c2.items.length === 2 && c2.items[0].id === i3.id, "steget kjøres igjen (samme linjeutvalg)");
// spor i revisjonsloggen (som rm_link_supplier_item skriver med begrunnelsen) → ferdig ved kontroll
await db.exec(`insert into audit_log (action, legal_entity_id, reason, changes) values ('supplier_item.linked', '${LE}', 'Nullstilling 18.11.2026 – regel 3 · steg ${i3.id}', '{}'::jsonb)`);
await db.query(`select rm_queue_reset_recover('${RUN}', 0)`);
check1((await one(`select rm_queue_reset_check('${i3.id}') r`)).r.status === "ferdig", "kontroll med spor → ferdig (bekreftet ved kontroll)");
const i4 = c2.items[1];
check1((await one(`select rm_queue_reset_check('${i4.id}') r`)).r.status === "venter", "steg 4 var uavklart → venter");
// opprett: spor med ny vare gir vare-id
const NEW = "00000000-0000-0000-0000-0000000000b9";
await db.exec(`insert into raw_materials values ('${NEW}', '${LE}', 'Rugmel', 'kg', 12, true);
  insert into audit_log (action, legal_entity_id, reason, changes) values ('supplier_item.linked', '${LE}', 'Nullstilling 18.11.2026 – regel 4 · steg ${i4.id}', '{"created_raw_material":true,"raw_material_id":"${NEW}"}'::jsonb)`);
const c3 = (await one(`select rm_queue_reset_claim('${RUN}', 5) r`)).r;
check1(c3.items.length === 1 && c3.items[0].id === i4.id, "steg 4 hentes igjen");
check1((await one(`select rm_queue_reset_finish('${i4.id}', '${c3.items[0].claim_token}', 'ferdig', '{"raw_material_id":"${NEW}","created":true}'::jsonb, null) r`)).r.ok, "steg 4 ferdig");
const st4 = await one(`select changes from audit_log where action = 'queue_reset.step' and entity_id = '${i4.id}' order by occurred_at desc limit 1`);
check1(st4?.changes?.lesegrunnlag?.[L(3)]?.f === 1 && st4.changes.lesegrunnlag[L(3)].pakning === "varenavn", `revisjonsloggen har forklaringen som ble brukt (${JSON.stringify(st4?.changes)})`);
check1((await one(`select created_raw_material_id c from rm_queue_reset_items where id = '${i4.id}'`)).c === NEW, "ny vare registrert på steget");

// --- Pause/fortsett ---
check1((await one(`select rm_queue_reset_set_status('${RUN}', 'pause') r`)).r.status === "pause", "pause");
check1((await one(`select rm_queue_reset_claim('${RUN}', 5) r`)).r.items.length === 0, "ingen steg hentes under pause");
check1((await one(`select rm_queue_reset_set_status('${RUN}', 'fortsett') r`)).r.status === "aktiv", "fortsett");

// --- Fase 2 ---
check1(await rejects(`select rm_queue_reset_add_phase2('${RUN}', ${j([{ rule: 1, action: "ikke_vare", supplier_id: SA, item_key: "sku:p1", line_ids: [L(1)] }])})`, /regel_ikke_i_fasen/), "fase 2 tar bare regel 2 og 6");
const items2 = [
  { rule: 6, action: "hold_utenfor", line_ids: [L(5)], reason_code: "lesevarsel", payload: { invoice_id: INV3 } },
  { rule: 2, action: "godta_pris", supplier_id: SA, item_key: "sku:9727", raw_material_id: RM, line_ids: [L(4)], payload: { cost_before: 10 } },
];
const p2 = (await one(`select rm_queue_reset_add_phase2('${RUN}', ${j(items2)}) r`)).r;
check1(p2.ok === true && p2.steps === 2, `fase 2 lagt til (${JSON.stringify(p2)})`);
check1((await one(`select phase from rm_queue_reset_runs where id = '${RUN}'`)).phase === 2, "kjøringen er i fase 2");
check1((await one(`select rm_queue_reset_complete('${RUN}') r`)).r.error === "steg_gjenstar", "kan ikke avslutte med steg igjen");
const c4 = (await one(`select rm_queue_reset_claim('${RUN}', 5) r`)).r;
check1(c4.items.length === 2 && c4.items[0].rule === 6, "fase 2: regel 6 først");
// regel 6 via appen: rm_set_invoice_exclusion med stegets op-id; kontrollen finner den på op-id
const v5 = (await one(`select updated_at::text u from invoice_lines where id = '${L(5)}'`)).u;
await db.query(`select rm_set_invoice_exclusion('${INV3}', 'line', '${L(5)}', 'nullstilling', 'Avsluttet ved nullstilling 18.11.2026 – regel 6 · steg ${c4.items[0].id}', '${v5}', '${c4.items[0].op_id}')`);
await db.query(`select rm_queue_reset_recover('${RUN}', 0)`);
check1((await one(`select rm_queue_reset_check('${c4.items[0].id}') r`)).r.status === "ferdig", "regel 6: kontroll på op-id → ferdig");
check1((await one(`select count(*)::int n from raw_material_price_history where invoice_line_id = '${L(5)}'`)).n === 0, "regel 6 i kjøringen: ingen prisobservasjon");
await db.query(`select rm_queue_reset_check('${c4.items[1].id}')`);
const c5 = (await one(`select rm_queue_reset_claim('${RUN}', 5) r`)).r;
check1((await one(`select rm_queue_reset_finish('${c5.items[0].id}', '${c5.items[0].claim_token}', 'feilet', null, 'Linjen har andre åpne årsaker enn pris') r`)).r.ok, "regel 2 feilet");

// Handlingene i appen (simulert): «ikke vare» og pakningsbekreftelse lukker linjene på faktura 1001.
await db.exec(`update invoice_lines set requires_review = false, review_reason = null, match_confidence = 'not_applicable' where id = '${L(1)}';
  update invoice_lines set requires_review = false, review_reason = null where id = '${L(2)}'`);
// --- Avslutning med feil: grensen settes IKKE ---
const done1 = (await one(`select rm_queue_reset_complete('${RUN}') r`)).r;
check1(done1.ok === true && done1.failed === 1 && done1.price_jump_set === false, `avsluttet med én feil (${JSON.stringify(done1)})`);
check1((await one(`select price_jump_pct p from invoice_match_settings where legal_entity_id = '${LE}'`)).p === null, "grensen er uendret når noe feilet");
check1((await one(`select rm_queue_reset_status('${LE}') r`)).r.failed.length === 1, "feilet steg vises i kvitteringen");
const st = (await one(`select rm_queue_reset_status('${LE}') r`)).r;
check1(st.run.status === "ferdig" && st.created_items === 1 && st.cost_changes.some((c) => c.raw_material_id === NEW && c.created === true), "kvittering: én ny vare med kostpris");
check1(Array.isArray(st.counts) && st.counts.some((c) => c.rule === 6 && c.status === "ferdig" && c.reason_code === "lesevarsel"), "kvittering: tall per regel og årsak");
const rm1 = (await one(`select invoice_ids from rematch_calls limit 1`));
check1(rm1 && rm1.invoice_ids.includes(INV1) && !rm1.invoice_ids.includes(INV2), "omregning bare for fakturaer uten åpne linjer");
check1((await one(`select rm_queue_reset_set_limit('${RUN}') r`)).r.ok === true, "«Sett grensen til 1 % nå»");
const ims = await one(`select price_jump_pct p, fra_faktura_quiet_prices q from invoice_match_settings where legal_entity_id = '${LE}'`);
check1(Number(ims.p) === 1 && ims.q === false, "grensen er 1 %, «uten spørsmål» er fortsatt av");
check1((await one(`select rm_queue_reset_set_limit('${RUN}') r`)).r.already === true, "grensen settes bare én gang");

// --- Angre-registrering ---
check1((await one(`select rm_queue_reset_undo_mark('${i1.id}', 'angret', '{"undone":1}'::jsonb) r`)).r.ok, "angre registrert");
check1((await one(`select count(*)::int n from audit_log where action = 'queue_reset.undo' and reason = 'Angret nullstilling 18.11.2026 – regel 1'`)).n === 1, "angre i revisjonsloggen");
check1((await one(`select rm_queue_reset_undo_mark('${c5.items[0].id}', 'angret', null) r`)).r.error === "ikke_utfort", "feilet steg kan ikke «angres»");

// --- Ny kjøring uten feil: grensen settes automatisk; stopp hopper over resten ---
await db.exec(`update invoice_match_settings set price_jump_pct = null where legal_entity_id = '${LE}';
  update invoice_lines set requires_review = true, excluded_at = null where id in ('${L(1)}', '${L(2)}')`);
const s2 = (await one(start([items1[0], items1[1]], `array['${L(1)}','${L(2)}']::uuid[]`))).r;
check1(s2.ok === true, "ny kjøring kan startes når forrige er ferdig");
const k = (await one(`select rm_queue_reset_claim('${s2.run_id}', 5) r`)).r;
for (const it of k.items) await db.query(`select rm_queue_reset_finish('${it.id}', '${it.claim_token}', 'ferdig', '{}'::jsonb, null)`);
check1((await one(`select rm_queue_reset_add_phase2('${s2.run_id}', '[]'::jsonb) r`)).r.ok, "tom fase 2 (ingenting igjen)");
const done2 = (await one(`select rm_queue_reset_complete('${s2.run_id}') r`)).r;
check1(done2.price_jump_set === true && Number((await one(`select price_jump_pct p from invoice_match_settings where legal_entity_id = '${LE}'`)).p) === 1, "uten feil: grensen settes til 1 %");
check1((await one(`select fra_faktura_quiet_prices q from invoice_match_settings where legal_entity_id = '${LE}'`)).q === false, "«uten spørsmål» slås aldri på automatisk");
const s3 = (await one(start([items1[0]], `array['${L(1)}']::uuid[]`))).r;
check1((await one(`select rm_queue_reset_set_status('${s3.run_id}', 'stopp') r`)).r.skipped === 1, "stopp: gjenstående steg hoppes over");
check1((await one(`select rm_queue_reset_claim('${s3.run_id}', 5) r`)).r.items.length === 0, "stoppet kjøring gir ingen steg");

// --- Rettigheter på tabellene ---
check1((await one(`select has_table_privilege('anon', 'public.rm_queue_reset_items', 'select') a`)).a === false, "anon kan ikke lese kjøringen");
check1((await one(`select has_table_privilege('authenticated', 'public.rm_queue_reset_items', 'insert') a`)).a === false, "ingen direkte skriving fra klient");
check1((await one(`select has_function_privilege('authenticated', 'public._rm_qr_insert_items(uuid,uuid,smallint,jsonb)', 'execute') a`)).a === false, "hjelper ikke kallbar fra klient");

console.log(`OK: ${ok} kontroller (nullstill køen)`);
await printFingerprint(db);
