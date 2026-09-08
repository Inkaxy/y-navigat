import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Migrasjonene for F2 og F5 rulles ut manuelt. Testene her vokter de reglene som
 * ellers bare kan brytes stille: prisgrunnlag, kreditnota, idempotens og
 * rettigheter. De erstatter ikke en kjøring mot basen, men fanger opp at SQL-en
 * blir endret tilbake til den gamle (feilaktige) adferden.
 */
const F2 = readFileSync(resolve("supabase/migrations-pending/20260908_f2_price_history_linewise.sql"), "utf8");
const F5 = readFileSync(resolve("supabase/migrations-pending/20260908_f5_count_and_receipt.sql"), "utf8");

describe("F2 — linjesporbar prishistorikk", () => {
  it("bruker aldri unit_price som fallback for pris per grunnenhet", () => {
    expect(/coalesce\s*\(\s*(new\.)?price_per_base_unit\s*,\s*(new\.)?unit_price/i.test(F2)).toBe(false);
    expect(F2).toMatch(/v_l\.price_per_base_unit is null/i);
  });

  it("gir prishistorikken fakturalinje-ID med unikhet", () => {
    expect(F2).toMatch(/add column if not exists invoice_line_id uuid references public\.invoice_lines/i);
    expect(F2).toMatch(/create unique index if not exists ux_rmph_invoice_line/i);
    expect(F2).toMatch(/on conflict \(invoice_line_id\)/i);
  });

  it("tar med auto_medium", () => {
    expect(F2).toMatch(/'auto_high',\s*'auto_medium',\s*'auto_low',\s*'manual'/);
  });

  it("fører kreditnota som kredithendelse og aldri som ny kostpris", () => {
    expect(F2).toMatch(/is_credit\s+boolean not null default false/i);
    expect(F2).toMatch(/h\.is_credit = false/i);
  });

  it("respekterer manuell overstyring av kostpris", () => {
    expect(F2).toMatch(/coalesce\(v_rm\.price_source, ''\) = 'manual'/i);
    expect(F2).toMatch(/coalesce\(price_source, ''\) <> 'manual'/i);
  });

  it("bevarer gammel historikk uten å telle den dobbelt", () => {
    expect(F2).toMatch(/is_legacy = true/i);
    expect(F2).toMatch(/superseded_at/i);
    expect(F2).not.toMatch(/delete from public\.raw_material_price_history/i);
  });

  it("avstemmingen er låst, tilgangsstyrt og idempotent", () => {
    expect(F2).toMatch(/from public\.invoices where id = p_invoice_id for update/i);
    expect(F2).toMatch(/order by id for update/i);
    expect(F2).toMatch(/has_ravarer_invoice_access\(v_inv\.legal_entity_id, 'write'\)/i);
    expect(F2).toMatch(/if v_inv\.status = 'reconciled' then/i);
    expect(F2).toMatch(/rm\.legal_entity_id <> v_inv\.legal_entity_id/i);
    expect(F2).toMatch(/flagged_at is not null/i);
    expect(F2).toMatch(/upper\(coalesce\(v_inv\.currency, 'NOK'\)\) <> 'NOK'/i);
  });

  it("gir ingen offentlig kjøretilgang på interne definer-funksjoner", () => {
    expect(F2).toMatch(/revoke all on function public\.fn_rm_price_history_upsert_line\(uuid\) from public, anon, authenticated/i);
    expect(F2).toMatch(/grant execute on function public\.rm_reconcile_invoice\(uuid\) to authenticated/i);
  });
});

describe("F5 — telling og varemottak", () => {
  it("oppretter telleark med grants og RLS", () => {
    expect(F5).toMatch(/create table if not exists public\.rm_stock_count_sheets/i);
    expect(F5).toMatch(/grant select, insert, update, delete on public\.rm_stock_count_sheets to authenticated/i);
    expect(F5).toMatch(/grant all on public\.rm_stock_count_sheets to service_role/i);
    expect(F5).toMatch(/alter table public\.rm_stock_count_sheets enable row level security/i);
    expect(F5).toMatch(/has_position_in_entity\(legal_entity_id\)/i);
  });

  it("teller idempotent på operasjons-ID og låser i fast rekkefølge", () => {
    expect(F5).toMatch(/where op_id = p_op_id for update/i);
    expect(F5).toMatch(/order by rm\.id\s*\n?\s*for update/i);
    expect(F5).toMatch(/on conflict \(source_table, source_id, raw_material_id\)/i);
  });

  it("stopper hele tellingen ved konflikt", () => {
    expect(F5).toMatch(/Beholdningen er endret av andre/);
    expect(F5).toMatch(/errcode = '40001'/);
  });

  it("beholder den gamle telle-RPC-en urørt", () => {
    expect(F5).not.toMatch(/drop function[^;]*rm_stock_count_apply\(/i);
  });

  it("dobbeltfører ikke mottak og snur aldri kreditt til positivt", () => {
    expect(F5).toMatch(/already_received/);
    expect(F5).toMatch(/create table if not exists public\.rm_goods_receipts/i);
    expect(F5).toMatch(/v_qty := -abs\(v_qty\)/);
    expect(F5).toMatch(/source_table = 'invoice_lines' and source_id = v_l\.id/i);
  });

  it("gir ikke anonyme kjøretilgang til de nye RPC-ene", () => {
    expect(F5).toMatch(/revoke all on function public\.rm_stock_count_apply_v2\(uuid, jsonb, text\) from public, anon/i);
    expect(F5).toMatch(/revoke all on function public\.rm_receive_invoice_line\(uuid, text, date, text\) from public, anon/i);
  });
}
  it("claimer telleark før arbeidet og avviser gjenbruk med annet innhold", () => {
    expect(F5).toMatch(/on conflict \(op_id\) do nothing/i);
    expect(F5).toMatch(/allerede brukt med et annet innhold/);
    expect(F5).toMatch(/Tellingen blander varer fra flere selskaper/);
    expect(F5).toMatch(/rm_is_finite/);
    expect(F5).toMatch(/mangler forventet beholdning/);
  });

  it("låser faktura før linje i mottaket, som i avstemmingen", () => {
    const inv = F5.search(/for update of i;/);
    const line = F5.search(/from public\.invoice_lines where id = p_line_id for update/i);
    expect(inv).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(inv);
  });

  it("validerer linja også når triggeren allerede har bokført", () => {
    expect(F5).toMatch(/venter på gjennomgang og kan ikke mottas/);
    expect(F5).toMatch(/ikke relevant og kan ikke mottas/);
  });
});
