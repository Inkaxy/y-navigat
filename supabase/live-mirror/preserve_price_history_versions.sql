-- Live-speil 2026-10-14 av root-migrasjonen «preserve_price_history_versions» (allerede kjørt mot live av root).
-- IKKE kjør på nytt. Innholdet er hentet med pg_get_functiondef / pg_get_indexdef / pg_get_triggerdef fra live.
-- Kontrakt: én aktiv observasjon per fakturalinje; ny pris/enhet/pakning/kontekst gir NY versjon
-- (gammel får superseded_reason='nytt_prisgrunnlag'); låst pris kan bare endres av auditert administratorreparasjon.

-- Indeks
CREATE UNIQUE INDEX ux_rmph_invoice_line ON public.raw_material_price_history USING btree (invoice_line_id) WHERE ((invoice_line_id IS NOT NULL) AND (superseded_at IS NULL));

-- Triggere (uendret definisjon, speilet for fullstendighet)
CREATE TRIGGER trg_invoice_line_match_price_history AFTER INSERT OR UPDATE OF raw_material_id, match_confidence, price_per_base_unit, base_quantity, requires_review, total_amount, review_reason ON public.invoice_lines FOR EACH ROW EXECUTE FUNCTION fn_invoice_line_match_price_history();
CREATE TRIGGER trg_rmph_snapshot BEFORE INSERT OR UPDATE ON public.raw_material_price_history FOR EACH ROW EXECUTE FUNCTION _rmph_snapshot();

CREATE OR REPLACE FUNCTION public._rmph_snapshot()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_line uuid; l record; v_bupp numeric; v_corr uuid; v_cur text;
begin
  if tg_op = 'INSERT' then
    select base_unit into new.snapshot_unit from raw_materials where id = new.raw_material_id;
    v_line := coalesce(new.invoice_line_id, new.invoice_line_ref);
    if v_line is not null then
      select il.unit, il.package_size, il.package_unit, il.count_per_package, il.package_source_rms_id, il.updated_at
        into l from invoice_lines il where il.id = v_line;
      if found then
        if l.package_source_rms_id is not null then
          select base_units_per_package into v_bupp from raw_material_suppliers where id = l.package_source_rms_id;
        end if;
        select c.id into v_corr from invoice_line_corrections c where c.invoice_line_id = v_line order by c.corrected_at desc nulls last limit 1;
        new.snapshot_package := jsonb_build_object('line_unit', l.unit, 'package_size', l.package_size, 'package_unit', l.package_unit,
          'count_per_package', l.count_per_package, 'base_units_per_package', v_bupp,
          'line_version', l.updated_at, 'correction_id', v_corr);
      end if;
    end if;
    if new.invoice_id is not null and new.currency is null then select currency into v_cur from invoices where id = new.invoice_id; end if;
    new.snapshot_currency := upper(nullif(btrim(coalesce(new.currency, v_cur)), ''));
    new.snapshot_source := 'ved_registrering';
    new.snapshot_at := now();
    return new;
  end if;
  -- En frossen pris kan ikke endres mens enhet/pakning står igjen fra en eldre observasjon.
  -- Kun en eksplisitt, auditert administratorreparasjon kan gjenopprette en korrupt verdi.
  if old.snapshot_at is not null and new.price is distinct from old.price
     and coalesce(current_setting('rm.snapshot_price_repair', true), '') <> 'on' then
    raise exception 'Låst prisobservasjon: opprett en ny versjon av prisgrunnlaget' using errcode = '55000';
  end if;
  -- UPDATE: et låst grunnlag er uforanderlig. Tomt grunnlag kan bare fylles av revidert tilbakefylling.
  if old.snapshot_at is not null or coalesce(current_setting('rm.snapshot_backfill', true), '') <> 'on' then
    new.snapshot_unit := old.snapshot_unit; new.snapshot_package := old.snapshot_package;
    new.snapshot_currency := old.snapshot_currency; new.snapshot_source := old.snapshot_source; new.snapshot_at := old.snapshot_at;
  end if;
  return new;
end $function$;

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
$function$;

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
$function$;
