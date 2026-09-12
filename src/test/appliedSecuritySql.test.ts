import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Sikkerhetsmigrasjoner som er anvendt direkte mot prosjektet skal ligge
 * ordrett i repoet, slik at innholdet kan revideres uten tilgang til databasen.
 *
 * `supabase/migrations/` er låst av migrasjonsverktøyet: en fil kan bare legges
 * der ved å kjøre SQL-en. For migrasjoner som ALLEREDE er anvendt ligger
 * kopien derfor i `supabase/applied-sql/` inntil den kan flyttes.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const APPLIED_DIR = resolve(process.cwd(), "supabase/applied-sql");

function readMirror(version: string, slug: string): string {
  const name = `${version}_${slug}.sql`;
  for (const dir of [MIGRATIONS_DIR, APPLIED_DIR]) {
    const path = resolve(dir, name);
    if (existsSync(path)) return readFileSync(path, "utf8");
  }
  throw new Error(`Fant ingen speilet SQL for versjon ${version}`);
}

describe("anvendte sikkerhetsmigrasjoner er speilet i repoet", () => {
  it("20260912191531 fjerner global kakeopprydding fra klientroller", () => {
    const sql = readMirror("20260912191531", "restrict_global_cake_cleanup_to_server");
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.cleanup_old_printed_cake_images\(\)/);
    expect(sql).toMatch(/FROM PUBLIC, anon, authenticated/);
  });

  describe("20260912204709 avgrenser close_delivered_orders til egne selskaper", () => {
    const sql = readMirror("20260912204709", "scope_close_delivered_orders_to_user_entities");

    it("beholder signatur og sikkerhetskontekst", () => {
      expect(sql).toMatch(
        /CREATE OR REPLACE FUNCTION public\.close_delivered_orders\(p_until date DEFAULT \(CURRENT_DATE - 1\)\)/,
      );
      expect(sql).toMatch(/RETURNS integer/);
      expect(sql).toMatch(/SECURITY DEFINER/);
      expect(sql).toMatch(/SET search_path TO 'public'/);
    });

    it("filtrerer brukerkall på egne selskaper, men slipper cron/service gjennom", () => {
      expect(sql).toMatch(
        /AND \(auth\.uid\(\) IS NULL OR public\.has_position_in_entity\(o\.legal_entity_id\)\)/,
      );
    });

    it("avviser NULL fra skrivetilgangssjekken (IS NOT TRUE, ikke NOT)", () => {
      expect(sql).toMatch(
        /auth\.uid\(\) IS NOT NULL AND public\.has_app_write_access\('ordre'\) IS NOT TRUE/,
      );
      expect(sql).not.toMatch(/NOT public\.has_app_write_access\('ordre'\)/);
    });

    it("avviser anonyme kall uten JWT-bruker som ikke er service_role", () => {
      expect(sql).toMatch(
        /auth\.uid\(\) IS NULL AND auth\.role\(\) IS NOT NULL AND auth\.role\(\) <> 'service_role'/,
      );
      expect(sql).toMatch(/ERRCODE = '42501'/);
    });

    it("beholder dato- og returregler og lukker bare leverte ordrer", () => {
      expect(sql).toMatch(/o\.delivery_date <= p_until/);
      expect(sql).toMatch(/COALESCE\(o\.is_return, false\) = false/);
      expect(sql).toMatch(/o\.status IN \('confirmed','in_production','packed'\)/);
      expect(sql).toMatch(/dn\.status <> 'cancelled'/);
      expect(sql).toMatch(/SET status = 'delivered'/);
    });

    it("endrer ingen ordredata utover statusoppdateringen i funksjonen", () => {
      expect(sql).not.toMatch(/\bDELETE\b/i);
      expect(sql).not.toMatch(/\bTRUNCATE\b/i);
      expect(sql).not.toMatch(/\bDROP\b/i);
    });
  });

  describe("20260912210449 låser snapshot-forsøk uten å kreve UPDATE-rett", () => {
    const sql = readMirror("20260912210449", "fix_snapshot_retry_lock_under_rls");
    // Kommentarlinjer forklarer bakgrunnen (som nevner FOR UPDATE) — kontroller SQL-en selv.
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    it("bruker advisory lock per forsøks-id i stedet for SELECT ... FOR UPDATE", () => {
      expect(code).toMatch(
        /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_attempt_id::text, 0\)\)/,
      );
      expect(code).not.toMatch(/FOR UPDATE/);
    });

    it("kjører som kaller (ingen SECURITY DEFINER) så RLS fortsatt gjelder", () => {
      expect(sql).toMatch(
        /CREATE OR REPLACE FUNCTION public\.save_production_plan_snapshot\(p_attempt_id uuid, p_legal_entity_id uuid, p_production_date date, p_criteria jsonb, p_items jsonb\)/,
      );
      expect(sql).toMatch(/RETURNS jsonb/);
      expect(sql).toMatch(/SET search_path TO 'public'/);
      expect(sql).not.toMatch(/SECURITY DEFINER/);
    });

    it("utvider ingen rettigheter og endrer ingen policy eller tabell", () => {
      expect(code).not.toMatch(/CREATE POLICY/i);
      expect(code).not.toMatch(/ALTER POLICY/i);
      expect(code).not.toMatch(/\bGRANT\b/i);
      expect(code).not.toMatch(/ALTER TABLE/i);
      expect(code).not.toMatch(/CREATE TABLE/i);
      expect(code).not.toMatch(/\bDROP\b/i);
      expect(code).not.toMatch(/\bTRUNCATE\b/i);
      expect(code).not.toMatch(/\bDELETE\b/i);
      expect(code).not.toMatch(/\bUPDATE\b\s+public\./i);
    });

    it("beholder tilgangs- og gyldighetskontrollene", () => {
      expect(sql).toMatch(/auth\.uid\(\) IS NULL[\s\S]*?ERRCODE = '42501'/);
      expect(sql).toMatch(/NOT public\.has_position_in_entity\(p_legal_entity_id\)/);
      expect(sql).toMatch(
        /NOT \(public\.has_app_write_access\('produksjon'\) OR public\.has_app_write_access\('varer'\)\)/,
      );
      expect(sql).toMatch(/jsonb_typeof\(p_items\) <> 'array'/);
    });

    it("beholder uforanderlig innholdsvalidering ved gjentatt forsøks-id", () => {
      expect(sql).toMatch(/Forsøks-id er allerede brukt på et annet grunnlag/);
      expect(sql).toMatch(/Forsøks-id er allerede brukt med andre kriterier/);
      expect(sql).toMatch(/Forsøks-id er allerede brukt med andre varelinjer/);
      expect(sql).toMatch(/'already_saved', true/);
      expect(sql).toMatch(/Lagret % av % varelinjer/);
    });
  });

  it("speiler hver anvendt versjon nøyaktig én gang", () => {
    const names = [
      ...readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")),
      ...(existsSync(APPLIED_DIR) ? readdirSync(APPLIED_DIR).filter((f) => f.endsWith(".sql")) : []),
    ];
    const versions = names.map((f) => f.slice(0, 14));
    expect(new Set(versions).size).toBe(versions.length);
  });
});
