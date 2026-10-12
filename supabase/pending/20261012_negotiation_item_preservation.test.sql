-- PENDING TEST — run only in an isolated database AFTER the pending proposal is applied there.
-- Single session; all changes roll back via the final exception. Concurrency schedules
-- (replacement-first / issuance-first in two sessions) must be checked separately —
-- this file does not establish them.
do $$
declare
  le uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  sup uuid; rm uuid; neg uuid; neg2 uuid; item uuid; rec uuid; r text := ''; ok boolean;
begin
  insert into suppliers(legal_entity_id,name) values (le,'ZZ neg test') returning id into sup;
  select id into rm from raw_materials where legal_entity_id = le limit 1;
  insert into negotiations(legal_entity_id,title,status,created_by)
    values (le,'ZZ draft',  'draft', (select user_id from user_positions limit 1)) returning id into neg;
  insert into negotiations(legal_entity_id,title,status,created_by)
    values (le,'ZZ other',  'draft', (select user_id from user_positions limit 1)) returning id into neg2;

  -- a) pristine draft replacement works
  r := r || 'draft=' || public.replace_child_rows('negotiation_items','negotiation_id',neg,
        jsonb_build_array(jsonb_build_object('negotiation_id',neg,'raw_material_id',rm,'sort_order',0)));

  -- b) alternate-parent payload blocked
  begin
    perform public.replace_child_rows('negotiation_items','negotiation_id',neg,
      jsonb_build_array(jsonb_build_object('negotiation_id',neg2,'raw_material_id',rm,'sort_order',0)));
    r := r || ' alt=ALLOWED';
  exception when sqlstate '22023' then r := r || ' alt=blocked'; end;

  -- c) issued (recipient invited) -> replacement and same-id delete/reinsert rejected
  select id into item from negotiation_items where negotiation_id = neg;
  insert into negotiation_recipients(negotiation_id,supplier_id,invited_at) values (neg,sup,now()) returning id into rec;
  begin
    perform public.replace_child_rows('negotiation_items','negotiation_id',neg,
      jsonb_build_array(jsonb_build_object('id',item,'negotiation_id',neg,'raw_material_id',rm,'sort_order',0)));
    r := r || ' issued=ALLOWED';
  exception when sqlstate '55000' then r := r || ' issued=blocked'; end;
  begin
    delete from negotiation_items where id = item;
    r := r || ' delete=ALLOWED';
  exception when sqlstate '55000' then r := r || ' delete=blocked'; end;

  -- d) removed issued recipient cannot reopen replacement (status already invited / evidence)
  update negotiations set status = 'invited' where id = neg;
  delete from negotiation_recipients where id = rec;
  begin
    perform public.replace_child_rows('negotiation_items','negotiation_id',neg,'[]'::jsonb);
    r := r || ' reopen=ALLOWED';
  exception when sqlstate '55000' then r := r || ' reopen=blocked'; end;

  -- e) non-draft -> draft reset rejected
  begin
    update negotiations set status = 'draft' where id = neg;
    r := r || ' reset=ALLOWED';
  exception when sqlstate '55000' then r := r || ' reset=blocked'; end;

  -- f) genuine parent cascade still succeeds
  delete from negotiations where id = neg;
  ok := not exists (select 1 from negotiation_items where id = item);
  r := r || ' cascade=' || ok;

  raise exception 'RESULT %', r;
end $$;
-- Expected: RESULT draft=1 alt=blocked issued=blocked delete=blocked reopen=blocked reset=blocked cascade=true
