-- 20261121_kobling_godkjent_faktura.PENDING.sql — FORSLAG A (Henrik avgjør). IKKE KJØRT.
-- Alternativ til 20261121_ko_uten_godkjent.PENDING.sql. Kjør høyst ÉN av dem (filene stopper hverandre).
--
-- Hva: kobling/oppretting/«Ikke vare» via rm_link_supplier_item gjelder også linjer på fakturaer som er
-- godkjent internt, så lenge fakturaen er åpen (imported/needs_review/ready – ikke avstemt/excluded),
-- ikke flagget, linjen ikke er «not_applicable»/holdt utenfor og linjen ikke har aktiv ført kostpris.
-- Godkjenningen røres ikke. Fakturabeløp, mva, valuta, linjesum og fakturastatus endres ikke.
--
-- Endringer (bare eksakte tekstbytter bundet til live-md5 17.11.2026, hver tekst finnes nøyaktig én gang):
--  1. rm_confirm_line_match (md5 e2958f26…): «faktura_godkjent»-sperren gjelder fortsatt for alle direkte kall,
--     men hoppes over når den kalles fra rm_link_supplier_item i samme transaksjon (lokal innstilling
--     rm.link_approved='on', satt med set_config(..., true) og borte når transaksjonen slutter; kan ikke
--     settes av klienten via PostgREST).
--  2. rm_link_supplier_item (md5 acc4fdb1…): linjeutvalget forkaster ikke lenger linjer bare fordi fakturaen er
--     godkjent internt, og setter rm.link_approved før koblingen. Status/flagg/not_applicable/ført kost består.
--  3. rm_work_items (md5 efe0f95e…): en linje med aktiv ført kostpris telles ikke som åpen – samme regel som
--     koblingen, så køen aldri viser noe koblingen nekter. (rm_new_items_queue i 20261119 har samme regel.)
--  4. Ny markør public.rm_cap_kobling_godkjent_v1() – appen slutter å grå ut godkjente linjer først når den finnes.
-- Ingen data endres av selve filen. Ingen gjenlesing/rematch startes.
begin;

do $$
declare d text; n text; s_old text; s_new text;
begin
  if to_regprocedure('public.rm_cap_ko_uten_godkjent_v1()') is not null then
    raise exception 'Alternativ B (20261121_ko_uten_godkjent) er allerede kjørt – kjør ikke begge.';
  end if;

  -- 1. rm_confirm_line_match
  d := pg_get_functiondef('public.rm_confirm_line_match(uuid,uuid,numeric,text,numeric,boolean,numeric,boolean,uuid[],boolean)'::regprocedure);
  if md5(d) <> 'e2958f267da2cb5fc70f1af49c97d60a' then raise exception 'rm_confirm_line_match er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$  if exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved') then
    return jsonb_build_object('ok',false,'reason','faktura_godkjent');
  end if;
$x$;
  s_new := $x$  -- Intern godkjenning sperrer direkte kall. rm_link_supplier_item (samme transaksjon) kan koble linjer på
  -- en godkjent, fortsatt åpen faktura; beløp, mva, status og godkjenning endres ikke av koblingen.
  if exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved')
     and coalesce(current_setting('rm.link_approved', true), '') <> 'on' then
    return jsonb_build_object('ok',false,'reason','faktura_godkjent');
  end if;
$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_confirm_line_match: forventet tekst finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);

  -- 2. rm_link_supplier_item
  d := pg_get_functiondef('public.rm_link_supplier_item(uuid,uuid,text,uuid,jsonb,jsonb,boolean,boolean,text,uuid[])'::regprocedure);
  if md5(d) <> 'acc4fdb14510e96d4b21cb5b7e74d28a' then raise exception 'rm_link_supplier_item er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$      and not exists(select 1 from public.invoice_internal_approvals a where a.invoice_id=i.id and a.status='approved')
$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_link_supplier_item: godkjenningsfilteret finnes ikke nøyaktig én gang'; end if;
  n := replace(d, s_old, '');
  s_old := $x$  if v_scoped and cardinality(v_guard_line_ids)=0 then
$x$;
  s_new := $x$  -- Linjer på internt godkjente (åpne) fakturaer kan kobles; rm_confirm_line_match godtar dem bare herfra.
  perform set_config('rm.link_approved', 'on', true);
  if v_scoped and cardinality(v_guard_line_ids)=0 then
$x$;
  if (length(n) - length(replace(n, s_old, ''))) <> length(s_old) then raise exception 'rm_link_supplier_item: ankeret finnes ikke nøyaktig én gang'; end if;
  execute replace(n, s_old, s_new);

  -- 3. rm_work_items
  d := pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure);
  if md5(d) <> 'efe0f95ef98471bbfca5713d05960e27' then raise exception 'rm_work_items er endret siden 17.11 (md5 %)', md5(d); end if;
  s_old := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null) is_open$x$;
  s_new := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null
             and not exists (select 1 from public.invoice_line_cost_postings cp where cp.invoice_line_id = il.id and cp.revoked_at is null)) is_open$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_work_items: is_open finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);
end $$;

create or replace function public.rm_cap_kobling_godkjent_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;
revoke all on function public.rm_cap_kobling_godkjent_v1() from public, anon;
grant execute on function public.rm_cap_kobling_godkjent_v1() to authenticated, service_role;

commit;
