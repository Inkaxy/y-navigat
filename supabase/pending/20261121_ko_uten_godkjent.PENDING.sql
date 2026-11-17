-- 20261121_ko_uten_godkjent.PENDING.sql — FORSLAG B (Henrik avgjør). IKKE KJØRT.
-- Alternativ til 20261121_kobling_godkjent_faktura.PENDING.sql. Kjør høyst ÉN av dem (filene stopper hverandre).
--
-- Hva: koblingen beholder dagens sperre (godkjent faktura kan ikke kobles), og KØEN følger samme regel:
-- en linje på en internt godkjent faktura, eller med aktiv ført kostpris, telles ikke som åpen i rm_work_items
-- og rm_new_items_queue. Da forsvinner de 47 leverandørvarene der alle linjene ligger på godkjente fakturaer
-- fra Nye varer, og de 14 delvise viser bare linjene som kan løses. Linjene ligger fortsatt på fakturaen og
-- kan løses der etter at godkjenningen er opphevet. Ingen data endres. Ingen gjenlesing/rematch startes.
-- Kjøres ETTER 20261119_nye_varer_les hvis begge skal kjøres (ellers mangler rm_new_items_queue-regelen).
begin;

do $$
declare d text; s_old text; s_new text;
  appr constant text := $x$ and not exists (select 1 from public.invoice_internal_approvals ap where ap.invoice_id = i.id and ap.status = 'approved')$x$;
begin
  if to_regprocedure('public.rm_cap_kobling_godkjent_v1()') is not null then
    raise exception 'Alternativ A (20261121_kobling_godkjent_faktura) er allerede kjørt – kjør ikke begge.';
  end if;
  s_old := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null) is_open$x$;

  d := pg_get_functiondef('public.rm_work_items(uuid,text,text,uuid,text,integer,integer)'::regprocedure);
  if md5(d) <> 'efe0f95ef98471bbfca5713d05960e27' then raise exception 'rm_work_items er endret siden 17.11 (md5 %)', md5(d); end if;
  s_new := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null$x$ || appr || $x$
             and not exists (select 1 from public.invoice_line_cost_postings cp where cp.invoice_line_id = il.id and cp.revoked_at is null)) is_open$x$;
  if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_work_items: is_open finnes ikke nøyaktig én gang'; end if;
  execute replace(d, s_old, s_new);

  -- rm_new_items_queue (fra 20261119, egen fil): samme regel når den finnes. Ført kost står alt på linjenivå der.
  if to_regprocedure('public.rm_new_items_queue(uuid,uuid,integer,integer)') is not null then
    d := pg_get_functiondef('public.rm_new_items_queue(uuid,uuid,integer,integer)'::regprocedure);
    s_new := $x$(i.status in ('imported','needs_review','ready') and i.flagged_at is null$x$ || appr || $x$) is_open$x$;
    if (length(d) - length(replace(d, s_old, ''))) <> length(s_old) then raise exception 'rm_new_items_queue: is_open finnes ikke nøyaktig én gang'; end if;
    execute replace(d, s_old, s_new);
  end if;
end $$;

create or replace function public.rm_cap_ko_uten_godkjent_v1()
returns boolean language sql stable security invoker set search_path = public as $$ select true $$;
revoke all on function public.rm_cap_ko_uten_godkjent_v1() from public, anon;
grant execute on function public.rm_cap_ko_uten_godkjent_v1() to authenticated, service_role;

commit;
