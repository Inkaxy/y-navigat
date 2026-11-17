-- PENDING 20261119_godta_sum – «Godta som den er» for fakturaer der linjene er lest, men summen ikke stemmer.
-- Kjøres av root. Bare tillegg: tre nye funksjoner. Ingen tabeller, kolonner, begrensninger eller data endres,
-- og ingen eksisterende funksjon røres.
--
-- Dagens «Overstyr med begrunnelse» på fakturasiden skriver direkte fra nettleseren (lines_sum_status='ok' + notat),
-- uten revisjonslogg og uten angring. Denne veien gjør det samme på serveren, med:
--   * kategori (avgift/pant/frakt/øreavrunding/annet) og begrunnelse, lagret i audit_log og som notat på fakturaen
--   * versjonskontroll (updated_at sendes som rå tekst og sammenlignes som tidsstempel, ingen avrunding) og gjentaksnøkkel (op_id): samme op_id gir samme svar, aldri dobbelt
--   * angring (rm_undo_accept_invoice_sum) så lenge fakturaen ikke er endret, godkjent, avstemt eller har ført kost
-- Status settes til 'ok' fordi invoices_lines_sum_status_check ikke tillater 'overridden' (begrensningen røres ikke).
-- Fakturaer med lesevarselet «sumavvik_mva_forhold» avvises: å godta ville fjernet varselet (triggeren
-- trg_invoices_read_issues rydder det ved statusbytte), og et mva-lignende forhold kan være en manglende linje.
-- Merk: statusbyttet trigger trg_rm_price_invoice_integrity (ny prisberegning for råvarer med prishistorikk fra
-- fakturaen), nøyaktig som dagens overstyring.

create or replace function public.rm_accept_invoice_sum(
  p_invoice_id uuid, p_category text, p_reason text, p_expected_updated_at text, p_op_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v invoices%rowtype; v_uid uuid := auth.uid(); v_prev audit_log%rowtype; v_audit uuid; v_new_upd timestamptz;
  v_label text; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_note text; v_exp numeric;
begin
  if v_uid is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  if p_invoice_id is null or p_op_id is null then raise exception 'Faktura og op_id må oppgis' using errcode = '22023'; end if;
  v_label := case p_category when 'avgift' then 'Avgifter/gebyr som ikke er varelinjer' when 'pant' then 'Pant'
    when 'frakt' then 'Frakt' when 'avrunding' then 'Øreavrunding' when 'annet' then 'Annet' end;
  if v_label is null then raise exception 'Ukjent kategori' using errcode = '22023'; end if;
  if p_category = 'annet' and (v_reason is null or length(v_reason) < 3) then
    raise exception 'Skriv en kort begrunnelse' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 500 then raise exception 'Begrunnelsen er for lang' using errcode = '22023'; end if;

  -- Gjentak: samme op_id gir samme svar.
  select * into v_prev from audit_log
   where action = 'invoice.sum_accepted' and entity_id = p_invoice_id and changes->>'op_id' = p_op_id::text
   order by occurred_at desc limit 1;
  if found then
    return jsonb_build_object('ok', true, 'replay', true, 'invoice_id', p_invoice_id, 'audit_id', v_prev.id);
  end if;

  select * into v from invoices where id = p_invoice_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if not public.has_ravarer_invoice_access(v.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  if p_expected_updated_at is null or v.updated_at is distinct from p_expected_updated_at::timestamptz then
    return jsonb_build_object('ok', false, 'code', 'endret', 'updated_at', v.updated_at::text);
  end if;
  if v.lines_sum_status is distinct from 'mismatch' then return jsonb_build_object('ok', false, 'code', 'ikke_avvik'); end if;
  if v.status not in ('imported','needs_review','ready') or v.excluded_at is not null or v.flagged_at is not null then
    return jsonb_build_object('ok', false, 'code', 'faktura_last');
  end if;
  if not exists (select 1 from invoice_lines where invoice_id = v.id) then return jsonb_build_object('ok', false, 'code', 'ingen_linjer'); end if;
  if exists (select 1 from jsonb_array_elements(coalesce(v.extraction_issues, '[]'::jsonb)) e where e->>'code' = 'sumavvik_mva_forhold') then
    return jsonb_build_object('ok', false, 'code', 'mva_forhold');
  end if;

  v_exp := case when v.total_vat is null then null else v.total_amount - v.total_vat end;
  v_note := format('[%s] Sumavvik godtatt (%s)%s', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'), v_label,
                   case when v_reason is null then '' else ': ' || v_reason end);
  update invoices set lines_sum_status = 'ok',
         notes = case when coalesce(btrim(notes), '') = '' then v_note else notes || E'\n' || v_note end
   where id = v.id
  returning updated_at into v_new_upd;

  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice.sum_accepted', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('op_id', p_op_id, 'category', p_category,
            'old', jsonb_build_object('lines_sum_status', v.lines_sum_status, 'updated_at', v.updated_at::text),
            'new', jsonb_build_object('lines_sum_status', 'ok', 'updated_at', v_new_upd::text),
            'lines_sum_excl_vat', v.lines_sum_excl_vat, 'total_amount', v.total_amount, 'total_vat', v.total_vat,
            'difference', case when v_exp is null or v.lines_sum_excl_vat is null then null else round(v.lines_sum_excl_vat - v_exp, 2) end,
            'note', v_note),
          coalesce(v_reason, v_label), 'ravarer')
  returning id into v_audit;

  return jsonb_build_object('ok', true, 'replay', false, 'invoice_id', v.id, 'audit_id', v_audit, 'updated_at', v_new_upd::text);
