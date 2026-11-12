-- PENDING – kun for gjennomgang. Ikke kjørt mot live.
-- Formål (Henrik, beslutning 1, 12.11.2026): grovhetsprosenten som sendes til
-- nettsiden skal være et helt tall som alltid stemmer med kategorien i
-- Brødskala'n-merket. Kategorien avgjøres fortsatt av uavrundet prosent
-- (breadscale_step: under 26 / 51 / 76), så tallet rundes NED:
-- 25,6 → 25 (Fint), 50,9 → 50 (Halvgrovt), 26,4 → 26 (Halvgrovt).
-- Eneste endring mot live-definisjonen (lest med pg_get_functiondef 12.11.2026,
-- md5 0fc4425e0c29df93842dd57a4743059e, 13 772 tegn):
--   round(rec.breadscale_pct)  →  floor(rec.breadscale_pct)
-- Alt annet i funksjonen er byte-identisk med live. Ingen DDL, ingen ny
-- rettighetsoverflate, ingen dataendring ved kjøring. Lagrede prosenter endres
-- ikke. Push kjøres ikke. Varer der tallet endres får ny payload_hash og sendes
-- på nytt ved neste ordinære push (forventet).
-- Kontroll før/etter: 20261112_push_breadscale_floor.check.sql (bare SELECT).

begin;

CREATE OR REPLACE FUNCTION public.push_products_to_nettside()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_nb constant uuid := '751709bc-04b3-4449-867d-b97faa9ab373';
  v_settings public.nettside_sync_settings%rowtype;
  v_secret text;
  v_products jsonb := '[]'::jsonb;
  v_deletions jsonb := '[]'::jsonb;
  v_skipped_no_price jsonb := '[]'::jsonb;
  v_payload jsonb;
  v_item jsonb;
  v_hash text;
  v_request_id bigint;
  v_present_ids uuid[] := '{}';   -- alle kvalifiserte produkter (sendt + uendret) – styrer sletting
  v_sent_ids uuid[] := '{}';
  v_sent_hashes text[] := '{}';
  v_unchanged integer := 0;
  v_rejected integer := 0;
  v_force boolean := false;
  rec record;
