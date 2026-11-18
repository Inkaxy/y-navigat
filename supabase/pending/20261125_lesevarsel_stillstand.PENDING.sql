-- VENTER PÅ ROOT – KJØRES IKKE AV AGENTEN. Kontroll: 20261125_lesevarsel_stillstand.check.sql (bare SELECT).
-- Punkt 5b (bestilling 18.11.2026): e-post til eier når fakturalesingen har stått stille i minst 24 timer
-- med fakturaer i kø, eller når minst 30 % av minst 5 lesinger siste døgn feilet.
--
-- Forutsetter 20261113_invoice_reading_alert_template (malen «invoice_reading_stopped»). Uten aktiv mal
-- legges ingenting i køen og funksjonen svarer {"queued":false,"reason":"no_template"}.
-- Mottaker settes av serveren (henrik@nottero-bakeri.no), som i den utrullede leseren (aiGate.ts).
-- Høyst én e-post per feiltype per døgn (samme regel som leserens eget varsel).
-- Bare additivt: én ny funksjon. Ingen tabeller, ingen rader endres. p_dry_run er standard sann.
-- Selve tidsplanen (pg_cron) står kommentert nederst og legges bare inn etter Henriks ja.
-- Rull tilbake: drop function public.rm_reading_stall_check(boolean);

begin;

create or replace function public.rm_reading_stall_check(p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_le uuid;
  v_last timestamptz;
  v_pending int;
  v_attempts int;
  v_failed int;
  v_kind text;
  v_msg text;
  v_tpl boolean;
begin
  -- Ett firma (Nøtterø Bakeri): regn over alle fakturaer i den ene juridiske enheten.
  select max(line_extraction_at) into v_last from invoices where line_extraction_status = 'done';
  select count(*) into v_pending from invoices where line_extraction_status = 'pending';
  select count(*) filter (where line_extraction_status in ('done','failed')),
         count(*) filter (where line_extraction_status = 'failed')
    into v_attempts, v_failed
    from invoices where line_extraction_at >= now() - interval '24 hours';

  if v_pending > 0 and (v_last is null or v_last <= now() - interval '24 hours') then
    v_kind := 'stillstand';
    v_msg := format('Ingen faktura er lest ferdig siden %s, og %s faktura(er) venter i lesekøen.',
      coalesce(to_char(v_last at time zone 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'), 'ukjent'), v_pending);
  elsif v_attempts >= 5 and v_failed * 100 >= 30 * v_attempts then
    v_kind := 'feilrate';
    v_msg := format('%s av %s lesinger siste døgn feilet.', v_failed, v_attempts);
  else
    return jsonb_build_object('queued', false, 'reason', 'ok', 'pending', v_pending, 'attempts_24h', v_attempts, 'failed_24h', v_failed);
  end if;

  if exists (select 1 from email_outbox where template_key = 'invoice_reading_stopped'
               and variables->>'feiltype' = v_kind and created_at > now() - interval '24 hours') then
    return jsonb_build_object('queued', false, 'reason', 'already_sent_today', 'kind', v_kind);
  end if;
  select is_active into v_tpl from email_templates where template_key = 'invoice_reading_stopped';
  if v_tpl is distinct from true then
    return jsonb_build_object('queued', false, 'reason', 'no_template', 'kind', v_kind, 'message', v_msg);
  end if;
  if p_dry_run then
    return jsonb_build_object('queued', false, 'reason', 'dry_run', 'kind', v_kind, 'message', v_msg);
  end if;

  insert into email_outbox (template_key, recipient_email, related_entity_type, variables)
  values ('invoice_reading_stopped', 'henrik@nottero-bakeri.no', 'invoice_reading_alert',
    jsonb_build_object('feiltype', v_kind, 'feilmelding', v_msg,
      'siste_vellykkede', coalesce(to_char(v_last at time zone 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'), 'ukjent'),
      'tidspunkt', to_char(now() at time zone 'Europe/Oslo', 'DD.MM.YYYY HH24:MI'),
      'lenke', 'https://nbhub.no/ravarer/innstillinger?seksjon=fakturalesing'));
  return jsonb_build_object('queued', true, 'kind', v_kind, 'message', v_msg);
end;
$$;

revoke all on function public.rm_reading_stall_check(boolean) from public, anon, authenticated;
grant execute on function public.rm_reading_stall_check(boolean) to service_role;

commit;

-- TIDSPLAN – bare etter Henriks ja (én gang i timen, kvarter over):
-- select cron.schedule('rm-lesevarsel-stillstand', '15 * * * *', $c$select public.rm_reading_stall_check(false)$c$);
-- Fjern igjen: select cron.unschedule('rm-lesevarsel-stillstand');
