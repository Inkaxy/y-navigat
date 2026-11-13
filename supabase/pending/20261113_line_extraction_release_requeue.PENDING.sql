-- VENTER PÅ ROOT – KJØRES IKKE AV AGENTEN.
-- Rettepakke fakturalesing 13.11.2026, punkt A og I.
-- Kontroll før/etter: 20261113_line_extraction_release_requeue.check.sql (bare SELECT).
--
-- A) rm_fail_invoice_line_extraction: når importen melder release_attempt=true (AI-tjenesten feilet på
--    nøkkel/kvote/nede/nettverk/oppsett – ikke fakturaens feil), telles ikke forsøket. Eksakt tekstbytte
--    i live-definisjonen; alt annet er uendret. Uten feltet: som før.
-- I) Ny rm_requeue_invoice_line_extraction: legger fakturaer UTEN linjer tilbake i den vanlige lesekøen
--    (brukes fra «Les på nytt i bolk», gruppe 1: «ingen lesbare linjer» etter at nøkkelen sluttet å virke).
--    Skriverett kreves, maks 200 per kall. Rører bare køfeltene. Hopper over fakturaer med linjer,
--    rettelser, ført kostpris, intern godkjenning, avstemming (_rm_invoice_extraction_blocker),
--    holdt utenfor, uten Tripletex-id eller som leses nå. Linjer skrives senere av den vanlige importen
--    med samme vakter som i dag. Ingen data endres av selve filen.
--
-- Forutsetning: rm_fail_invoice_line_extraction(uuid,uuid,jsonb) md5 cb553c3def46e26a75e50ddd7d7758eb.

begin;

do $do$
declare d text; n int; v_old text; v_new text;
begin
  d := pg_get_functiondef('public.rm_fail_invoice_line_extraction(uuid,uuid,jsonb)'::regprocedure);
  if md5(d) <> 'cb553c3def46e26a75e50ddd7d7758eb' then raise exception 'rm_fail_invoice_line_extraction er endret siden 13.11.2026 (md5 %)', md5(d); end if;
  v_old := 'line_extraction_at = now(), line_extraction_token = null,';
  v_new := 'line_extraction_at = now(), line_extraction_token = null,' || chr(10) ||
           '    line_extraction_attempts = case when p_patch->>''release_attempt'' = ''true'' then greatest(line_extraction_attempts - 1, 0) else line_extraction_attempts end,';
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'rm_fail_invoice_line_extraction: forventet én forekomst, fant %', n; end if;
  execute replace(d, v_old, v_new);
end $do$;

create or replace function public.rm_requeue_invoice_line_extraction(p_legal_entity_id uuid, p_invoice_ids uuid[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_id uuid; v invoices%rowtype; b text;
  v_done int := 0; v_skipped jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  if p_legal_entity_id is null then raise exception 'legal_entity_id mangler' using errcode = '22023'; end if;
  if not public.has_ravarer_invoice_access(p_legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_invoice_ids is null or cardinality(p_invoice_ids) = 0 then
    return jsonb_build_object('ok', true, 'requeued', 0, 'skipped', '[]'::jsonb);
  end if;
  if cardinality(p_invoice_ids) > 200 then raise exception 'Maks 200 fakturaer per kall' using errcode = '22023'; end if;

  foreach v_id in array (select array_agg(distinct x) from unnest(p_invoice_ids) x) loop
    select * into v from invoices where id = v_id and legal_entity_id = p_legal_entity_id for update;
    if not found then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', 'finnes_ikke'); continue;
    end if;
    if v.tripletex_supplier_invoice_id is null then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', 'ikke_tripletex'); continue;
    end if;
    if v.status = 'excluded' then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', 'holdt_utenfor'); continue;
    end if;
    if v.line_extraction_status not in ('done', 'failed') then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', 'ikke_ferdig_lest'); continue;
    end if;
    if v.line_extraction_token is not null and v.line_extraction_at > now() - interval '10 minutes' then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', 'leses_na'); continue;
    end if;
    b := public._rm_invoice_extraction_blocker(v_id);
    if b is not null then
      v_skipped := v_skipped || jsonb_build_object('invoice_id', v_id, 'reason', b); continue;
    end if;
    update invoices set
      line_extraction_status = 'pending',
      line_extraction_attempts = 0,
      line_extraction_error = null,
      line_extraction_token = null,
      line_extraction_at = null
     where id = v_id;
    v_done := v_done + 1;
  end loop;
  return jsonb_build_object('ok', true, 'requeued', v_done, 'skipped', v_skipped);
end $function$;

revoke all on function public.rm_requeue_invoice_line_extraction(uuid, uuid[]) from public, anon;
grant execute on function public.rm_requeue_invoice_line_extraction(uuid, uuid[]) to authenticated;

commit;
