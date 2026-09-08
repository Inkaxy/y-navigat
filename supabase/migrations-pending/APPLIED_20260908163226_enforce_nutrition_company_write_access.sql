-- ALLEREDE UTRULLET LIVE som 20260908163226. Speilet ordrett fra live-definisjonen.
-- Begge næringsfunksjonene krever nå auth.uid() og skrivetilgang i RÅVARENS selskap
-- (has_ravarer_access(auth.uid(), rm.legal_entity_id, 'write')). Kryss-selskap-skriving
-- ble reprodusert før fiksen og er nå sperret. PUBLIC/anon kan ikke kjøre dem.
--
-- NB: rm_can_write er IKKE tilstrekkelig alene — gammel definisjon mangler
-- valid_from/valid_to-kontroll på user_positions. Bruk has_ravarer_access.

CREATE OR REPLACE FUNCTION public.rm_apply_matvaretabellen(p_raw_material_id uuid, p_food_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_food matvaretabellen_foods%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.raw_materials rm
    where rm.id = p_raw_material_id
      and public.has_ravarer_access(auth.uid(), rm.legal_entity_id, 'write'::public.access_level)
  ) then
    raise exception 'Mangler skrivetilgang til råvarer';
  end if;

  select * into v_food from matvaretabellen_foods where food_id = p_food_id;
  if not found then
    raise exception 'Ukjent Matvaretabellen-vare: %', p_food_id;
  end if;

  insert into raw_material_nutrition as n (
    raw_material_id, energy_kj, energy_kcal, fat_g, saturated_fat_g,
    carbs_g, sugars_g, fiber_g, protein_g, salt_g,
    source, source_document_url, matvaretabellen_food_id, updated_at
  ) values (
    p_raw_material_id, v_food.energy_kj, v_food.energy_kcal, v_food.fat_g, v_food.saturated_fat_g,
    v_food.carbs_g, v_food.sugars_g, v_food.fiber_g, v_food.protein_g, v_food.salt_g,
    'matvaretabellen', v_food.uri, v_food.food_id, now()
  )
  on conflict (raw_material_id) do update set
    energy_kj = excluded.energy_kj, energy_kcal = excluded.energy_kcal,
    fat_g = excluded.fat_g, saturated_fat_g = excluded.saturated_fat_g,
    carbs_g = excluded.carbs_g, sugars_g = excluded.sugars_g, fiber_g = excluded.fiber_g,
    protein_g = excluded.protein_g, salt_g = excluded.salt_g,
    source = 'matvaretabellen', source_document_url = excluded.source_document_url,
    matvaretabellen_food_id = excluded.matvaretabellen_food_id, updated_at = now();

  update raw_materials
     set water_content_pct = case when water_content_pct is null then v_food.water_g else water_content_pct end,
         declaration_name  = case when nullif(trim(declaration_name),'') is null
                                  then mvt_declaration_name(v_food.food_name)
                                  else declaration_name end,
         updated_at = now()
   where id = p_raw_material_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.rm_unlink_matvaretabellen(p_raw_material_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if auth.uid() is null or not exists (
    select 1 from public.raw_materials rm
    where rm.id = p_raw_material_id
      and public.has_ravarer_access(auth.uid(), rm.legal_entity_id, 'write'::public.access_level)
  ) then
    raise exception 'Mangler skrivetilgang til råvarer';
  end if;

  update raw_material_nutrition
     set matvaretabellen_food_id = null,
         source = case when source = 'matvaretabellen' then 'manuell' else source end,
         updated_at = now()
   where raw_material_id = p_raw_material_id;
end;
$function$;

REVOKE ALL ON FUNCTION public.rm_apply_matvaretabellen(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rm_unlink_matvaretabellen(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rm_apply_matvaretabellen(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rm_unlink_matvaretabellen(uuid) TO authenticated, service_role;
