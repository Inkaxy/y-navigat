create or replace function public.rm_usable_cost(p_raw_material_id uuid)
returns numeric language sql stable security invoker set search_path = public as $$
  select case when r.cost_basis_status = 'mangler' then null else r.current_cost_price end
    from raw_materials r where r.id = p_raw_material_id
$$;