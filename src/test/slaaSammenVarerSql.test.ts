import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { STUB } from "./fixtures/slaaSammenStub";

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
