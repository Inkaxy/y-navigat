-- ALLEREDE UTRULLET LIVE som 20260908162911 (rullet ut og rollback-testet av Henrik).
-- Speilet hit ordrett fra live-definisjonen fordi supabase/migrations/ ikke kan skrives av agenten.
-- Flytt filen inn i supabase/migrations/ med nøyaktig samme versjonsnummer ved synk.
--
-- apply_stock_movement låser begge råvare-ID-ene i sortert rekkefølge ved omkobling,
-- trekker OLD.quantity fra OLD-råvaren og legger NEW.quantity på NEW-råvaren.
-- Samme råvare tar delta. Tom search_path. PUBLIC/anon/authenticated kan ikke kjøre den.

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.raw_materials
      SET current_stock = COALESCE(current_stock,0) + NEW.quantity_base,
          updated_at = now()
      WHERE id = NEW.raw_material_id;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Lock both affected materials in the same order for reassignment.
    PERFORM id FROM public.raw_materials
      WHERE id IN (OLD.raw_material_id, NEW.raw_material_id)
      ORDER BY id FOR UPDATE;
    IF OLD.raw_material_id IS NOT DISTINCT FROM NEW.raw_material_id THEN
      UPDATE public.raw_materials
        SET current_stock = COALESCE(current_stock,0) - OLD.quantity_base + NEW.quantity_base,
            updated_at = now()
        WHERE id = NEW.raw_material_id;
    ELSE
      UPDATE public.raw_materials
        SET current_stock = COALESCE(current_stock,0) - OLD.quantity_base,
            updated_at = now()
        WHERE id = OLD.raw_material_id;
      UPDATE public.raw_materials
        SET current_stock = COALESCE(current_stock,0) + NEW.quantity_base,
            updated_at = now()
        WHERE id = NEW.raw_material_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.raw_materials
      SET current_stock = COALESCE(current_stock,0) - OLD.quantity_base,
          updated_at = now()
      WHERE id = OLD.raw_material_id;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Unsupported stock movement operation';
END;
$function$;

REVOKE ALL ON FUNCTION public.apply_stock_movement() FROM PUBLIC, anon, authenticated;
