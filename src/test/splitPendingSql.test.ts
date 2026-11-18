import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
// @ts-expect-error – rent JS-verktøy uten typedeklarasjon
import { bodyOf, splitSql } from "../../scripts/splitPendingSql.mjs";
import { STUB } from "./fixtures/slaaSammenStub";

type Out = { files: { name: string; sql: string }[]; parts: string[]; body: string; fnBodies: { name: string; md5: string }[] };
const FILE = "20261120_slaa_sammen_varer";
const SRC = path.join(process.cwd(), `supabase/pending/${FILE}.PENDING.sql`);
const original = readFileSync(SRC, "utf8");
const split = (): Out => splitSql(original, FILE) as Out;
const pend = (o: Out) => o.files.filter((f) => f.name.endsWith(".PENDING.sql"));

describe("store SQL-filer deles i delfiler (punkt 7)", () => {
  it("hver delfil er høyst 15 kB og delene på disk er identiske med verktøyets utdata", () => {
    const o = split();
    expect(o.files.length).toBeGreaterThanOrEqual(4);
    for (const f of o.files) {
      expect(Buffer.byteLength(f.sql, "utf8"), f.name).toBeLessThanOrEqual(15 * 1024);
      expect(readFileSync(path.join(process.cwd(), `supabase/pending/${FILE}`, f.name), "utf8"), f.name).toBe(f.sql);
    }
  });
  it("delene satt sammen er ordrett originalfilen uten egen begin/commit", () => {
    const o = split();
    expect(o.parts.join("")).toBe(o.body);
    expect(o.body).toBe(bodyOf(original));
    expect(original.length - o.body.length).toBe("begin;\n".length + "commit;\n".length);
  });

  it("delene kjørt i rekkefølge gir samme funksjoner som originalfilen; feil del og feil rekkefølge stoppes", async () => {
    const o = split();
    const run = pend(o);
    // Testmiljøet har ikke live-definisjonen av merge_raw_materials; md5-vakten i filen omgås her ved at
    // pg_get_functiondef/md5 slås opp i public først (bare i testen). Vakten selv er uendret i filen.
    const fake = `set search_path = public, pg_catalog;
      create function public.pg_get_functiondef(regprocedure) returns text language sql as $$ select 'LIVE-17.11'::text $$;
      create function public.md5(text) returns text language sql immutable as $$ select case when $1 = 'LIVE-17.11' then '3c2ed3ccedddc6c117e3ca2899f916e4' else pg_catalog.md5($1) end $$;`;

    const a = new PGlite(); await a.exec(STUB); await a.exec(fake);
    await expect(a.exec(run[1].sql)).rejects.toThrow(/Kjør del 01 først/);
    await a.exec(run[0].sql);
    const tampered = run[1].sql.replace("raw_materials", "raw_materialz");
    await expect(a.exec(tampered)).rejects.toThrow(/ikke skrevet inn riktig/);
    for (const f of run.slice(1, -1)) await a.exec(f.sql);
    await a.exec(run[run.length - 1].sql);
    expect((await a.query<{ t: string | null }>("select to_regclass('public._rm_sql_stage')::text t")).rows[0].t).toBeNull();

    const b = new PGlite(); await b.exec(STUB); await b.exec(fake); await b.exec(original);
    const fns = async (db: PGlite) => (await db.query<{ n: string; m: string }>(
      `select p.proname n, pg_catalog.md5(p.prosrc) m from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' and (p.proname like '%merge%' or p.proname like 'rm_cap_slaa%') order by 1, 2`)).rows;
    expect(await fns(a)).toEqual(await fns(b));
    // Kontrollfilens forventede md5 (lest fra filteksten) stemmer med databasen.
    const live = new Map((await fns(a)).map((r) => [`public.${r.n}`, r.m]));
    for (const f of o.fnBodies) expect(live.get(f.name), f.name).toBe(f.md5);
    await a.close(); await b.close();
  }, 60_000);

  it("feiler kjøringen, rulles alt tilbake og mellomlagringen står igjen", async () => {
    const o = splitSql("-- test\nbegin;\ncreate table public.t1 (i int);\nselect 1/0;\ncommit;\n", "synt", 20) as Out;
    const db = new PGlite();
    await db.exec("create role anon; create role authenticated;");
    for (const f of pend(o).slice(0, -1)) await db.exec(f.sql);
    await expect(db.exec(pend(o).at(-1)!.sql)).rejects.toThrow();
    await db.exec("rollback"); // som når SQL-editoren avbryter forespørselen
    const r = (await db.query<{ t: string | null; s: string | null }>("select to_regclass('public.t1')::text t, to_regclass('public._rm_sql_stage')::text s")).rows[0];
    expect(r.t).toBeNull();
    expect(r.s).toBe("_rm_sql_stage");
    await db.close();
  });
});
