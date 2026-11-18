-- DATAENDRING – kjøres bare av root etter Henriks ja. Standard er DRY-RUN: filen slutter med ROLLBACK.
-- Bytt ROLLBACK til COMMIT først når kontroll-SELECT-ene under viser forventet resultat.
--
-- Hva: fjerner 11 pantlinjer som samlet gjenlesing 17.11.2026 la til som duplikater på 6 Coca-Cola-fakturaer
-- (se 20261122_like_linjer.dryrun.sql). Etterpå stemmer linjesummen nøyaktig med sum eks. mva på alle seks.
-- Vakter (én feil = ingenting endres): linjen finnes med samme faktura, beløp og updated_at som ved analysen 18.11;
-- den er lagt til av gjenlesing (audit_log 'invoice_line.reread_added'); en eldre, helt lik linje finnes på samme faktura;
-- ingen ført kostpris, varemottak, lagerparti eller avvikssak på linjen; fakturaen er ikke avstemt/kansellert/utelatt/flagget;
-- linjesummen etter fjerning = sum eks. mva (±0,01).
-- Sikkerhetskopi: hele linjeraden lagres i _backup_like_linjer_20261122 før sletting.
-- Det databasen selv gjør ved sletting (eksisterende triggere): prisobservasjonen for linjen markeres som erstattet
-- («linje_slettet») og kostprisen regnes på nytt for varen (pant, 2 kr); innkjøps-/lagerspeil oppdateres.
-- Starter ikke ny matching eller gjenlesing.

begin;

create table if not exists public._backup_like_linjer_20261122 (
  line_id uuid primary key,
  invoice_id uuid not null,
  row_data jsonb not null,
  removed_at timestamptz not null default now()
);
alter table public._backup_like_linjer_20261122 enable row level security;
revoke all on public._backup_like_linjer_20261122 from anon, authenticated;
grant all on public._backup_like_linjer_20261122 to service_role;

create temporary table _plan (line_id uuid primary key, invoice_number text not null, total numeric not null, updated_at timestamptz not null) on commit drop;
insert into _plan values
  ('be065f4f-b27b-4be0-9b66-4b0725299b83', '9204800441', 48,  '2026-11-17 18:56:36.63098+00'),
  ('c6a6395d-fd02-4e32-a601-18690dc61f7e', '9204800441', 48,  '2026-11-17 18:56:36.963793+00'),
  ('086a763f-931f-40e6-9869-5d5c6c1c26f2', '9204947561', 240, '2026-11-17 19:55:55.710593+00'),
  ('3c022f55-6c6f-4af1-88bb-74807b774d3e', '9205004277', 48,  '2026-11-17 19:56:05.385079+00'),
  ('553d3504-63c6-46af-b766-e1d320ba8a80', '9205004277', 48,  '2026-11-17 19:56:05.787045+00'),
  ('fe06f0ff-c231-487b-987f-b14d0a604894', '9205030924', 48,  '2026-11-17 19:56:12.102767+00'),
  ('b24dd255-30d6-4703-879d-c8065f4c9742', '9205030924', 48,  '2026-11-17 19:56:12.6696+00'),
  ('74a051d6-72b0-4803-85c7-9c5ecb6a32fc', '9205057534', 48,  '2026-11-17 18:31:42.063281+00'),
  ('4d5ec2a9-db0a-4a2d-bda6-d663cb490c46', '9205057534', 48,  '2026-11-17 18:31:42.412601+00'),
  ('89bddcb7-89ae-4e74-8c01-6d8ce7167268', '9205362406', 48,  '2026-11-17 18:55:28.297917+00'),
  ('adf9d6e0-d610-4f4c-bf6a-459183e81e1c', '9205362406', 48,  '2026-11-17 18:55:28.605816+00');

