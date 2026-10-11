do $$
declare d text;
begin
  d := pg_get_functiondef('public.rm_cost_price_source(uuid)'::regprocedure);
  d := replace(d, '    when c.history_id is null and v_rm.current_cost_price is null then ''mangler''',
                  '    when c.history_id is null and (v_rm.current_cost_price is null or v_rm.cost_basis_status = ''mangler'') then ''mangler''');
  d := replace(d, '''price_source'', v_rm.price_source,', '''price_source'', v_rm.price_source, ''basis_status'', v_rm.cost_basis_status, ''source_history_id'', v_rm.cost_source_history_id,');
  if position('basis_status' in d) = 0 or position('v_rm.cost_basis_status = ''mangler''' in d) = 0 then raise exception 'rm_cost_price_source: ikke funnet'; end if;
  execute d;
end $$;