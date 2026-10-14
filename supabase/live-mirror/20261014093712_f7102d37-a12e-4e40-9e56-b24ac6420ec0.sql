alter table public.raw_material_supplier_packages
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

do $mig$
declare d text; n int;
begin
  d := pg_get_functiondef('public.rm_post_safe_line_costs(uuid, uuid[])'::regprocedure);
  d := replace(d, 'AND (p.supplier_sku_norm = '''' OR p.supplier_sku_norm = rm_sku_norm(r.supplier_sku))',
                  'AND p.superseded_at IS NULL AND (p.supplier_sku_norm = '''' OR p.supplier_sku_norm = rm_sku_norm(r.supplier_sku))');
  if position('p.superseded_at IS NULL' in d) = 0 then raise exception 'patch rm_post_safe_line_costs feilet'; end if;
  execute d;

  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = 'recalc_raw_material_cost';
  n := (length(d) - length(replace(d, 'v.confirmed_at is not null', ''))) / length('v.confirmed_at is not null');
  d := replace(d, 'v.raw_material_supplier_id = v_rms.id and v.base_units_per_package is not null',
                  'v.raw_material_supplier_id = v_rms.id and v.base_units_per_package is not null and v.superseded_at is null');
  d := replace(d, 'v.confirmed_at is not null', 'v.confirmed_at is not null and v.superseded_at is null');
  if n < 1 or position('v_rms.id and v.base_units_per_package is not null and v.superseded_at is null' in d) = 0 then raise exception 'patch recalc_raw_material_cost feilet (%)', n; end if;
  execute d;
end $mig$;

CREATE OR REPLACE FUNCTION public._rms_record_package_variant()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.package_confirmed_at IS NOT NULL AND OLD.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by)
    VALUES (OLD.id, rm_sku_norm(OLD.supplier_sku), OLD.package_size, OLD.package_unit, OLD.base_units_per_package, OLD.package_confirmed_at, OLD.package_confirmed_by)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.package_confirmed_at IS NOT NULL AND NEW.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by)
    VALUES (NEW.id, rm_sku_norm(NEW.supplier_sku), NEW.package_size, NEW.package_unit, NEW.base_units_per_package, NEW.package_confirmed_at, NEW.package_confirmed_by)
    ON CONFLICT (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package)
    DO UPDATE SET confirmed_at = EXCLUDED.confirmed_at, confirmed_by = EXCLUDED.confirmed_by, superseded_at = NULL, superseded_reason = NULL;
  END IF;
  RETURN NEW;
END $function$;