do $$
declare r record; v_bad text;
begin
  for r in select p.*, l.id as lid, l.invoice_id, l.total_amount, l.updated_at as cur_upd, l.excluded_at, i.invoice_number as inv_no,
                  i.status, i.flagged_at, i.excluded_at as inv_excl
             from _plan p left join public.invoice_lines l on l.id = p.line_id left join public.invoices i on i.id = l.invoice_id loop
    v_bad := case
      when r.lid is null then 'finnes ikke'
      when r.inv_no is distinct from r.invoice_number then 'annen faktura'
      when r.total_amount is distinct from r.total then 'annet beløp'
      when r.cur_upd is distinct from r.updated_at then 'endret siden analysen'
      when r.excluded_at is not null then 'holdt utenfor'
      when r.status in ('reconciled', 'cancelled', 'excluded') or r.flagged_at is not null or r.inv_excl is not null then 'faktura låst'
      when not exists (select 1 from public.audit_log a where a.action = 'invoice_line.reread_added' and a.entity_id = r.line_id) then 'ikke lagt til av gjenlesing'
      when not exists (select 1 from public.invoice_lines o join public.invoice_lines l on l.id = r.line_id
                        where o.invoice_id = l.invoice_id and o.id <> l.id and o.created_at < l.created_at
                          and o.supplier_sku is not distinct from l.supplier_sku and o.description is not distinct from l.description
                          and o.quantity is not distinct from l.quantity and o.unit_price is not distinct from l.unit_price
                          and o.total_amount is not distinct from l.total_amount) then 'ingen eldre lik linje'
      when exists (select 1 from public.invoice_line_cost_postings c where c.invoice_line_id = r.line_id) then 'ført kostpris'
      when exists (select 1 from public.rm_goods_receipts g where g.invoice_line_id = r.line_id) then 'varemottak'
      when exists (select 1 from public.rm_stock_lots s where s.invoice_line_id = r.line_id) then 'lagerparti'
      when exists (select 1 from public.supplier_deviation_case_lines d where d.invoice_line_id = r.line_id) then 'avvikssak'
      else null end;
    if v_bad is not null then raise exception 'Stopper: linje % (faktura %): %', r.line_id, r.invoice_number, v_bad; end if;
  end loop;
  -- Summen må stemme etter fjerning.
  for r in select i.id, i.invoice_number, i.total_amount - coalesce(i.total_vat, 0) as eks,
                  (select sum(x.total_amount) from public.invoice_lines x where x.invoice_id = i.id and x.id not in (select line_id from _plan)) as etter
             from public.invoices i where i.invoice_number in (select distinct invoice_number from _plan)
              and i.id in (select l.invoice_id from public.invoice_lines l where l.id in (select line_id from _plan)) loop
    if abs(r.etter - r.eks) > 0.01 then raise exception 'Stopper: faktura % får linjesum % mot sum eks. mva %', r.invoice_number, r.etter, r.eks; end if;
  end loop;
end $$;

insert into public._backup_like_linjer_20261122 (line_id, invoice_id, row_data)
select l.id, l.invoice_id, to_jsonb(l) from public.invoice_lines l where l.id in (select line_id from _plan)
on conflict (line_id) do nothing;

create temporary table _inv on commit drop as
  select distinct l.invoice_id from public.invoice_lines l where l.id in (select line_id from _plan);

delete from public.invoice_lines where id in (select line_id from _plan);

-- Linjesum og status på nytt (samme regel som rm_correct_invoice_line).
update public.invoices i set
  lines_sum_excl_vat = (s.v->>'lines_sum_excl_vat')::numeric,
  lines_sum_variance_pct = (s.v->>'lines_sum_variance_pct')::numeric,
  lines_sum_status = s.v->>'lines_sum_status',
  updated_at = now()
from (select x.invoice_id, public.rm_lines_sum_check(sum(x.total_amount), count(*)::int, iv.total_amount, iv.total_vat, coalesce(iv.is_credit_note, false)) as v
        from public.invoice_lines x join public.invoices iv on iv.id = x.invoice_id
       where x.invoice_id in (select invoice_id from _inv) group by x.invoice_id, iv.total_amount, iv.total_vat, iv.is_credit_note) s
where i.id = s.invoice_id;

insert into public.audit_log (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
select null, 'invoice_line.duplicate_removed', 'invoice_line', b.line_id, i.legal_entity_id,
       jsonb_build_object('before', b.row_data), 'Rest fra samlet gjenlesing 17.11.2026: tillagt duplikat (20261122_like_linjer)', 'ravarer'
  from public._backup_like_linjer_20261122 b join public.invoices i on i.id = b.invoice_id
 where b.line_id in (select line_id from _plan);

-- Kontroll: skal vise 6 fakturaer med lines_sum_status = ok og avvik 0, og 11 linjer i sikkerhetskopien.
select i.invoice_number, i.lines_sum_status, i.lines_sum_variance_pct, i.lines_sum_excl_vat, i.total_amount - coalesce(i.total_vat, 0) as eks_mva
  from public.invoices i where i.id in (select invoice_id from _inv) order by 1;
select count(*) as i_sikkerhetskopi from public._backup_like_linjer_20261122;

ROLLBACK; -- DRY-RUN. Bytt til COMMIT etter kontroll.
