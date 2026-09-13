import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Regresjon for bytte av AI-nøkkel.
 *
 * Live har `ai_provider_config` et unikt indeks på (purpose) WHERE is_active.
 * Den opprinnelige funksjonen satte inn den nye aktive raden FØR den deaktiverte
 * den gamle, og kunne derfor aldri erstatte en eksisterende nøkkel.
 *
 * Testen kjører de faktiske funksjonsdefinisjonene fra migrasjonen mot en ekte
 * PostgreSQL (PGlite) med det samme unike indekset.
 */

const MIGRATION = path.join(
  process.cwd(),
  "supabase/migrations/20260913064235_42e31ee1-53d4-4e66-a5a3-b05a87f4b333.sql",
);

const PURPOSE = "declaration_assistant";

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

type Row = { encrypted_api_key: string; is_active: boolean };

let db: PGlite;

async function rows(): Promise<Row[]> {
  const res = await db.query<Row>(
    "select encrypted_api_key, is_active from public.ai_provider_config where purpose = $1 order by created_at",
    [PURPOSE],
  );
  return res.rows;
}

async function activeKey(): Promise<string | null> {
  const found = (await rows()).find((row) => row.is_active);
  return found ? found.encrypted_api_key : null;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(readFileSync(MIGRATION, "utf8"));
  await db.query(
    "insert into public.ai_provider_config(provider, encrypted_api_key, model, purpose) values ($1,$2,$3,$4)",
    ["openai", "gammel-nokkel", "gpt-5-mini", PURPOSE],
  );
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe("bytte av aktiv AI-nøkkel under unikt indeks", () => {
  it("den gamle rekkefølgen (innsetting først) bryter det unike indekset", async () => {
    await expect(
      db.exec(`
        insert into public.ai_provider_config(provider, encrypted_api_key, model, purpose, is_active)
        values ('openai', 'ny-nokkel', 'gpt-5-mini', '${PURPOSE}', true);
      `),
    ).rejects.toThrow(/ai_provider_config_active_purpose_idx/);
    expect(await activeKey()).toBe("gammel-nokkel");
  });

  it("ai_config_replace_active bytter nøkkel og lar bare én være aktiv", async () => {
    await db.query("select public.ai_config_replace_active($1,$2,$3,$4)", [
      PURPOSE,
      "openai",
      "ny-nokkel",
      "gpt-5-mini",
    ]);
    const all = await rows();
    expect(all.filter((row) => row.is_active)).toHaveLength(1);
    expect(await activeKey()).toBe("ny-nokkel");
  });

  it("ai_declaration_config_save bytter nøkkel og lagrer innstillinger", async () => {
    await db.query("select public.ai_declaration_config_save($1,$2,$3,$4,$5)", [
      "gpt-5-mini",
      120,
      "Husregler",
      null,
      "enda-nyere-nokkel",
    ]);
    expect(await activeKey()).toBe("enda-nyere-nokkel");
    const settings = await db.query<{ value: { daily_cap: number; model: string } }>(
      "select value from public.platform_settings where category = 'varer_ai' and key = 'declaration_assistant'",
    );
    expect(settings.rows[0].value.daily_cap).toBe(120);
    expect(settings.rows[0].value.model).toBe("gpt-5-mini");
  });

  it("feil midt i transaksjonen ruller tilbake til forrige aktive nøkkel", async () => {
    await db.exec("begin");
    try {
      await db.query("select public.ai_config_replace_active($1,$2,$3,$4)", [
        PURPOSE,
        "openai",
        "aldri-lagret",
        "gpt-5-mini",
      ]);
      await db.query("select 1/0");
      await db.exec("commit");
      throw new Error("forventet feil uteble");
    } catch (error) {
      expect((error as Error).message).toMatch(/division by zero/);
      await db.exec("rollback");
    }
    expect(await activeKey()).toBe("enda-nyere-nokkel");
    const all = await rows();
    expect(all.some((row) => row.encrypted_api_key === "aldri-lagret")).toBe(false);
  });

  it("kvoten klemmes til øvre grense på serveren", async () => {
    const res = await db.query<{ ai_declaration_config_save: { daily_cap: number } }>(
      "select public.ai_declaration_config_save($1,$2,$3,$4,$5)",
      ["gpt-5-mini", 9000, "", null, null],
    );
    expect(res.rows[0].ai_declaration_config_save.daily_cap).toBe(500);
    expect(await activeKey()).toBe("enda-nyere-nokkel");
  });
});
