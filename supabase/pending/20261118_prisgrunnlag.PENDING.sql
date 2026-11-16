-- =====================================================================================
-- PENDING 18.11.2026 · Variant B fase 5 · Prisgrunnlag: emballasje i Brutto og DG2
-- Kjøres av root etter Henriks ja. Additivt + to md5-bundne tekstbytter. Endrer eller sletter
-- INGEN eksisterende data. Henrik har ikke bekreftet valget; innstillingen kan snus uten ny SQL.
--
--  1. entity_calc_settings.packaging_in_margins (null = på): emballasje i kalkylen (oppskriftens
--     emballasjelinjer, recipe_packaging_lines) trekkes fra i både Brutto og DG2, og tas med i
--     nødvendig pris. false = dagens regel (emballasje holdes utenfor marginene).
--  2. calc_packaging_in_margins(product_id): leser innstillingen for varens selskap.
--  3. h4_margin_eval (live md5 da19eefad08a54909ed6b87149b37845, lest 16.11.2026): råvarekost i
--     marginen = raw_cost + packaging_cost når innstillingen er på. Brukes av profitability_sheet.
--  4. product_margins (live md5 1c4d594c42078a473b825d69a2624b3d, lest 16.11.2026): samme regel,
--     og svaret får feltet packaging_in_margins slik at skjermbildene vet hvilken regel som gjelder.
--     Stopper hele filen hvis en av definisjonene er endret siden 16.11.
--  5. varer_cap_prisgrunnlag_v1().
-- Merk: i dag finnes 0 emballasjelinjer, så ingen margin endres ved selve kjøringen.
-- =====================================================================================
begin;

alter table public.entity_calc_settings
  add column if not exists packaging_in_margins boolean null;

create or replace function public.calc_packaging_in_margins(p_product_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce((select s.packaging_in_margins
                     from public.products p
                     join public.entity_calc_settings s on s.legal_entity_id = p.legal_entity_id
                    where p.id = p_product_id), true)
$$;
revoke all on function public.calc_packaging_in_margins(uuid) from public, anon;
grant execute on function public.calc_packaging_in_margins(uuid) to authenticated, service_role;

do $guard$
declare v_def text; v_new text;
begin
  v_def := pg_get_functiondef('public.h4_margin_eval(uuid,price_level,numeric,boolean,text,jsonb)'::regprocedure);
  if md5(v_def) <> 'da19eefad08a54909ed6b87149b37845' then
    raise exception 'Avbrutt: h4_margin_eval er endret siden 16.11.2026 (md5 %). Ingenting er kjørt.', md5(v_def);
  end if;
  v_new := replace(v_def,
    E'  v_raw    := nullif(p_cost ->> \'raw_cost\', \'\')::numeric;\n',
    E'  v_raw    := nullif(p_cost ->> \'raw_cost\', \'\')::numeric;\n'
    || E'  -- Variant B 18.11.2026: emballasje i kalkylen teller i Brutto og DG2 når innstillingen er på.\n'
    || E'  if v_raw is not null and public.calc_packaging_in_margins(p_product_id) then\n'
    || E'    v_raw := v_raw + coalesce(nullif(p_cost ->> \'packaging_cost\', \'\')::numeric, 0);\n'
    || E'  end if;\n');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke linjen som skal byttes i h4_margin_eval.'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.product_margins(uuid,date)'::regprocedure);
  if md5(v_def) <> '1c4d594c42078a473b825d69a2624b3d' then
    raise exception 'Avbrutt: product_margins er endret siden 16.11.2026 (md5 %). Ingenting er kjørt.', md5(v_def);
  end if;
  v_new := replace(v_def,
    E'  v_raw    := coalesce((c->>\'raw_cost\')::numeric, 0);\n',
    E'  v_raw    := coalesce((c->>\'raw_cost\')::numeric, 0)\n'
    || E'              + case when public.calc_packaging_in_margins(p_product_id)\n'
    || E'                     then coalesce((c->>\'packaging_cost\')::numeric, 0) else 0 end;\n');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke kostlinjen i product_margins.'; end if;
  v_def := v_new;
  v_new := replace(v_def,
    E'  return jsonb_build_object(\'ok\', true, \'has_cost\', true, \'product\', p.display_name,\n',
    E'  return jsonb_build_object(\'ok\', true, \'has_cost\', true, \'product\', p.display_name,\n'
    || E'    \'packaging_in_margins\', public.calc_packaging_in_margins(p_product_id),\n');
  if v_new = v_def then raise exception 'Avbrutt: fant ikke svarlinjen i product_margins.'; end if;
  execute v_new;
end $guard$;

create or replace function public.varer_cap_prisgrunnlag_v1()
returns boolean language sql stable set search_path to 'public' as $$ select true $$;
revoke all on function public.varer_cap_prisgrunnlag_v1() from public, anon;
grant execute on function public.varer_cap_prisgrunnlag_v1() to authenticated, service_role;

commit;
