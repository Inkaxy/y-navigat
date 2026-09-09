-- ALLEREDE UTRULLET LIVE som 20260908163016. Speilet ordrett fra live-definisjonen.
-- stock_from_invoice_line bruker -abs(v_qty) for kreditnota, slik at en allerede
-- negativ mengde ikke snus til positiv.

CREATE OR REPLACE FUNCTION public.stock_from_invoice_line()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_rm record; v_inv record; v_qty numeric;
begin
  if tg_op = 'DELETE' then
    delete from public.stock_movements
      where source_table = 'invoice_lines' and source_id = old.id;
    return old;
  end if;

  delete from public.stock_movements
    where source_table = 'invoice_lines' and source_id = new.id
      and (new.raw_material_id is null or new.raw_material_id <> raw_material_id);

  if new.raw_material_id is null or new.match_confidence = 'not_applicable' then
    delete from public.stock_movements
      where source_table = 'invoice_lines' and source_id = new.id;
    return new;
  end if;

  select id, is_resale_item, stock_tracking, base_unit
    into v_rm from public.raw_materials where id = new.raw_material_id;
  if not found or not v_rm.stock_tracking then
    return new;
  end if;

  select id, legal_entity_id, invoice_date, is_credit_note
    into v_inv from public.invoices where id = new.invoice_id;
  if not found then return new; end if;

  v_qty := coalesce(new.base_quantity,
                    case when lower(coalesce(new.unit,'')) = lower(coalesce(v_rm.base_unit,''))
                         then new.quantity else null end);
  if v_qty is null or v_qty = 0 then
    delete from public.stock_movements
      where source_table = 'invoice_lines' and source_id = new.id;
    return new;
  end if;

  if coalesce(v_inv.is_credit_note,false) then v_qty := -abs(v_qty); end if;

  insert into public.stock_movements (
    legal_entity_id, raw_material_id, movement_type, quantity_base,
    occurred_at, source_table, source_id, note)
  values (v_inv.legal_entity_id, new.raw_material_id,
    case when v_qty < 0 then 'return' else 'purchase' end, v_qty,
    coalesce(v_inv.invoice_date::timestamptz, now()), 'invoice_lines', new.id,
    'Fra fakturalinje')
  on conflict (source_table, source_id, raw_material_id) where source_id is not null do update
    set quantity_base = excluded.quantity_base,
        occurred_at = excluded.occurred_at,
        movement_type = excluded.movement_type;

  return new;
end $function$;
