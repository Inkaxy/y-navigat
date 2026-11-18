-- 20261124_raske_oppslag_del1.PENDING.sql — IKKE KJØRT. Kjøres av root etter Henriks ja. Del 1 av 2 (< 15 kB), kan kjøres alene.
--
-- ROTÅRSAK (målt 18.11 i pg_stat_statements og EXPLAIN ANALYZE mot live):
--  * Dataene er små (793 fakturaer, 5 561 linjer). Selve spørringene tar 1–3 ms uten radsikkerhet.
--  * Menyen i Råvarer kaller rm_work_summary på HVER side og hvert minutt (5 072 kall, snitt 1 757 ms, maks 7,9 s) bare
--    for tre små merker (databladendringer, avtaler som utløper, lager under min). rm_work_summary regner samtidig hele
--    leverandørvarekøen og godkjenningsblokkere for alle fakturaer.
--  * Prishopp og Ikke lest leser invoice_lines/invoices direkte. Radsikkerheten kaller da en tilgangsfunksjon PER RAD
--    (invoice_lines → invoices → has_ravarer_invoice_read_or_owner); det er den som gir sekunder, ikke dataene.
--  * Mange tunge kall samtidig gjør alt annet tregt (kø i databasen).
--
-- HVA SOM LEGGES TIL (bare nye funksjoner; ingen tabeller, ingen RLS, ingen eksisterende funksjon endres, ingen rader skrives):
--  1. rm_nav_counts(le)        – menyens tre merker. Samme regler som i rm_work_summary (data_quality.datasheet_changes,
--                                other.agreements_expiring_30d, other.stock_below_min). Målt kjerne: 0,6 ms.
--  2. rm_price_jump_lines(le)  – nøyaktig de radene Prishopp henter i dag (åpne prislinjer med avvik på åpne, ikke-flaggede
--                                fakturaer), med fakturanr./dato/leverandør og varenavn. Grensen per vare brukes som før i appen.
--                                Målt kjerne: 3,3 ms.
--  3. rm_unread_invoices(le)   – nøyaktig de fakturaene Ikke lest henter i dag (åpne, ikke utelatt/flagget, lesing feilet /
--                                lesefeil / sum stemmer ikke) med antall linjer. Appen filtrerer og sorterer som før. Målt: 1,0 ms.
--  Tilgang kontrolleres ÉN gang per kall med de samme funksjonene som radsikkerheten bruker:
--   prishopp/ikke lest: has_ravarer_invoice_read_or_owner (= SELECT-policyen på invoices/invoice_lines);
--   meny: has_ravarer_access(…,'read') (= SELECT-policyen på raw_materials/raw_material_suppliers).
--   (Uten innlogget bruker – bare service/root, anon har ikke kjørerett – som i rm_work_summary.)
--   Mangler tilgang: feilkode 42501 (ingen tom liste som ser ut som «ingenting å gjøre»).
--  4. Markør rm_cap_raske_oppslag_v1(). Appen bruker de nye oppslagene FØRST når den finnes; før det virker alt som i dag.
--
-- Kontroll: 20261124_raske_oppslag_del1.check.sql (før/etter, md5 av alle funksjonskropper, tidsmåling).
begin;

do $$ begin
  if to_regprocedure('public.rm_cap_raske_oppslag_v1()') is not null then raise exception 'Del 1 er allerede kjørt (rm_cap_raske_oppslag_v1 finnes).'; end if;
  if to_regprocedure('public.rm_nav_counts(uuid)') is not null or to_regprocedure('public.rm_price_jump_lines(uuid)') is not null
     or to_regprocedure('public.rm_unread_invoices(uuid)') is not null then raise exception 'En av de nye funksjonene finnes allerede – kontroller før kjøring.'; end if;
  if to_regprocedure('public.has_ravarer_invoice_read_or_owner(uuid)') is null or to_regprocedure('public.has_ravarer_access(uuid,uuid,access_level)') is null then
    raise exception 'Tilgangsfunksjonene mangler.'; end if;