begin
  select * into v_settings from public.nettside_sync_settings where id = 1;
  if not found or not v_settings.push_enabled then
    return jsonb_build_object('skipped', true, 'reason', 'push_disabled_or_no_settings');
  end if;
  v_force := coalesce(v_settings.force_full_push, false);

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'nettside_channel_secret' limit 1;
  if v_secret is null then
    return jsonb_build_object('error', 'nettside_channel_secret mangler i vault');
  end if;

  -- Avvisningsloggen speiler alltid siste kjøring for selskapet.
  delete from public.nettside_sync_rejections where legal_entity_id = v_nb;

  for rec in
    select
      p.id, p.display_number, p.display_name, p.description, p.unit_of_sale,
      p.mva_rate, p.image_url, p.status,
      -- Deklarasjonsfelt: versjonert produkt (peker satt) → bare godkjent versjon;
      -- mangler versjonsraden blir feltene tomme (aldri løpende p/beregning).
      -- Legacy (peker null) → produktets felt som før.
      case when p.declaration_version_id is not null then dv.ingredient_text
           else p.manual_ingredient_declaration end as manual_ingredient_declaration,
      case when p.declaration_version_id is not null then dv.allergens_contains
           else p.manual_allergens_contains end as manual_allergens_contains,
      case when p.declaration_version_id is not null then dv.allergens_may_contain
           else p.manual_allergens_may_contain end as manual_allergens_may_contain,
      case when p.declaration_version_id is not null then dv.nutrition_per_100g
           else p.manual_nutrition_per_100g end as manual_nutrition_per_100g,
      p.weight_per_unit_grams, p.pieces_per_unit, p.shelf_life_chilled_days,
      p.cert_nokkelhull, p.cert_norsk_100, p.show_breadscale,
      case when p.declaration_version_id is not null then
             case when dv.claim_grain and dv.breadscale_pct is not null
                  then public.breadscale_step(dv.breadscale_pct) end
           else p.breadscale_value end as breadscale_value,
      p.ean_code, p.gtin, p.keywords,
      -- H5
      p.shelf_life_frozen_days, p.is_divisible,
      case when p.declaration_version_id is not null then dv.breadscale_pct
           else p.breadscale_pct end as breadscale_pct,
      p.description_rich,
      pp.code as product_page_code, pp.display_name as product_page_name,
      s.payload_hash as prev_hash, s.status as prev_status,
      case when p.declaration_version_id is not null
           then coalesce(nullif(btrim(coalesce(dv.ingredient_html, '')), ''), dv.ingredient_text)
           else coalesce(public.label_declaration_html_from_version(p.id), p.manual_ingredient_declaration)
      end as ingredient_src,
      (p.cert_nokkelhull and public.product_keyhole_qualifies(p.id)) as keyhole_ok,
      coalesce(public.product_breadscale_claim_ok(p.id), false) as breadscale_ok,
      -- H1
      mc.display_name as main_category, sc.display_name as sub_category,
      pr.price, pr.prices_include_mva,
      n.energy_kcal_per_100g, n.energy_kj_per_100g, n.fat_g_per_100g, n.saturated_fat_g_per_100g,
      n.carbs_g_per_100g, n.sugars_g_per_100g, n.fiber_g_per_100g, n.protein_g_per_100g, n.salt_g_per_100g,
      n.coverage_pct, n.ingredient_count, n.ingredients_with_nutrition
    from public.products p
    left join public.product_main_categories mc on mc.id = p.main_category_id
    left join public.product_sub_categories sc on sc.id = p.sub_category_id
    left join public.product_pages pp on pp.id = p.product_page_id and pp.status = 'active'
    left join public.nettside_sync_state s on s.product_id = p.id
    left join lateral (
      select pli.price, pl.prices_include_mva
      from public.price_list_items pli
      join public.price_lists pl on pl.id = pli.price_list_id
      where pl.code = v_settings.price_list_code
        and pl.legal_entity_id = v_nb
        and pl.status = 'active'
        and pli.product_id = p.id
        and pli.valid_from <= current_date
        and (pli.valid_to is null or pli.valid_to >= current_date)
      order by pli.valid_from desc, coalesce(pli.min_quantity, 1) asc
      limit 1
    ) pr on true
    left join public.recipe_declaration_versions dv on dv.id = p.declaration_version_id
    -- Løpende beregnet næring bare for legacy; godkjent NULL-næring er autoritativt.
    left join public.product_nutrition_calculated n on n.product_id = p.id and p.declaration_version_id is null
    where p.legal_entity_id = v_nb
      and p.status = 'active'
      and p.in_web_shop = true
    order by p.display_number
  loop
    if rec.price is null or rec.price <= 0 then
      v_skipped_no_price := v_skipped_no_price || jsonb_build_object(
        'display_number', rec.display_number, 'display_name', rec.display_name);
      insert into public.nettside_sync_rejections (product_id, legal_entity_id, reason, detail)
      values (rec.id, v_nb, 'ingen_pris',
              format('Ingen gyldig pris > 0 i prisliste «%s» i dag', v_settings.price_list_code));
      v_rejected := v_rejected + 1;
      continue;
    end if;

    v_item := jsonb_build_object(
      'nbhub_product_id', rec.id,
      'nbhub_display_number', rec.display_number,
      'legal_entity_short_code', 'NB',
      'display_name', rec.display_name,
      'description', rec.description,
      'description_rich', case
        when nullif(btrim(coalesce(rec.description_rich ->> 'text', '')), '') is not null
        then jsonb_build_object(
          'format', coalesce(rec.description_rich ->> 'format', 'markdown'),
          'text',   rec.description_rich ->> 'text')
        else null end,
      'product_page', case
        when rec.product_page_name is not null
        then jsonb_build_object('code', rec.product_page_code, 'display_name', rec.product_page_name)
        else null end,
      'unit_of_sale', rec.unit_of_sale,
      'mva_rate', rec.mva_rate,
      'price_net', round(case when rec.prices_include_mva
                              then rec.price / (1 + rec.mva_rate / 100.0)
                              else rec.price end, 2),
      'declaration', case
        when rec.manual_ingredient_declaration is not null
          or coalesce(array_length(rec.manual_allergens_contains, 1), 0) > 0
        then jsonb_strip_nulls(jsonb_build_object(
          'ingredients', rec.manual_ingredient_declaration,
          'ingredients_text', public.label_ingredients_plain(rec.ingredient_src),
          'ingredients_html', public.label_ingredients_html(rec.ingredient_src),
          'allergens_contains', to_jsonb(coalesce(rec.manual_allergens_contains, '{}'::text[])),
          'allergens_may_contain', to_jsonb(coalesce(rec.manual_allergens_may_contain, '{}'::text[]))))
        else null end,
      'nutrition', case
        when rec.manual_nutrition_per_100g is not null
          and (rec.manual_nutrition_per_100g ? 'energy_kcal' or rec.manual_nutrition_per_100g ? 'energy_kj')
        then jsonb_strip_nulls(jsonb_build_object(
          'energy_kj_per_100g',        (rec.manual_nutrition_per_100g->>'energy_kj')::numeric,
          'energy_kcal_per_100g',      (rec.manual_nutrition_per_100g->>'energy_kcal')::numeric,
          'fat_g_per_100g',            (rec.manual_nutrition_per_100g->>'fat_g')::numeric,
          'saturated_fat_g_per_100g',  (rec.manual_nutrition_per_100g->>'saturated_fat_g')::numeric,
          'carbs_g_per_100g',          (rec.manual_nutrition_per_100g->>'carbs_g')::numeric,
          'sugars_g_per_100g',         (rec.manual_nutrition_per_100g->>'sugars_g')::numeric,
          'fiber_g_per_100g',          (rec.manual_nutrition_per_100g->>'fiber_g')::numeric,
          'protein_g_per_100g',        (rec.manual_nutrition_per_100g->>'protein_g')::numeric,
          'salt_g_per_100g',           (rec.manual_nutrition_per_100g->>'salt_g')::numeric))
        when rec.energy_kcal_per_100g is not null
          and coalesce(rec.coverage_pct, 0) >= 90
          and rec.ingredients_with_nutrition = rec.ingredient_count
        then jsonb_strip_nulls(jsonb_build_object(
          'energy_kj_per_100g', rec.energy_kj_per_100g,
          'energy_kcal_per_100g', rec.energy_kcal_per_100g,
          'fat_g_per_100g', rec.fat_g_per_100g,
          'saturated_fat_g_per_100g', rec.saturated_fat_g_per_100g,
          'carbs_g_per_100g', rec.carbs_g_per_100g,
          'sugars_g_per_100g', rec.sugars_g_per_100g,
          'fiber_g_per_100g', rec.fiber_g_per_100g,
          'protein_g_per_100g', rec.protein_g_per_100g,
          'salt_g_per_100g', rec.salt_g_per_100g))
        else null end,
      'facts', jsonb_strip_nulls(jsonb_build_object(
        'weight_grams', rec.weight_per_unit_grams,
        'pieces_per_unit', nullif(rec.pieces_per_unit, 1),
        'is_divisible', coalesce(rec.is_divisible, false),
        'shelf_life_days', rec.shelf_life_chilled_days,
        'shelf_life_frozen_days', rec.shelf_life_frozen_days,
        'nokkelhull', case when rec.keyhole_ok then true else null end,
        'norsk_100', case when rec.cert_norsk_100 then true else null end,
        'breadscale', case when coalesce(rec.show_breadscale, false) then rec.breadscale_value else null end,
        'breadscale_pct', case when rec.breadscale_ok then floor(rec.breadscale_pct) else null end,
        'ean', coalesce(rec.ean_code, rec.gtin),
        'main_category', rec.main_category,
        'sub_category', rec.sub_category,
        'keywords', case when coalesce(array_length(rec.keywords, 1), 0) > 0
                         then to_jsonb(rec.keywords) else null end
      )),
      'image_urls', case when rec.image_url is not null
                         then jsonb_build_array(rec.image_url)
                         else '[]'::jsonb end,
      'status', 'active'
    );

    v_hash := md5(v_item::text);
    v_present_ids := v_present_ids || rec.id;

    if not v_force
       and rec.prev_hash is not null
       and rec.prev_hash = v_hash
       and rec.prev_status = 'active' then
      v_unchanged := v_unchanged + 1;
      continue;
    end if;

    v_products := v_products || v_item;
    v_sent_ids := v_sent_ids || rec.id;
    v_sent_hashes := v_sent_hashes || v_hash;
  end loop;

  for rec in
    select s.product_id, p.display_number, p.display_name, coalesce(p.mva_rate, 15) as mva_rate
    from public.nettside_sync_state s
    join public.products p on p.id = s.product_id
    where not (s.product_id = any (v_present_ids))
      and s.delete_attempts < 5
  loop
    v_deletions := v_deletions || jsonb_build_object(
      'nbhub_product_id', rec.product_id,
      'nbhub_display_number', rec.display_number,
      'legal_entity_short_code', 'NB',
      'display_name', rec.display_name,
      'mva_rate', rec.mva_rate,
      'price_net', 0,
      'deleted', true
    );
  end loop;

  if jsonb_array_length(v_products) = 0 and jsonb_array_length(v_deletions) = 0 then
    if v_force then
      update public.nettside_sync_settings set force_full_push = false, updated_at = now() where id = 1;
    end if;
    return jsonb_build_object('skipped', true,
      'reason', case when v_unchanged > 0 then 'ingen_endringer' else 'ingenting_aa_pushe' end,
      'unchanged', v_unchanged, 'rejected', v_rejected,
      'skipped_no_price', v_skipped_no_price);
  end if;

  v_payload := jsonb_build_object('products', v_products || v_deletions);

  select net.http_post(
    url := v_settings.site_sync_url,
    body := v_payload,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Channel-Token', v_secret
    ),
    timeout_milliseconds := 15000
  ) into v_request_id;

  insert into public.nettside_sync_state (product_id, status, last_pushed_at, payload_hash)
  select u.id, 'active', now(), u.h
    from unnest(v_sent_ids, v_sent_hashes) as u(id, h)
  on conflict (product_id) do update
    set status = 'active', delete_attempts = 0, last_pushed_at = now(),
        payload_hash = excluded.payload_hash;

  update public.nettside_sync_state s
  set status = 'delete_pending', delete_attempts = s.delete_attempts + 1, last_pushed_at = now(),
      payload_hash = null
  where not (s.product_id = any (v_present_ids));

  delete from public.nettside_sync_state where delete_attempts >= 5;

  update public.nettside_sync_settings
  set last_push_at = now(),
      last_push_request_id = v_request_id,
      last_push_summary = jsonb_build_object(
        'products', jsonb_array_length(v_products),
        'unchanged', v_unchanged,
        'deletions', jsonb_array_length(v_deletions),
        'rejected', v_rejected,
        'forced', v_force,
        'skipped_no_price', v_skipped_no_price),
      force_full_push = false,
      updated_at = now()
  where id = 1;

  return jsonb_build_object(
    'request_id', v_request_id,
    'products', jsonb_array_length(v_products),
    'unchanged', v_unchanged,
    'deletions', jsonb_array_length(v_deletions),
    'rejected', v_rejected,
    'forced', v_force,
    'skipped_no_price', v_skipped_no_price);
end;
$function$
;

commit;
