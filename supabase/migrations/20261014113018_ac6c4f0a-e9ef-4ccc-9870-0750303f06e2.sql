alter table public.raw_material_suppliers add column if not exists container_unit text;
alter table public.raw_material_supplier_packages add column if not exists container_unit text;

create or replace function public._rms_record_package_variant()
 returns trigger language plpgsql security definer set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.package_confirmed_at IS NOT NULL AND OLD.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    VALUES (OLD.id, rm_sku_norm(OLD.supplier_sku), OLD.package_size, OLD.package_unit, OLD.base_units_per_package, OLD.package_confirmed_at, OLD.package_confirmed_by, OLD.container_unit)
    ON CONFLICT DO NOTHING;
  END IF;
  IF NEW.package_confirmed_at IS NOT NULL AND NEW.base_units_per_package IS NOT NULL THEN
    INSERT INTO raw_material_supplier_packages (raw_material_supplier_id, supplier_sku_norm, package_size, package_unit, base_units_per_package, confirmed_at, confirmed_by, container_unit)
    VALUES (NEW.id, rm_sku_norm(NEW.supplier_sku), NEW.package_size, NEW.package_unit, NEW.base_units_per_package, NEW.package_confirmed_at, NEW.package_confirmed_by, NEW.container_unit)
    ON CONFLICT (raw_material_supplier_id, supplier_sku_norm, coalesce(package_size, -1), coalesce(lower(package_unit), ''), base_units_per_package)
    DO UPDATE SET confirmed_at = EXCLUDED.confirmed_at, confirmed_by = EXCLUDED.confirmed_by, superseded_at = NULL, superseded_reason = NULL,
      container_unit = coalesce(EXCLUDED.container_unit, raw_material_supplier_packages.container_unit);
  END IF;
  RETURN NEW;
END $function$;

do $do$
declare d text; n text; anchor text := E'  for r in select unnest(v_line_ids) as id loop\n    v_arr := coalesce(';
begin
  d := pg_get_functiondef('public.rm_confirm_line_match(uuid,uuid,numeric,text,numeric,boolean,numeric,boolean,uuid[],boolean)'::regprocedure);
  if position(anchor in d) = 0 or position('container_unit' in d) > 0 then raise exception 'rm_confirm_line_match anchor mismatch'; end if;
  n := replace(d, anchor, E'  -- Fysisk beholder = linjens egen trykte enhet (aldri klientvalgt), lagret separat fra innhold.\n'
    || E'  if coalesce(p_confirm_package, false) and v_rms_id is not null then\n'
    || E'    update public.raw_material_suppliers s\n'
    || E'       set container_unit = (select nullif(lower(btrim(coalesce(l.unit, \'\'))), \'\') from public.invoice_lines l where l.id = p_invoice_line_id)\n'
    || E'     where s.id = v_rms_id and s.package_confirmed_at is not null and s.base_units_per_package is not null;\n'
    || E'  end if;\n\n' || anchor);
  execute n;
end $do$;