end $$;

create function public.rm_nav_counts(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_ravarer_access(auth.uid(), p_legal_entity_id, 'read') then
    raise exception 'Ingen tilgang til Råvarer' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ok', true,
    'datasheet_changes', (select count(*) from raw_material_changelog c
                           where c.legal_entity_id = p_legal_entity_id and not c.acknowledged and c.severity in ('high','medium')),
    'agreements_expiring_30d', (select count(*) from raw_material_suppliers s join raw_materials r on r.id = s.raw_material_id
                                 where r.legal_entity_id = p_legal_entity_id and s.agreed_price_per_base_unit is not null
                                   and s.agreement_valid_to between current_date and current_date + 30),
    'stock_below_min', (select count(*) from raw_material_stock_status s
                         where s.legal_entity_id = p_legal_entity_id and s.min_stock is not null and s.current_stock < s.min_stock),
    'generated_at', now());
end $$;

create function public.rm_price_jump_lines(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_ravarer_invoice_read_or_owner(p_legal_entity_id) then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', il.id, 'invoice_id', il.invoice_id, 'raw_material_id', il.raw_material_id,
             'supplier_sku', il.supplier_sku, 'description', il.description,
             'price_per_base_unit', il.price_per_base_unit, 'expected_price_per_base_unit', il.expected_price_per_base_unit,
             'price_variance_pct', il.price_variance_pct, 'review_reason', il.review_reason,
             'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'supplier_id', i.supplier_id,
             'rm_name', rm.name, 'rm_base_unit', rm.base_unit, 'rm_item_type', rm.item_type)
           order by il.id)
      from invoice_lines il
      join invoices i on i.id = il.invoice_id
      left join raw_materials rm on rm.id = il.raw_material_id
     where i.legal_entity_id = p_legal_entity_id
       and i.status in ('imported','needs_review','ready') and i.flagged_at is null
       and il.requires_review and il.excluded_at is null
       and il.price_variance_pct is not null and il.raw_material_id is not null), '[]'::jsonb));
end $$;

create function public.rm_unread_invoices(p_legal_entity_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.has_ravarer_invoice_read_or_owner(p_legal_entity_id) then
    raise exception 'Ingen fakturatilgang for dette selskapet' using errcode = '42501';
  end if;
  return jsonb_build_object('ok', true, 'generated_at', now(), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', i.id, 'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'supplier_id', i.supplier_id,
             'total_amount', i.total_amount, 'total_vat', i.total_vat, 'is_credit_note', i.is_credit_note,
             'lines_sum_excl_vat', i.lines_sum_excl_vat, 'updated_at', i.updated_at,
             'line_extraction_status', i.line_extraction_status, 'line_extraction_error', i.line_extraction_error,
             'lines_sum_status', i.lines_sum_status, 'tripletex_supplier_invoice_id', i.tripletex_supplier_invoice_id,
             'line_count', (select count(*) from invoice_lines l where l.invoice_id = i.id))
           order by i.id)
      from invoices i
     where i.legal_entity_id = p_legal_entity_id
       and i.status in ('imported','needs_review','ready') and i.excluded_at is null and i.flagged_at is null
       and (i.line_extraction_status = 'failed' or i.line_extraction_error is not null or i.lines_sum_status = 'mismatch')), '[]'::jsonb));
end $$;

create function public.rm_cap_raske_oppslag_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;

revoke all on function public.rm_nav_counts(uuid) from public, anon;
revoke all on function public.rm_price_jump_lines(uuid) from public, anon;
revoke all on function public.rm_unread_invoices(uuid) from public, anon;
revoke all on function public.rm_cap_raske_oppslag_v1() from public, anon;
grant execute on function public.rm_nav_counts(uuid) to authenticated, service_role;
grant execute on function public.rm_price_jump_lines(uuid) to authenticated, service_role;
grant execute on function public.rm_unread_invoices(uuid) to authenticated, service_role;
grant execute on function public.rm_cap_raske_oppslag_v1() to authenticated, service_role;

commit;
