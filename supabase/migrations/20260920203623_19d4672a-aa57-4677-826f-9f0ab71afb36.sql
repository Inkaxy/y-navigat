-- Retting: `text[] || 'literal'` tolkes som array-literal i Postgres 17 og feilet
-- med «malformed array literal» for hver sperre. Bruker array_append i stedet.
create or replace function public.rm_start_price_eligibility(p_invoice_line_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare
  l record; i record; rm record; s record;
  v_reasons text[] := '{}';
begin
  if p_invoice_line_id is null then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['mangler_linje']));
  end if;

  select il.* into l from public.invoice_lines il where il.id = p_invoice_line_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['linjen_finnes_ikke']));
  end if;

  select inv.* into i from public.invoices inv where inv.id = l.invoice_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['fakturaen_finnes_ikke']));
  end if;

  if l.raw_material_id is null then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['linjen_er_ikke_koblet_til_vare']));
  end if;

  select r.* into rm from public.raw_materials r where r.id = l.raw_material_id;
  if not found then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['varen_finnes_ikke']));
  end if;

  if rm.legal_entity_id is distinct from i.legal_entity_id then
    return jsonb_build_object('eligible', false, 'blockers', to_jsonb(array['faktura_og_vare_i_ulike_selskap']));
  end if;

  if auth.uid() is not null and not public.has_ravarer_invoice_access(i.legal_entity_id, 'read') then
    raise exception 'Ingen fakturatilgang for dette selskapet';
  end if;

  if i.supplier_id is null then
    v_reasons := array_append(v_reasons, 'fakturaen_mangler_leverandor');
  end if;
  if coalesce(i.is_credit_note, false) then
    v_reasons := array_append(v_reasons, 'kreditnota');
  end if;
  if upper(coalesce(i.currency, 'NOK')) <> 'NOK' then
    v_reasons := array_append(v_reasons, 'annen_valuta');
  end if;
  if i.invoice_date is null then
    v_reasons := array_append(v_reasons, 'fakturaen_mangler_dato');
  end if;
  if rm.base_unit is null or btrim(rm.base_unit) = '' then
    v_reasons := array_append(v_reasons, 'varen_mangler_grunnenhet');
  end if;
  if coalesce(l.requires_review, false) then
    v_reasons := array_append(v_reasons, 'linjen_star_til_gjennomgang');
  end if;
  if l.match_confidence is distinct from 'manual' then
    v_reasons := array_append(v_reasons, 'koblingen_er_ikke_manuelt_bekreftet');
  end if;
  if l.total_amount is null or not public.rm_is_finite(l.total_amount) or l.total_amount <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_nettobelop');
  end if;
  if l.quantity is null or not public.rm_is_finite(l.quantity) or l.quantity <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_mengde');
  end if;
  if l.base_quantity is null or not public.rm_is_finite(l.base_quantity) or l.base_quantity <= 0 then
    v_reasons := array_append(v_reasons, 'ukjent_mengde_i_grunnenhet');
  end if;
  if l.price_per_base_unit is null or not public.rm_is_finite(l.price_per_base_unit) or l.price_per_base_unit <= 0 then
    v_reasons := array_append(v_reasons, 'ugyldig_pris_per_grunnenhet');
  end if;

  select rms.* into s
    from public.raw_material_suppliers rms
   where rms.raw_material_id = l.raw_material_id
     and rms.supplier_id = i.supplier_id;

  if not found then
    v_reasons := array_append(v_reasons, 'mangler_leverandorkobling');
  else
    if s.package_confirmed_at is null
       or s.base_units_per_package is null
       or s.base_units_per_package <= 0 then
      v_reasons := array_append(v_reasons, 'ukjent_pakning');
    end if;
    if s.start_price_per_base_unit is not null then
      v_reasons := array_append(v_reasons, 'startpris_finnes_allerede');
    end if;
  end if;

  return jsonb_build_object(
    'eligible', array_length(v_reasons, 1) is null,
    'blockers', to_jsonb(coalesce(v_reasons, '{}'::text[])),
    'raw_material_supplier_id', s.id,
    'raw_material_id', l.raw_material_id,
    'supplier_id', i.supplier_id,
    'legal_entity_id', i.legal_entity_id,
    'invoice_id', i.id,
    'invoice_number', i.invoice_number,
    'invoice_date', i.invoice_date,
    'price_per_base_unit', l.price_per_base_unit,
    'base_quantity', l.base_quantity,
    'total_amount', l.total_amount,
    'currency', upper(coalesce(i.currency, 'NOK')),
    'base_unit', rm.base_unit,
    'base_units_per_package', s.base_units_per_package,
    'package_size', s.package_size,
    'package_unit', s.package_unit,
    'existing_start_price', s.start_price_per_base_unit
  );
end;
$function$;

revoke all on function public.rm_start_price_eligibility(uuid) from public, anon;
grant execute on function public.rm_start_price_eligibility(uuid) to authenticated, service_role;