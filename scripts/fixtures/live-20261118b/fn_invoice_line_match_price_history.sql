CREATE OR REPLACE FUNCTION public.fn_invoice_line_match_price_history()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'UPDATE'
     and old.raw_material_id is not distinct from new.raw_material_id
     and old.match_confidence is not distinct from new.match_confidence
     and old.price_per_base_unit is not distinct from new.price_per_base_unit
     and old.base_quantity is not distinct from new.base_quantity
     and old.requires_review is not distinct from new.requires_review
     and old.total_amount is not distinct from new.total_amount
     and old.review_reason is not distinct from new.review_reason
     and old.quantity is not distinct from new.quantity
     and old.unit is not distinct from new.unit
     and old.unit_price is not distinct from new.unit_price
     and old.discount_amount is not distinct from new.discount_amount
     and old.unit_price_basis is not distinct from new.unit_price_basis
     and old.package_size is not distinct from new.package_size
     and old.package_unit is not distinct from new.package_unit
     and old.count_per_package is not distinct from new.count_per_package
     and old.package_source_rms_id is not distinct from new.package_source_rms_id then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.raw_material_id is not null
     and old.raw_material_id is distinct from new.raw_material_id then
    update public.raw_material_price_history
       set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, 'linje_ukoblet')
     where invoice_line_id = new.id
       and raw_material_id = old.raw_material_id
       and superseded_at is null;
    perform public.rm_apply_derived_cost_price(old.raw_material_id);
  end if;

  if public.fn_rm_price_history_upsert_line(new.id) then
    perform public.rm_apply_derived_cost_price(new.raw_material_id);
    if coalesce(current_setting('rm.defer_stats', true), '') <> 'on' then
      perform public.refresh_purchase_stats();
    end if;
  elsif new.raw_material_id is not null then
    perform public.rm_apply_derived_cost_price(new.raw_material_id);
  end if;
  return new;
end;
$function$
