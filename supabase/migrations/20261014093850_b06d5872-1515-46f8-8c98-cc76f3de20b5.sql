do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.rm_correct_raw_material_type_unit(uuid, text, text, text, text, uuid, boolean)'::regprocedure);
  d := replace(d, 'p_item_type not in (''ravare'',''emballasje'',''videresalg'')', 'p_item_type not in (''ravare'',''emballasje'',''forbruksvare'',''videresalg'')');
  if position('''forbruksvare''' in d) = 0 then raise exception 'patch feilet'; end if;
  execute d;
end $mig$;