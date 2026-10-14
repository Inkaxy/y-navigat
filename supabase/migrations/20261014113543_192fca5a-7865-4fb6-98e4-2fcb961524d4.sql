drop trigger if exists trg_rms_package_variant on public.raw_material_suppliers;
create trigger trg_rms_package_variant after insert or update of package_size, package_unit, base_units_per_package, package_confirmed_at, supplier_sku, container_unit
  on public.raw_material_suppliers for each row execute function public._rms_record_package_variant();