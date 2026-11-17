-- PENDING 20261119_nye_varer_les – rask, dedikert lesefunksjon for «Fra faktura › Nye varer».
-- Kjøres av root. Bare tillegg: én ny lesefunksjon + én cap-funksjon. Ingen tabeller, kolonner, indekser eller data endres,
-- og ingen eksisterende funksjon røres (rm_work_items er uendret; md5 efe0f95ef98471bbfca5713d05960e27 kontrolleres i .check.sql).
--
-- Hvorfor: rm_work_items regner lesekontroll (_rm_queue_line_read_issue) for ALLE fakturalinjer og prisvirkning
-- (_rm_queue_line_effect → rm_price_reference/_rm_cost_candidates) for alle åpne linjer ved HVERT kall, uansett gruppe,
-- side eller grense. «Nye varer» trenger ingen av delene. Denne funksjonen bruker nøyaktig samme gruppering
-- (leverandør + item_key), samme klassifisering (ukoblet / mangler_pakning) og samme sortering («eldste først») som
-- rm_work_items, men uten hjelpefunksjonene per linje. Målt kjernespørring 17.11: ca. 0,13 s (1,1 s under last).
--
-- Svar: { ok, total, counts{kobling,pakning,alle}, suppliers[{supplier_id,supplier_name,count}], items[…], generated_at }
--   total     = antall rader etter leverandørfilteret
--   counts    = for hele selskapet (uavhengig av filteret), slik at fanetelleren er lik uansett valgt leverandør
--   suppliers = antall per leverandør (for chipsene), uavhengig av filteret
--   items     = samme form som rm_work_items' varekort (key, grp, type, kind, supplier_id, …), sidevis
-- p_limit 0 gir bare tellerne. Maks 200 per side.

