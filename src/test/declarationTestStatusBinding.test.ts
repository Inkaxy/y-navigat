import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regresjon: «Test bestått» må aldri godkjenne et oppsett testen ikke ble kjørt mot.
 *
 * Kjører de faktiske funksjonsdefinisjonene fra migrasjonen mot en ekte
 * PostgreSQL (PGlite), med det virkelige unike indekset på aktiv nøkkel.
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260913064854_cc02043c-60fc-46bc-baee-d73a2e4c1bc5.sql",
);

const SCHEMA = `
create table public.ai_provider_config(
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  encrypted_api_key text not null,
  model text not null,
  max_tokens int,
  temperature numeric,
  purpose text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());

create unique index ai_provider_config_active_purpose_idx
  on public.ai_provider_config(purpose) where is_active = true;

create table public.platform_settings(
  id uuid primary key default gen_random_uuid(),
  category text not null,
  key text not null,
  value jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  unique (category, key));
`;

let db: PGlite;

async function settings(): Promise<Record<string, unknown>> {
  const res = await db.query<{ value: Record<string, unknown> }>(
    "select value from public.platform_settings where category='varer_ai' and key='declaration_assistant'",
  );
  return res.rows[0]?.value ?? {};
}

async function save(model: string, key: string | null) {
  await db.query("select public.ai_declaration_config_save($1,$2,$3,$4,$5)", [
    model,
    25,
    "",
    null,
    key,
  ]);
}

async function recordTest(ok: boolean, code: string, revision: number | null) {
  const res = await db.query<{ ai_declaration_record_test: Record<string, unknown> }>(
    "select public.ai_declaration_record_test($1,$2,$3)",
    [ok, code, revision],
  );
  return res.rows[0].ai_declaration_record_test;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(readFileSync(MIGRATION, "utf8"));
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("teststatus er bundet til oppsettet den ble kjørt mot", () => {
  it("en bestått test registreres mot gjeldende revisjon", async () => {
    await save("gpt-5-mini", "nokkel-1");
    const rev = Number((await settings()).config_revision);
    expect(await recordTest(true, "ok", rev)).toMatchObject({ recorded: true, stale: false });
    const v = await settings();
    expect(v.last_test_ok).toBe(true);
    expect(v.last_test_revision).toBe(rev);
  });

  it("ny nøkkel nullstiller teststatusen og hever revisjonen", async () => {
    const before = Number((await settings()).config_revision);
    await save("gpt-5-mini", "nokkel-2");
    const v = await settings();
    expect(Number(v.config_revision)).toBe(before + 1);
    expect(v.last_test_ok).toBe(false);
    expect(v.last_test_at).toBeNull();
    expect(v.last_test_revision).toBeNull();
  });

  it("ny modell nullstiller teststatusen, selv uten ny nøkkel", async () => {
    const rev = Number((await settings()).config_revision);
    await recordTest(true, "ok", rev);
    expect((await settings()).last_test_ok).toBe(true);

    await save("gpt-5", null);
    const v = await settings();
    expect(Number(v.config_revision)).toBe(rev + 1);
    expect(v.last_test_ok).toBe(false);
    expect(v.last_test_revision).toBeNull();
  });

  it("et testresultat fra et gammelt oppsett forkastes", async () => {
    const rev = Number((await settings()).config_revision);
    // Testen startet på forrige revisjon; oppsettet er endret underveis.
    const res = await recordTest(true, "ok", rev - 1);
    expect(res).toMatchObject({ recorded: false, stale: true, config_revision: rev });
    expect((await settings()).last_test_ok).toBe(false);
  });

  it("manglende revisjon godkjenner ingenting", async () => {
    const res = await recordTest(true, "ok", null);
    expect(res).toMatchObject({ recorded: false, stale: true });
    expect((await settings()).last_test_ok).toBe(false);
  });

  it("frakobling deaktiverer nøkkelen og nullstiller teststatusen", async () => {
    const rev = Number((await settings()).config_revision);
    await recordTest(true, "ok", rev);
    expect((await settings()).last_test_ok).toBe(true);

    await db.query("select public.ai_declaration_config_disconnect()");
    const v = await settings();
    expect(Number(v.config_revision)).toBe(rev + 1);
    expect(v.last_test_ok).toBe(false);
    expect(v.last_test_revision).toBeNull();
    const active = await db.query<{ n: number }>(
      "select count(*)::int as n from public.ai_provider_config where purpose='declaration_assistant' and is_active",
    );
    expect(active.rows[0].n).toBe(0);
  });

  it("migrasjonen gir bare service_role rett til å kjøre funksjonene", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    for (const fn of [
      "public.ai_declaration_record_test(boolean, text, integer)",
      "public.ai_declaration_config_disconnect()",
      "public.ai_declaration_config_save(text, integer, text, uuid, text)",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${fn} FROM public, anon, authenticated;`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role;`);
    }
    // Fakturaoppsettet skal ikke røres av denne migrasjonen.
    expect(sql).not.toContain("invoice");
  });
});
