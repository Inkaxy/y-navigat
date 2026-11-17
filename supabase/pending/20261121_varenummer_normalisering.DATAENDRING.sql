-- DATAENDRING – kjøres bare av root etter godkjenning fra Henrik, og først etter
-- 20261121_varenummer_normalisering.PENDING.sql. Standard er DRY-RUN: filen slutter med ROLLBACK.
-- Bytt ROLLBACK til COMMIT først når tallene fra SELECT-ene under er kontrollert.
--
-- Hva den gjør: setter invoice_lines.supplier_sku til foreslått varenummer for åpne, ukoblede linjer på åpne
-- fakturaer (ikke internt godkjent, ingen ført kostpris, ikke holdt utenfor). Opprinnelig verdi lagres i
-- _backup_invoice_line_sku_20261121 (lesingen bevares som bevis). Ingen kobling, kost, lager eller pris endres.
-- Starter IKKE ny matching; etterpå må root/Henrik selv avgjøre om berørte fakturaer skal regnes om.
-- Ta bort 'manglet_varenummer' fra listen under for bare å rette avkortede numre og ASKO-koder.

begin;

create table if not exists public._backup_invoice_line_sku_20261121 (
  line_id uuid primary key,
  invoice_id uuid not null,
  old_sku text,
  new_sku text not null,
  reason text not null,
  changed_at timestamptz not null default now()
);
alter table public._backup_invoice_line_sku_20261121 enable row level security;
revoke all on public._backup_invoice_line_sku_20261121 from anon, authenticated;
grant all on public._backup_invoice_line_sku_20261121 to service_role;

with plan as (
  select * from public._rm_sku_canon_plan((select id from public.legal_entities where status = 'active' order by short_code limit 1))
  where can_change and reason in ('ikke_varenummer', 'avkortet_foran', 'avkortet_bak', 'manglet_varenummer')
)
insert into public._backup_invoice_line_sku_20261121 (line_id, invoice_id, old_sku, new_sku, reason)
select line_id, invoice_id, current_sku, proposed_sku, reason from plan
on conflict (line_id) do nothing;

-- Bare linjer som fortsatt er åpne og har samme varenummer som i sikkerhetskopien.
update public.invoice_lines il
set supplier_sku = b.new_sku
from public._backup_invoice_line_sku_20261121 b
where il.id = b.line_id
  and il.supplier_sku is not distinct from b.old_sku
  and il.requires_review is true and il.raw_material_id is null and il.excluded_at is null;

-- Kontroll: antall per leverandør og grunn.
select i.supplier_id, s.name, b.reason, count(*)
from public._backup_invoice_line_sku_20261121 b
join public.invoices i on i.id = b.invoice_id join public.suppliers s on s.id = i.supplier_id
group by 1, 2, 3 order by 2, 3;

ROLLBACK; -- DRY-RUN. Bytt til COMMIT etter kontroll.
