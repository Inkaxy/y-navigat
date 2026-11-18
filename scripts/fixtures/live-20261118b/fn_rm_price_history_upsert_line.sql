CREATE OR REPLACE FUNCTION public.fn_rm_price_history_upsert_line(p_line_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_l invoice_lines%rowtype;
  v_inv invoices%rowtype;
  v_sup_entity uuid;
  v_rm_entity uuid;
  v_reason text;
  v_prev record; v_unit text; v_context jsonb; v_versioned boolean := false; v_new_id uuid;
begin
  select * into v_l from public.invoice_lines where id = p_line_id;
  if not found then return false; end if;

  select * into v_inv from public.invoices where id = v_l.invoice_id;
  if not found then return false; end if;

  if v_l.raw_material_id is null then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') = 'not_applicable' then
    v_reason := 'linje_ukoblet';
  elsif coalesce(v_l.match_confidence::text, '') not in ('auto_high', 'auto_medium', 'auto_low', 'manual') then
    v_reason := 'ukjent_match';
  elsif coalesce(v_l.requires_review, false) then
    v_reason := 'til_gjennomgang';
  elsif v_inv.status not in ('ready', 'reconciled')
        and not exists (select 1 from public.invoice_line_cost_postings pp where pp.invoice_line_id = v_l.id and pp.revoked_at is null)
        and not public.rm_invoice_lines_trusted(v_inv) then
    v_reason := 'faktura_ikke_klar';
  elsif upper(coalesce(v_inv.currency, 'NOK')) <> 'NOK' then
    v_reason := 'valuta_endret';
  elsif v_inv.flagged_at is not null then
    v_reason := 'faktura_flagget';
  elsif not public.rm_is_finite(v_l.price_per_base_unit) or v_l.price_per_base_unit < 0 then
    v_reason := 'ugyldig_pris';
  elsif not coalesce(v_inv.is_credit_note, false)
        and v_l.base_quantity is not null
        and (not public.rm_is_finite(v_l.base_quantity) or v_l.base_quantity < 0) then
    v_reason := 'ugyldig_mengde';
  end if;

  if v_reason is null then
    select legal_entity_id into v_rm_entity from public.raw_materials where id = v_l.raw_material_id;
    if v_rm_entity is null or v_rm_entity <> v_inv.legal_entity_id then
      v_reason := 'annet_selskap';
    else
      select legal_entity_id into v_sup_entity from public.suppliers where id = v_inv.supplier_id;
      if v_inv.supplier_id is null or v_sup_entity is null or v_sup_entity <> v_inv.legal_entity_id then
        v_reason := 'leverandor_annet_selskap';
      end if;
    end if;
  end if;

  if v_reason is not null then
    update public.raw_material_price_history
       set superseded_at = coalesce(superseded_at, now()),
           superseded_reason = coalesce(superseded_reason, v_reason)
     where invoice_line_id = p_line_id
       and superseded_at is null;
    return false;
  end if;

  select base_unit into v_unit from public.raw_materials where id = v_l.raw_material_id;
  v_context := jsonb_build_object(
    'line_unit', v_l.unit, 'package_size', v_l.package_size, 'package_unit', v_l.package_unit,
    'count_per_package', v_l.count_per_package,
    'base_units_per_package', (select s.base_units_per_package from public.raw_material_suppliers s where s.id = v_l.package_source_rms_id),
    'correction_id', (select c.id from public.invoice_line_corrections c where c.invoice_line_id = v_l.id order by c.corrected_at desc nulls last limit 1));
  select h.id, h.price, h.raw_material_id, h.supplier_id, h.effective_date,
         h.snapshot_unit, h.snapshot_package, h.snapshot_at, h.currency, h.is_credit
    into v_prev
    from public.raw_material_price_history h
   where h.invoice_line_id = p_line_id and h.superseded_at is null
   for update;
  if v_prev.id is not null and (
      v_prev.snapshot_at is null or v_prev.snapshot_unit is distinct from v_unit
      or v_prev.price is distinct from v_l.price_per_base_unit
      or v_prev.raw_material_id is distinct from v_l.raw_material_id
      or v_prev.supplier_id is distinct from v_inv.supplier_id
      or v_prev.effective_date is distinct from v_inv.invoice_date
      or v_prev.currency is distinct from 'NOK'
      or v_prev.is_credit is distinct from coalesce(v_inv.is_credit_note, false)
      or (v_prev.snapshot_package - 'line_version') is distinct from v_context) then
    update public.raw_material_price_history
       set superseded_at = now(), superseded_reason = 'nytt_prisgrunnlag'
     where id = v_prev.id;
    v_versioned := true;
  end if;

  insert into public.raw_material_price_history
    (raw_material_id, supplier_id, price, source, invoice_id, invoice_line_id, invoice_line_ref,
     effective_date, source_reference, currency, is_credit, created_by)
  values
    (v_l.raw_material_id, v_inv.supplier_id, v_l.price_per_base_unit, 'invoice',
     v_inv.id, v_l.id, v_l.id, v_inv.invoice_date, v_inv.invoice_number, 'NOK',
     coalesce(v_inv.is_credit_note, false), auth.uid())
  on conflict (invoice_line_id) where invoice_line_id is not null and superseded_at is null
  do update set
     raw_material_id  = excluded.raw_material_id,
     supplier_id      = excluded.supplier_id,
     price            = excluded.price,
     effective_date   = excluded.effective_date,
     source_reference = excluded.source_reference,
     is_credit        = excluded.is_credit,
     currency         = 'NOK',
     superseded_at    = null,
     superseded_reason = null
  returning id into v_new_id;

  if v_prev.id is not null
     and (v_versioned or v_prev.price is distinct from v_l.price_per_base_unit
          or v_prev.raw_material_id is distinct from v_l.raw_material_id
          or v_prev.supplier_id is distinct from v_inv.supplier_id
          or v_prev.effective_date is distinct from v_inv.invoice_date) then
    insert into public.audit_log
      (user_id, action, entity_type, entity_id, legal_entity_id, changes, reason, source_app)
    values
      (auth.uid(), case when v_versioned then 'price_history.versioned' else 'price_history.corrected' end, 'raw_material_price_history', v_prev.id,
       v_inv.legal_entity_id,
       jsonb_build_object(
         'old', jsonb_build_object('price', v_prev.price, 'raw_material_id', v_prev.raw_material_id,
                                   'supplier_id', v_prev.supplier_id, 'effective_date', v_prev.effective_date),
         'new', jsonb_build_object('price', v_l.price_per_base_unit, 'raw_material_id', v_l.raw_material_id,
                                   'supplier_id', v_inv.supplier_id, 'effective_date', v_inv.invoice_date),
         'invoice_line_id', p_line_id, 'new_history_id', v_new_id, 'old_snapshot_unit', v_prev.snapshot_unit, 'new_snapshot_unit', v_unit),
       'Prisobservasjon rettet fra fakturalinjen', 'ravarer');
  end if;

  update public.raw_material_price_history h
     set is_legacy = true,
         superseded_at = coalesce(h.superseded_at, now()),
         superseded_reason = coalesce(h.superseded_reason, 'ny_linjerad')
   where h.invoice_id = v_inv.id
     and h.raw_material_id = v_l.raw_material_id
     and h.invoice_line_id is null
     and h.invoice_line_ref is null
     and h.source = 'invoice';

  return true;
end;
$function$