end $function$;

create or replace function public.rm_undo_accept_invoice_sum(p_audit_id uuid, p_op_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v invoices%rowtype; a audit_log%rowtype; v_uid uuid := auth.uid(); v_note text; v_audit uuid;
begin
  if v_uid is null then raise exception 'Ikke innlogget' using errcode = '42501'; end if;
  if p_audit_id is null or p_op_id is null then raise exception 'Hendelse og op_id må oppgis' using errcode = '22023'; end if;
  select * into a from audit_log where id = p_audit_id and action = 'invoice.sum_accepted';
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if exists (select 1 from audit_log where action = 'invoice.sum_accept_undone' and changes->>'accept_audit_id' = p_audit_id::text) then
    if exists (select 1 from audit_log where action = 'invoice.sum_accept_undone' and changes->>'accept_audit_id' = p_audit_id::text
                and changes->>'op_id' = p_op_id::text) then
      return jsonb_build_object('ok', true, 'replay', true, 'invoice_id', a.entity_id);
    end if;
    return jsonb_build_object('ok', false, 'code', 'allerede_angret');
  end if;

  select * into v from invoices where id = a.entity_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'finnes_ikke'); end if;
  if not public.has_ravarer_invoice_access(v.legal_entity_id, 'write') then
    raise exception 'Mangler skrivetilgang til fakturaer' using errcode = '42501';
  end if;
  -- Bare uendret faktura: samme versjon som godkjenningen ga, og ikke låst siden.
  if v.updated_at is distinct from (a.changes->'new'->>'updated_at')::timestamptz or v.lines_sum_status is distinct from 'ok' then
    return jsonb_build_object('ok', false, 'code', 'endret_siden');
  end if;
  if v.status not in ('imported','needs_review','ready') or v.reconciled_at is not null
     or exists (select 1 from invoice_internal_approvals x where x.invoice_id = v.id and x.revoked_at is null)
     or exists (select 1 from invoice_line_cost_postings x where x.invoice_id = v.id and x.revoked_at is null) then
    return jsonb_build_object('ok', false, 'code', 'faktura_last');
  end if;

  v_note := format('[%s] Godtatt sumavvik angret', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'));
  update invoices set lines_sum_status = coalesce(a.changes->'old'->>'lines_sum_status', 'mismatch'),
         notes = case when coalesce(btrim(notes), '') = '' then v_note else notes || E'\n' || v_note end
   where id = v.id;
  insert into audit_log (user_id, action, entity_type, entity_id, entity_display_reference, legal_entity_id, changes, reason, source_app)
  values (v_uid, 'invoice.sum_accept_undone', 'invoice', v.id, v.invoice_number, v.legal_entity_id,
          jsonb_build_object('op_id', p_op_id, 'accept_audit_id', p_audit_id), 'Angret godtatt sumavvik', 'ravarer')
  returning id into v_audit;
  return jsonb_build_object('ok', true, 'replay', false, 'invoice_id', v.id, 'audit_id', v_audit);
end $function$;

create or replace function public.rm_cap_godta_sum_v1()
returns boolean language sql immutable as $$ select true $$;

revoke all on function public.rm_accept_invoice_sum(uuid, text, text, text, uuid) from public, anon;
revoke all on function public.rm_undo_accept_invoice_sum(uuid, uuid) from public, anon;
revoke all on function public.rm_cap_godta_sum_v1() from public, anon;
grant execute on function public.rm_accept_invoice_sum(uuid, text, text, text, uuid) to authenticated, service_role;
grant execute on function public.rm_undo_accept_invoice_sum(uuid, uuid) to authenticated, service_role;
grant execute on function public.rm_cap_godta_sum_v1() to authenticated, service_role;