create or replace function public.rm_new_items_queue(
  p_legal_entity_id uuid, p_supplier_id uuid default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v jsonb;
begin
  if auth.uid() is not null and not public.has_ravarer_invoice_access(p_legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;

  with inv as materialized (
    select i.id, i.supplier_id, i.invoice_date,
           (i.status in ('imported','needs_review','ready') and i.flagged_at is null) is_open
      from invoices i
     where i.excluded_at is null and i.status is distinct from 'excluded' and i.legal_entity_id = p_legal_entity_id
  ), lines as materialized (
    select il.id, il.invoice_id, i.supplier_id, i.invoice_date, il.created_at, il.supplier_sku, il.description,
           il.raw_material_id, il.match_confidence, il.requires_review, il.review_reason, il.total_amount,
           -- Samme regel som rm_link_supplier_item: linje med aktiv ført kostpris kan ikke kobles og er ikke åpen.
           (i.is_open and not exists (select 1 from public.invoice_line_cost_postings cp where cp.invoice_line_id = il.id and cp.revoked_at is null)) is_open,
           case when public.rm_sku_norm(il.supplier_sku) <> '' then 'sku:' || public.rm_sku_norm(il.supplier_sku)
                else 'name:' || public.rm_match_key(il.description) end item_key
      from invoice_lines il join inv i on i.id = il.invoice_id
     where il.excluded_at is null
  ), agg as (
    select supplier_id, item_key,
           count(distinct invoice_id) invoice_count, max(invoice_date) last_seen,
           min(invoice_date) filter (where requires_review and is_open) oldest_open,
           count(*) filter (where requires_review and is_open) open_lines,
           count(distinct invoice_id) filter (where requires_review and is_open) open_invoices,
           (array_agg(id order by invoice_date desc, created_at desc, id desc))[1] last_line_id,
           (array_agg(id order by invoice_date desc, created_at desc, id desc) filter (where requires_review and is_open))[1] last_open_line_id,
           (array_agg(raw_material_id order by invoice_date desc, created_at desc, id desc)
              filter (where raw_material_id is not null and match_confidence in ('manual','auto_high','auto_medium')))[1] linked_rm_id,
           (array_agg(match_confidence order by invoice_date desc, created_at desc, id desc))[1] last_conf,
           string_agg(distinct review_reason, ',') filter (where requires_review and is_open) reasons_raw,
           coalesce(sum(abs(total_amount)) filter (where requires_review and is_open), 0) open_amount,
           max(supplier_sku) filter (where supplier_sku is not null and btrim(supplier_sku) <> '') supplier_sku
      from lines group by 1, 2
  ), q as materialized (
    -- Samme rekkefølge som rm_work_items: ikke_vare først, så ukoblet, så mangler_pakning.
    select a.*, ll.description, s.name supplier_name, rm.name rm_name,
           case when a.linked_rm_id is null then 'ukoblet' else 'mangler_pakning' end kind,
           'varekort:' || a.supplier_id || ':' || a.item_key as key
      from agg a join lines ll on ll.id = a.last_line_id
      left join suppliers s on s.id = a.supplier_id
      left join raw_materials rm on rm.id = a.linked_rm_id
     where a.last_conf is distinct from 'not_applicable'
       -- Bare varer med minst én linje koblingen godtar (samme regel som rm_link_supplier_item; 20261121_kobling_godkjent_faktura).
       and a.open_lines > 0
       and (a.linked_rm_id is null
            or coalesce(a.reasons_raw,'') ~ '(unknown_package_size|package_conflict|missing_base_unit|uncertain_cost)')
  ), f as (
    select q.*, row_number() over (order by q.oldest_open asc nulls last, q.last_seen desc nulls last, q.key) rn
      from q where p_supplier_id is null or q.supplier_id = p_supplier_id
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from f),
    'counts', (select jsonb_build_object('kobling', count(*) filter (where kind = 'ukoblet'),
                                         'pakning', count(*) filter (where kind = 'mangler_pakning'),
                                         'alle', count(*)) from q),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('supplier_id', x.supplier_id, 'supplier_name', x.supplier_name, 'count', x.n)
                                            order by x.supplier_name nulls last, x.supplier_id), '[]'::jsonb)
                    from (select supplier_id, max(supplier_name) supplier_name, count(*) n from q group by supplier_id) x),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                'key', f.key,
                'grp', case f.kind when 'ukoblet' then 'kobling' else 'pakning' end,
                'type', 'varekort', 'kind', f.kind,
                'supplier_id', f.supplier_id, 'supplier_name', f.supplier_name, 'item_key', f.item_key,
                'invoice_id', null, 'invoice_number', null,
                'title', f.description, 'sku', f.supplier_sku, 'rm_id', f.linked_rm_id, 'rm_name', f.rm_name,
                'open_lines', f.open_lines, 'open_invoices', f.open_invoices, 'invoice_count', f.invoice_count,
                'amount', f.open_amount, 'impact_nok', null,
                'effect_status', 'unknown', 'effect_label', 'Kan ikke beregnes ennå',
                'read_integrity', 'unknown', 'read_integrity_flags', '[]'::jsonb,
                'last_date', f.last_seen, 'first_open_date', f.oldest_open, 'last_open_line_id', f.last_open_line_id,
                'reasons', to_jsonb(coalesce(array_remove(string_to_array(f.reasons_raw, ','), ''), '{}'::text[])))
              order by f.rn), '[]'::jsonb)
                from f
               where f.rn > greatest(p_offset, 0)
                 and f.rn <= greatest(p_offset, 0) + least(greatest(coalesce(p_limit, 50), 0), 200)),
    'generated_at', now())
  into v;
  return v;
end;
$function$;

revoke all on function public.rm_new_items_queue(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.rm_new_items_queue(uuid, uuid, integer, integer) to authenticated, service_role;

create or replace function public.rm_cap_nye_varer_v1()
returns boolean language sql immutable as $$ select true $$;
revoke all on function public.rm_cap_nye_varer_v1() from public, anon;
grant execute on function public.rm_cap_nye_varer_v1() to authenticated, service_role;
