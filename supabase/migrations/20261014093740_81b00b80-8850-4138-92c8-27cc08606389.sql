do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.rm_correct_raw_material_type_unit(uuid, text, text, text, text, uuid, boolean)'::regprocedure);
  d := replace(d,
    'update raw_material_supplier_packages p set confirmed_at = null, confirmed_by = null from raw_material_suppliers s where s.id = p.raw_material_supplier_id and s.raw_material_id = v_rm.id and p.confirmed_at is not null;',
    'update raw_material_supplier_packages p set superseded_at = now(), superseded_reason = format(''grunnenhet_endret:%s->%s'', v_rm.base_unit, p_base_unit) from raw_material_suppliers s where s.id = p.raw_material_supplier_id and s.raw_material_id = v_rm.id and p.superseded_at is null;');
  d := replace(d,
    'where s.raw_material_id = v_rm.id and v_unit_changes and p.confirmed_at is not null;',
    'where s.raw_material_id = v_rm.id and v_unit_changes and p.superseded_at is null;');
  if position('superseded_reason = format' in d) = 0 or position('v_unit_changes and p.superseded_at is null' in d) = 0 then raise exception 'patch feilet'; end if;
  execute d;
end $mig$;