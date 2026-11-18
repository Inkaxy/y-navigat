// 20261125_lesevarsel_stillstand i PGlite. Bruk: node scripts/test-lesevarsel-sql.mjs
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sql = readFileSync(join(root, "supabase/pending/1-kjor-na/07_lesevarsel_stillstand.sql"), "utf8");
const db = new PGlite();
let checks = 0;
const ok = (c, m) => { if (!c) throw new Error("FEIL: " + m); checks++; };
await db.exec(`
create role anon; create role authenticated; create role service_role;
create table invoices (id uuid primary key default gen_random_uuid(), line_extraction_status text, line_extraction_at timestamptz);
create table email_templates (template_key text primary key, is_active boolean);
create table email_outbox (id uuid primary key default gen_random_uuid(), template_key text, recipient_email text, related_entity_type text,
  variables jsonb default '{}', created_at timestamptz default now());`);
await db.exec(sql);
const run = async (dry = false) => (await db.query(`select public.rm_reading_stall_check($1) r`, [dry])).rows[0].r;
const outbox = async () => Number((await db.query(`select count(*) n from email_outbox`)).rows[0].n);

// Alt i orden: lest for 2 timer siden, ingen feil.
await db.exec(`insert into invoices (line_extraction_status, line_extraction_at) values ('done', now() - interval '2 hours'), ('pending', null)`);
ok((await run()).reason === "ok", "ok når siste lesing er fersk");
// Stillstand: siste lesing for 25 timer siden og noe i kø.
await db.exec(`update invoices set line_extraction_at = now() - interval '25 hours' where line_extraction_status = 'done'`);
ok((await run()).reason === "no_template", "uten mal sendes ingenting");
ok((await outbox()) === 0, "ingenting i køen uten mal");
await db.exec(`insert into email_templates values ('invoice_reading_stopped', true)`);
const dry = await run(true);
ok(dry.reason === "dry_run" && dry.kind === "stillstand", "tørrkjøring viser stillstand");
ok((await outbox()) === 0, "tørrkjøring skriver ikke");
ok((await run()).queued === true, "stillstand legges i køen");
ok((await outbox()) === 1, "én e-post");
const row = (await db.query(`select recipient_email, variables from email_outbox`)).rows[0];
ok(row.recipient_email === "henrik@nottero-bakeri.no" && row.variables.feiltype === "stillstand", "mottaker og feiltype satt av serveren");
ok((await run()).reason === "already_sent_today", "høyst én per døgn");
ok((await outbox()) === 1, "fortsatt én e-post");
// Ingen kø → ingen stillstand selv om lenge siden.
await db.exec(`delete from invoices where line_extraction_status = 'pending'`);
ok((await run()).reason === "ok", "tom kø er ikke stillstand");
// Feilrate: 3 av 10 feilet siste døgn.
await db.exec(`insert into invoices (line_extraction_status, line_extraction_at) select 'done', now() - interval '1 hour' from generate_series(1,7);
  insert into invoices (line_extraction_status, line_extraction_at) select 'failed', now() - interval '1 hour' from generate_series(1,3);`);
const fr = await run();
ok(fr.queued === true && fr.kind === "feilrate", "feilrate 30 % legges i køen");
await db.exec(`update invoices set line_extraction_status = 'done' where id = (select id from invoices where line_extraction_status = 'failed' limit 1)`);
await db.exec(`delete from email_outbox`);
ok((await run()).reason === "ok", "20 % er under grensen");
// Rettigheter.
const priv = (await db.query(`select has_function_privilege('authenticated', 'public.rm_reading_stall_check(boolean)', 'execute') a,
  has_function_privilege('service_role', 'public.rm_reading_stall_check(boolean)', 'execute') s`)).rows[0];
ok(priv.a === false && priv.s === true, "bare service_role kan kjøre");
console.log(`OK – ${checks} kontroller`);
