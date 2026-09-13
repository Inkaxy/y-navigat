import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Repo-rekonsiliering.
 *
 * De to sikkerhetsrettingene i `supabase/applied-sql/` ble anvendt DIREKTE mot
 * databasen og finnes derfor ikke som egne filer i `supabase/migrations/`.
 * Uten en bærende migrasjon ville en replay av migrasjonsmappen i et nytt
 * miljø gi en database UTEN rettingene.
 *
 * Konsolideringsmigrasjonen 20260913001322 bærer begge gjeldende
 * funksjonsdefinisjoner, betinget: den sammenligner `pg_get_functiondef` med
 * forventet definisjon og kjører `EXECUTE` kun ved forskjell. Mot dagens
 * database er den en no-op; ved replay gjenskaper den siste sikre definisjon.
 *
 * Originalspeilene beholdes som revisjonsbevis og skal IKKE endres — denne
 * testen pinner at konsolideringen er byte-identisk med dem.
 */
const MIGRATIONS_DIR = resolve(process.cwd(), "supabase/migrations");
const APPLIED_DIR = resolve(process.cwd(), "supabase/applied-sql");

const CONSOLIDATION_VERSION = "20260913001322";

function readConsolidation(): string {
  const file = readdirSync(MIGRATIONS_DIR).find((f) =>
    f.startsWith(`${CONSOLIDATION_VERSION}_`),
  );
  if (!file) throw new Error(`Fant ingen konsolideringsmigrasjon ${CONSOLIDATION_VERSION}`);
  return readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
}

/** Speilfilen minus forklarende topptekst = den rene funksjonsdefinisjonen. */
function readMirrorDefinition(name: string): string {
  const path = resolve(APPLIED_DIR, `${name}.sql`);
  if (!existsSync(path)) throw new Error(`Mangler speilfil ${name}`);
  const text = readFileSync(path, "utf8");
  const start = text.indexOf("CREATE OR REPLACE FUNCTION");
  if (start < 0) throw new Error(`Speilfilen ${name} har ingen funksjonsdefinisjon`);
  const body = text.slice(start);
  return body.endsWith("\n") ? body : `${body}\n`;
}

function extractExpected(sql: string, tag: string): string {
  const open = `$${tag}$`;
  const start = sql.indexOf(open);
  const end = sql.indexOf(open, start + open.length);
  if (start < 0 || end < 0) throw new Error(`Fant ikke dollar-sitatet ${tag}`);
  return sql.slice(start + open.length, end);
}

describe("konsolideringsmigrasjon for allerede anvendte sikkerhetsrettinger", () => {
  const sql = readConsolidation();

  it("finnes i migrations-mappen slik at replay dekker begge rettingene", () => {
    expect(sql).toContain("close_delivered_orders");
    expect(sql).toContain("save_production_plan_snapshot");
  });

  it("bærer close_delivered_orders byte-identisk med revisjonsspeilet", () => {
    const expected = extractExpected(sql, "expected_close");
    const mirror = readMirrorDefinition(
      "20260912204709_scope_close_delivered_orders_to_user_entities",
    );
    expect(expected).toBe(mirror);
  });

  it("bærer save_production_plan_snapshot byte-identisk med revisjonsspeilet", () => {
    const expected = extractExpected(sql, "expected_snap");
    const mirror = readMirrorDefinition("20260912210449_fix_snapshot_retry_lock_under_rls");
    expect(expected).toBe(mirror);
  });

  it("kjører CREATE OR REPLACE kun når definisjonen faktisk avviker", () => {
    // Begge blokkene: hent nåværende definisjon, sammenlign, EXECUTE i if-grenen.
    expect(sql).toMatch(
      /v_current := pg_get_functiondef\(to_regprocedure\('public\.close_delivered_orders\(date\)'\)\);/,
    );
    expect(sql).toMatch(
      /v_current := pg_get_functiondef\(to_regprocedure\('public\.save_production_plan_snapshot\(uuid,uuid,date,jsonb,jsonb\)'\)\);/,
    );
    const guards = sql.match(/IF v_current IS DISTINCT FROM v_expected THEN\s+EXECUTE v_expected;/g);
    expect(guards).toHaveLength(2);
    // Ingen ubetinget EXECUTE utenfor vaktene.
    expect(sql.match(/EXECUTE v_expected;/g)).toHaveLength(2);
  });

  it("beholder sikkerhetssemantikken fra begge rettingene", () => {
    // close_delivered_orders: selskapsfilter + NULL-avvisende skrivetilgangsvakt.
    expect(sql).toMatch(
      /AND \(auth\.uid\(\) IS NULL OR public\.has_position_in_entity\(o\.legal_entity_id\)\)/,
    );
    expect(sql).toMatch(
      /public\.has_app_write_access\('ordre'\) IS NOT TRUE/,
    );
    expect(sql).toMatch(/SECURITY DEFINER/);
    // save_production_plan_snapshot: advisory lock, ingen FOR UPDATE, kjører som kaller.
    expect(sql).toMatch(
      /PERFORM pg_advisory_xact_lock\(hashtextextended\(p_attempt_id::text, 0\)\)/,
    );
    // Kommentarlinjene nevner FOR UPDATE som bakgrunn — kontroller selve koden.
    const executable = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(executable).not.toMatch(/FOR UPDATE/);
  });

  it("utvider ingen rettigheter og rører ingen data eller tabeller", () => {
    const code = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(code).not.toMatch(/\bGRANT\b/i);
    expect(code).not.toMatch(/\bREVOKE\b/i);
    expect(code).not.toMatch(/CREATE POLICY/i);
    expect(code).not.toMatch(/ALTER POLICY/i);
    expect(code).not.toMatch(/CREATE TABLE/i);
    expect(code).not.toMatch(/ALTER TABLE/i);
    expect(code).not.toMatch(/\bDROP\b/i);
    expect(code).not.toMatch(/\bTRUNCATE\b/i);
    // Ingen manipulasjon av migrasjonsregisteret.
    expect(code).not.toMatch(/supabase_migrations/i);
  });

  it("beholder originalspeilene som revisjonsbevis", () => {
    const mirrors = readdirSync(APPLIED_DIR).filter((f) => f.endsWith(".sql"));
    expect(mirrors).toContain(
      "20260912204709_scope_close_delivered_orders_to_user_entities.sql",
    );
    expect(mirrors).toContain("20260912210449_fix_snapshot_retry_lock_under_rls.sql");
  });
});
