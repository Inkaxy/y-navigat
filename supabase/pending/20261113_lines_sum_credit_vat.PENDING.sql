-- VENTER PÅ ROOT – KJØRES IKKE AV AGENTEN.
-- Rettepakke fakturalesing 13.11.2026, punkt D (kreditnota) og E (mva 0 på fakturahodet).
-- Kontroll før/etter: 20261113_lines_sum_credit_vat.check.sql (bare SELECT).
--
-- D) Kreditnota: total_amount er ofte lagret positivt og linjene negativt (ASKO 330685033:
--    total 3612, mva 471, linjesum -3141 → -200 %). Ny 5-argumentsversjon av rm_lines_sum_check
--    sammenligner i linjenes fortegn NÅR fakturaen er kreditnota. Mva trekkes fra i totalens retning.
--    Vanlig faktura: uendret (kaller 4-argumentsversjonen). Størrelsesavvik fanges som før (2 % / 20 %).
--    De to kallerne (rm_correct_invoice_line, rm_apply_invoice_reread) får is_credit_note som 5. argument
--    ved eksakt tekstbytte i live-definisjonen; alt annet i funksjonene er uendret.
-- E) rm_finalize_invoice_line_extraction lagrer bilagets mva også når hodet hadde 0 og importen
--    eksplisitt melder total_vat_zero_replaced=true (bilaget viser inngående mva). Aldri fra linjesummen.
--
-- Forutsetning (md5 av live pg_get_functiondef lest 13.11.2026). Avviker en, stopper hele filen.
--   rm_correct_invoice_line(uuid,timestamptz,jsonb,text,boolean,boolean)  2309db2c778a0db23c2f6bee2852cf86
--   rm_apply_invoice_reread(uuid,jsonb,text)                              dc58b00ca0774c576f7fa8c8c044df4d
--   rm_finalize_invoice_line_extraction(uuid,uuid,jsonb,jsonb)            e2d12782ccbe9b5cd7a3211fa4e9724c
--   rm_lines_sum_check(numeric,integer,numeric,numeric)                   531e59387ca1103d33d6095ab6ca0a08 (røres ikke)
-- Ingen data endres. Lagrede sumstatuser oppdateres først når en faktura kontrolleres på nytt.

begin;

create or replace function public.rm_lines_sum_check(p_sum numeric, p_count integer, p_total numeric, p_vat numeric, p_is_credit boolean)
 returns jsonb
 language plpgsql
 immutable
 set search_path to 'public'
as $function$
declare v_exp numeric; v_tol numeric; v_var numeric; v_sum numeric;
begin
  if not coalesce(p_is_credit, false) then
    return public.rm_lines_sum_check(p_sum, p_count, p_total, p_vat);
  end if;
  if coalesce(p_count, 0) = 0 then
    return jsonb_build_object('lines_sum_excl_vat', null, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_lines');
  end if;
  v_sum := round(coalesce(p_sum, 0), 2);
  if p_total is null or not public.rm_is_finite(p_total) or p_total = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  -- Kreditnota: mva følger totalens fortegn (total 3612 / -3612 med mva lagret som 471).
  if p_vat is not null and public.rm_is_finite(p_vat) then v_exp := p_total - sign(p_total) * abs(p_vat); v_tol := 2; else v_exp := p_total; v_tol := 20; end if;
  -- Motsatt fortegn mellom total og linjer er bare lagringsform på kreditnota; størrelsen kontrolleres som før.
  if v_sum <> 0 and v_exp <> 0 and sign(v_exp) <> sign(v_sum) then v_exp := -v_exp; end if;
  if v_exp = 0 then
    return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', null, 'lines_sum_status', 'no_total');
  end if;
  v_var := round((v_sum - v_exp) / v_exp * 100, 3);
  return jsonb_build_object('lines_sum_excl_vat', v_sum, 'lines_sum_variance_pct', v_var,
    'lines_sum_status', case when abs(v_var) <= v_tol then 'ok' else 'mismatch' end);
end $function$;

revoke all on function public.rm_lines_sum_check(numeric, integer, numeric, numeric, boolean) from public, anon;
grant execute on function public.rm_lines_sum_check(numeric, integer, numeric, numeric, boolean) to authenticated, service_role;

do $do$
declare
  d text; n int;
  v_sig regprocedure;
  v_old text; v_new text; v_md5 text;
begin
  -- 1) rm_correct_invoice_line
  v_sig := 'public.rm_correct_invoice_line(uuid,timestamp with time zone,jsonb,text,boolean,boolean)'::regprocedure;
  d := pg_get_functiondef(v_sig);
  if md5(d) <> '2309db2c778a0db23c2f6bee2852cf86' then raise exception 'rm_correct_invoice_line er endret siden 13.11.2026 (md5 %)', md5(d); end if;
  v_old := 'rm_lines_sum_check(sum(total_amount), count(*)::int, v.total_amount, v.total_vat)';
  v_new := 'rm_lines_sum_check(sum(total_amount), count(*)::int, v.total_amount, v.total_vat, coalesce(v.is_credit_note, false))';
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'rm_correct_invoice_line: forventet ett kall, fant %', n; end if;
  execute replace(d, v_old, v_new);

  -- 2) rm_apply_invoice_reread
  v_sig := 'public.rm_apply_invoice_reread(uuid,jsonb,text)'::regprocedure;
  d := pg_get_functiondef(v_sig);
  if md5(d) <> 'dc58b00ca0774c576f7fa8c8c044df4d' then raise exception 'rm_apply_invoice_reread er endret siden 13.11.2026 (md5 %)', md5(d); end if;
  v_old := 'rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat)';
  v_new := 'rm_lines_sum_check(sum(total_amount),count(*)::int,v.total_amount,v.total_vat,coalesce(v.is_credit_note,false))';
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'rm_apply_invoice_reread: forventet ett kall, fant %', n; end if;
  execute replace(d, v_old, v_new);

  -- 3) rm_finalize_invoice_line_extraction: mva 0 på hodet erstattes bare når importen melder det eksplisitt.
  v_sig := 'public.rm_finalize_invoice_line_extraction(uuid,uuid,jsonb,jsonb)'::regprocedure;
  d := pg_get_functiondef(v_sig);
  if md5(d) <> 'e2d12782ccbe9b5cd7a3211fa4e9724c' then raise exception 'rm_finalize_invoice_line_extraction er endret siden 13.11.2026 (md5 %)', md5(d); end if;
  v_old := 'total_vat = case when total_vat is null and (p_invoice->>''total_vat_from_postings'') is not null then';
  v_new := 'total_vat = case when (total_vat is null or (total_vat = 0 and p_invoice->>''total_vat_zero_replaced'' = ''true'')) and (p_invoice->>''total_vat_from_postings'') is not null then';
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'finalize (total_vat): forventet én forekomst, fant %', n; end if;
  d := replace(d, v_old, v_new);
  v_old := 'vat_inferred = case when total_vat is null and (p_invoice->>''total_vat_from_postings'') is not null then true';
  v_new := 'vat_inferred = case when (total_vat is null or (total_vat = 0 and p_invoice->>''total_vat_zero_replaced'' = ''true'')) and (p_invoice->>''total_vat_from_postings'') is not null then true';
  n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
  if n <> 1 then raise exception 'finalize (vat_inferred): forventet én forekomst, fant %', n; end if;
  execute replace(d, v_old, v_new);
end $do$;

commit;
