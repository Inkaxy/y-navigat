-- Kjøres av root ETTER at PENDING-filen er anvendt, i én transaksjon som rulles tilbake.
-- Syntetiske rader; ingen forretningsdata blir stående. Feiler med RAISE ved avvik.
begin;
do $$
declare
  v_le uuid := (select id from public.legal_entities limit 1);
  v_r  uuid := gen_random_uuid();
  v_p  uuid := gen_random_uuid();
  v_v  uuid;
  j    jsonb;
begin
  insert into public.recipes (id, name, legal_entity_id) values (v_r, 'TEST snapshot', v_le);
  insert into public.products (id, legal_entity_id, display_name, code, show_breadscale, cert_nokkelhull, breadscale_mode)
    values (v_p, v_le, 'TEST snapshot', 'test-snap-' || left(v_p::text, 8), true, true, 'auto');
  insert into public.product_recipe_links (product_id, recipe_id, is_primary) values (v_p, v_r, true);
  insert into public.recipe_declaration_versions (recipe_id, version, approved_at, source, ingredient_text, ingredient_html,
      allergens_contains, allergens_may_contain, nutrition_per_100g, claim_keyhole, claim_grain, breadscale_pct, storage_text)
    values (v_r, 1, now(), 'calculated', 'Hvetemel', '<strong>Hvete</strong>mel', array['hvete'], '{}', '{"energy_kj":1000}', true, true, 60, null)
    returning id into v_v;
  update public.products set declaration_version_id = v_v, manual_ingredient_declaration = 'Løpende tekst',
    manual_allergens_contains = array['melk'], breadscale_pct = 10, declaration_needs_review = true where id = v_p;

  j := public.label_product_declaration(v_p);
  if j->>'allergener' <> 'hvete' then raise exception 'allergener fra versjon: %', j; end if;
  if j->>'brodskala_pct' is null or j->>'brodskala_pct' not like '60%' then raise exception 'grovhet fra versjon: %', j; end if;
  if j->>'nokkelhull' is distinct from 'Ja' then raise exception 'nøkkelhull fra versjon: %', j; end if;
  if j ? 'oppbevaring' then raise exception 'NULL i versjon skal være autoritativt: %', j; end if;

  perform public.breadscale_sync_products_for_recipe(v_r);
  if (select breadscale_pct from public.products where id = v_p) <> 60 then raise exception 'synk skal bruke versjonens grovhet'; end if;

  update public.recipe_declaration_versions set claim_grain = false, claim_keyhole = false where id = v_v;
  j := public.label_product_declaration(v_p);
  if j ? 'brodskala_pct' or j ? 'nokkelhull' then raise exception 'godkjent «nei» skal ikke overstyres: %', j; end if;
  raise notice 'PASS';
end $$;
rollback;
